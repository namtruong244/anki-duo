import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_TYPES, renderCard, type NoteTypeDef } from '../src/index.js';

/** SC-008: no payload may survive `renderCard` as script, handler, form control, svg, math or data-*. */
const PAYLOADS: string[] = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//evil.test/x.js></SCRIPT>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<img src=x onerror=alert(1) //',
  '<IMG SRC=javascript:alert(1)>',
  '<img src="javascript:alert(1)">',
  '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">',
  '<body onload=alert(1)>',
  '<div onmouseover="alert(1)">hover</div>',
  '<div onclick=alert(1) data-x="1">x</div>',
  '<span data-ad-slot="0" data-evil="1">x</span>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="  JaVaScRiPt:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<math><maction actiontype="statusline#" xlink:href="javascript:alert(1)">x</maction></math>',
  '<input autofocus onfocus=alert(1)>',
  '<input type="text" value="x">',
  '<button onclick=alert(1)>x</button>',
  '<form action="//evil.test"><input name=a><button>go</button></form>',
  '<select autofocus onfocus=alert(1)><option>a</option></select>',
  '<textarea autofocus onfocus=alert(1)></textarea>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<link rel=stylesheet href=//evil.test/x.css>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="javascript:alert(1)//">',
  '<style>@import "//evil.test/x.css";</style>',
  '<style>*{background:url(javascript:alert(1))}</style>',
  '<div style="width:expression(alert(1))">x</div>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<div style="background:url(&quot;javascript:alert(1)&quot;)">x</div>',
  '<div style="background:\\75rl(javascript:alert(1))">x</div>',
  '<div style="behavior:url(x.htc)">x</div>',
  '<div style="-moz-binding:url(//evil.test/x.xml#x)">x</div>',
  '<div style="background-image:image-set(\'javascript:alert(1)\' 1x)">x</div>',
  '<template><script>alert(1)</script></template>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<details open ontoggle=alert(1)>x</details>',
  '<video><source onerror=alert(1)></video>',
  '<audio src=x onerror=alert(1)>',
  '<marquee onstart=alert(1)>x</marquee>',
  '<isindex action=javascript:alert(1) type=image>',
  '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
  '<p/onmouseover=alert(1)>x',
  '<img/src=x/onerror=alert(1)>',
  '<<script>alert(1)//<</script>',
  '<img src=x onerror=alert&#40;1&#41;>',
  '{{c1::<img src=x onerror=alert(1)>}}',
  '{{c1::<script>alert(1)</script>::hint}}',
  '{{c1::a {{c2::<svg onload=alert(1)>}} b}}',
  '<span class="ad-slot" id="ad-slot-0" onclick=alert(1)></span>',
  '<!--><script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<?xml version="1.0"?><script>alert(1)</script>',
];

const base = DEFAULT_NOTE_TYPES[0]!.def;

function tagsOf(html: string): string[] {
  return html.match(/<[^>]*>/g) ?? [];
}

function expectClean(html: string): void {
  const tags = tagsOf(html);
  for (const t of tags) {
    expect(t).not.toMatch(
      /^<\/?\s*(script|svg|math|input|button|form|select|textarea|iframe|object|embed|style|link|meta|base|template|noscript|video|audio|source|marquee)\b/i,
    );
    expect(t).not.toMatch(/[\s"'/]on[a-z]+\s*=/i);
    expect(t).not.toMatch(/\sdata-/i);
    expect(t).not.toMatch(/javascript\s*:|vbscript\s*:|expression\s*\(|behavior\s*:|-moz-binding/i);
    expect(t).not.toMatch(/\sid="ad-(?!slot-\d+")/);
  }
  // An app slot is the only element allowed to carry the reserved prefix, and only from the app.
  expect(html).not.toMatch(/<[^>]*\bsrc="(?!https:|media:)/i);
}

describe('script-injection payloads (SC-008)', () => {
  it('has at least 30 payloads', () => {
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(PAYLOADS.map((p, i) => [i, p] as const))('field value #%i is neutralised', (_i, p) => {
    const r = renderCard(base, { f_front: p, f_back: p }, null, {
      templateId: 't_card1',
      ordinal: 0,
    });
    expectClean(r.front);
    expectClean(r.back);
  });

  it.each(PAYLOADS.map((p, i) => [i, p] as const))('template #%i is neutralised', (_i, p) => {
    const def: NoteTypeDef = {
      ...base,
      templates: [
        { id: 'x', name: 'X', front: `${p}{{Front}}`, back: `{{FrontSide}}${p}{{Back}}` },
      ],
    };
    const r = renderCard(def, { f_front: 'Q', f_back: 'A' }, null, { templateId: 'x', ordinal: 0 });
    expectClean(r.front);
    expectClean(r.back);
  });

  it.each(PAYLOADS.map((p, i) => [i, p] as const))('filtered field #%i is neutralised', (_i, p) => {
    const def: NoteTypeDef = {
      ...base,
      templates: [{ id: 'x', name: 'X', front: '{{text:Front}}|{{Back}}', back: '{{Front}}' }],
    };
    const r = renderCard(def, { f_front: p, f_back: p }, null, { templateId: 'x', ordinal: 0 });
    expectClean(r.front);
    expectClean(r.back);
  });

  it('payload in the deck name and tags is escaped', () => {
    const def: NoteTypeDef = {
      ...base,
      templates: [{ id: 'x', name: 'X', front: '{{Front}}{{Tags}}{{Deck}}', back: '' }],
    };
    const r = renderCard(def, { f_front: 'Q' }, null, {
      templateId: 'x',
      ordinal: 0,
      tags: ['<img src=x onerror=alert(1)>'],
      deckName: '<script>alert(1)</script>',
    });
    expectClean(r.front);
  });

  it('private marker characters in input cannot forge slots', () => {
    const r = renderCard(base, { f_front: 'a0b', f_back: '' }, null, {
      templateId: 't_card1',
      ordinal: 0,
    });
    expect(r.front).not.toContain('ad-slot');
  });
});
