// k6 load test for SC-010: 100 virtual users running a pull/push mix against a deployed stage.
//
//   pnpm db:seed --scenario=heavy            # 20,000 cards, 3 years of history (seeds the demo learner)
//   k6 run -e BASE_URL=https://<stage>.workers.dev tests/load/sync-mix.js
//
// Reported: p95 of every request (the SC-010 budget is 2 s for home/path/dashboard data) and the
// slowest 1% of first requests per VU, which approximates Lambda cold starts. Check Neon's storage
// dashboard separately for the storage cost per 100k review logs.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE_URL;
const EMAIL = __ENV.EMAIL || 'demo@anki-duo.local';
const PASSWORD = __ENV.PASSWORD || 'demo-password-123';
const firstRequest = new Trend('first_request_ms', true);
const pullFull = new Trend('pull_full_ms', true);

export const options = {
  scenarios: {
    mix: { executor: 'constant-vus', vus: 100, duration: '3m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    pull_full_ms: ['p(95)<2000'],
  },
};

const json = { headers: { 'Content-Type': 'application/json', Origin: BASE } };

export function setup() {
  if (!BASE) throw new Error('set -e BASE_URL=https://...');
  const res = http.post(
    `${BASE}/api/auth/sign-in/email`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    json,
  );
  check(res, { 'signed in': (r) => r.status === 200 });
  return { token: res.headers['Set-Auth-Token'] };
}

export default function (data) {
  const auth = { headers: { ...json.headers, Authorization: `Bearer ${data.token}` } };
  const deviceId = uuidv4();

  // A cold device pulls everything in pages, like a first sign-in.
  let cursor = '0';
  let more = true;
  let pages = 0;
  const started = Date.now();
  while (more && pages < 30) {
    const t0 = Date.now();
    const res = http.get(
      `${BASE}/api/v1/sync/pull?cursor=${cursor}&limit=1000&deviceId=${deviceId}`,
      auth,
    );
    if (pages === 0 && __ITER === 0) firstRequest.add(Date.now() - t0);
    if (!check(res, { 'pull 200': (r) => r.status === 200 })) break;
    const body = res.json();
    cursor = body.cursor;
    more = body.hasMore;
    pages++;
  }
  pullFull.add(Date.now() - started);

  // An incremental pull, then a push of a few review events for a card the learner owns.
  const inc = http.get(`${BASE}/api/v1/sync/pull?cursor=${cursor}&deviceId=${deviceId}`, auth);
  check(inc, { 'incremental pull 200': (r) => r.status === 200 });
  const card = (inc.json().cards || [])[0];
  if (card) {
    const events = [1, 2, 3].map((i) => ({
      type: 'review',
      id: uuidv4(),
      cardId: card.id,
      sessionId: uuidv4(),
      grade: 3,
      reviewedAt: new Date(Date.now() - i * 1000).toISOString(),
      durationMs: 2000,
      schedulerVersion: 'k6',
      stateBefore: card.fsrs,
      stateAfter: card.fsrs,
    }));
    const res = http.post(`${BASE}/api/v1/sync/push`, JSON.stringify({ deviceId, events }), auth);
    check(res, { 'push 200 or 429': (r) => r.status === 200 || r.status === 429 });
  }
  sleep(1 + Math.random() * 2);
}
