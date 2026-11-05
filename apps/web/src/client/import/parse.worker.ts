/// <reference lib="webworker" />
import { ImportParseError, parseImportFile, type Delimiter } from './parse';

export interface ParseRequest {
  bytes: Uint8Array;
  delimiter?: Delimiter;
  hasHeader?: boolean;
}
export type ParseResponse =
  | { ok: true; result: ReturnType<typeof parseImportFile> }
  | { ok: false; code: ImportParseError['code'] | 'unknown' };

// Parsing 10,000 rows on the main thread would stall the UI, so it runs here (T108).
self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { bytes, ...overrides } = e.data;
  try {
    const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
    self.postMessage({ ok: true, result: parseImportFile(bytes, clean) } satisfies ParseResponse);
  } catch (err) {
    self.postMessage({
      ok: false,
      code: err instanceof ImportParseError ? err.code : 'unknown',
    } satisfies ParseResponse);
  }
};
