import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_TYPES,
  htmlToText,
  newNoteTypeId,
  renameFieldInTemplates,
  renderCard,
  sanitizeCss,
  sanitizeHtml,
  validateNoteType,
  type NoteTypeDef,
} from '../src/index.js';

const basic = DEFAULT_NOTE_TYPES[0]!.def;
const reversed = DEFAULT_NOTE_TYPES[1]!.def;
const optional = DEFAULT_NOTE_TYPES[2]!.def;

describe('renderCard', () => {
  it('renders basic front/back with FrontSide', () => {
    const r = renderCard(basic, basic.templates[0]!, { f_front: 'Hi', f_back: '<b>Yo</b>' });
    expect(r.front).toBe('Hi');
    expect(r.back).toBe('Hi<hr id="answer">' + '<b>Yo</b>');
    expect(r.frontEmpty).toBe(false);
  });
  it('reverse template swaps fields', () => {
    const r = renderCard(reversed, reversed.templates[1]!, { f_front: 'Q', f_back: 'A' });
    expect(r.front).toBe('A');
    expect(r.back).toContain('Q');
  });
  it('optional reverse is empty unless field is set', () => {
    const t = optional.templates[1]!;
    expect(renderCard(optional, t, { f_front: 'Q', f_back: 'A', f_addrev: '' }).frontEmpty).toBe(
      true,
    );
    const r = renderCard(optional, t, { f_front: 'Q', f_back: 'A', f_addrev: 'y' });
    expect(r.frontEmpty).toBe(false);
    expect(r.front).toBe('A');
  });
  it('frontEmpty ignores whitespace/empty html but counts img and sound', () => {
    const t = basic.templates[0]!;
    expect(renderCard(basic, t, { f_front: '<div><br></div> &nbsp;' }).frontEmpty).toBe(true);
    expect(renderCard(basic, t, { f_front: '<img src="https://x.test/a.png">' }).frontEmpty).toBe(
      false,
    );
    expect(renderCard(basic, t, { f_front: '[sound:abc]' }).frontEmpty).toBe(false);
  });
  it('supports sections, inverse sections, nesting, text:, Tags, Deck', () => {
    const def: NoteTypeDef = {
      fields: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      templates: [],
      css: '',
    };
    const t = {
      id: 't',
      name: 'T',
      front: '{{#A}}[{{#B}}both{{/B}}{{^B}}onlyA{{/B}}]{{/A}}{{^A}}noA{{/A}}',
      back: '{{text:A}}|{{Tags}}|{{Deck}}| {{ A }}',
    };
    expect(renderCard(def, t, { a: 'x', b: '' }).front).toBe('[onlyA]');
    expect(renderCard(def, t, { a: 'x', b: 'y' }).front).toBe('[both]');
    expect(renderCard(def, t, { a: '', b: 'y' }).front).toBe('noA');
    const r = renderCard(def, t, { a: '<b>x&y</b>' }, { tags: ['t1', 't2'], deckName: 'D<1>' });
    expect(r.back).toBe('x&amp;y|t1 t2|D&lt;1&gt;| <b>x&amp;y</b>');
  });
  it('unknown field yields error span', () => {
    const t = { id: 't', name: 'T', front: '{{Nope}}', back: '' };
    const r = renderCard(basic, t, {});
    expect(r.front).toBe('<span class="tpl-error">Unknown field: Nope</span>');
    expect(r.frontEmpty).toBe(false);
  });
  it('sanitizes injected field html', () => {
    const r = renderCard(basic, basic.templates[0]!, {
      f_front: '<script>alert(1)</script>ok<img src=x onerror=alert(1)>',
    });
    expect(r.front).toBe('ok');
  });
});

describe('renameFieldInTemplates', () => {
  it('rewrites all tag forms and leaves others', () => {
    const def: NoteTypeDef = {
      fields: [],
      css: '',
      templates: [
        {
          id: 't',
          name: 'T',
          front: '{{Old}}{{text:Old}}{{#Old}}x{{/Old}}',
          back: '{{^ Old }}y{{/ Old }}{{Older}}{{Other}}',
        },
      ],
    };
    const r = renameFieldInTemplates(def, 'Old', 'New Name');
    expect(r.templates[0]!.front).toBe('{{New Name}}{{text:New Name}}{{#New Name}}x{{/New Name}}');
    expect(r.templates[0]!.back).toBe('{{^New Name}}y{{/New Name}}{{Older}}{{Other}}');
    expect(def.templates[0]!.front).toContain('Old');
  });
});

describe('validateNoteType', () => {
  it('accepts defaults', () => {
    for (const d of DEFAULT_NOTE_TYPES) expect(validateNoteType(d.def)).toEqual([]);
  });
  const mk = (p: Partial<NoteTypeDef>): NoteTypeDef => ({ ...basic, ...p });
  it('rejects empty fields/templates', () => {
    expect(validateNoteType(mk({ fields: [] })).length).toBeGreaterThan(0);
    expect(validateNoteType(mk({ templates: [] })).length).toBeGreaterThan(0);
  });
  it('rejects bad/duplicate field names and ids', () => {
    expect(validateNoteType(mk({ fields: [{ id: 'a', name: '' }] }))).not.toEqual([]);
    expect(
      validateNoteType(
        mk({
          fields: [
            { id: 'f_front', name: 'A:B' },
            { id: 'f_back', name: 'Back' },
          ],
        }),
      ),
    ).not.toEqual([]);
    expect(
      validateNoteType(
        mk({
          fields: [
            { id: 'f_front', name: 'Front' },
            { id: 'f_back', name: 'Front' },
          ],
        }),
      ),
    ).not.toEqual([]);
    expect(
      validateNoteType(
        mk({
          fields: [
            { id: 'x', name: 'Front' },
            { id: 'x', name: 'Back' },
          ],
        }),
      ),
    ).not.toEqual([]);
  });
  it('rejects template problems', () => {
    const t = basic.templates[0]!;
    expect(validateNoteType(mk({ templates: [t, { ...t, id: 'other' }] }))).not.toEqual([]); // dup name
    expect(validateNoteType(mk({ templates: [t, { ...t, name: 'X' }] }))).not.toEqual([]); // dup id
    expect(validateNoteType(mk({ templates: [{ ...t, front: 'static' }] }))).not.toEqual([]);
    expect(
      validateNoteType(mk({ templates: [{ ...t, front: '{{#Front}}{{Front}}' }] })),
    ).not.toEqual([]);
    expect(
      validateNoteType(mk({ templates: [{ ...t, front: '{{Front}}{{/Front}}' }] })),
    ).not.toEqual([]);
    expect(validateNoteType(mk({ templates: [{ ...t, back: '{{Missing}}' }] }))).not.toEqual([]);
    expect(
      validateNoteType(mk({ templates: [{ ...t, front: '{{FrontSide}}{{Front}}' }] })),
    ).not.toEqual([]);
  });
  it('rejects oversized css', () => {
    expect(validateNoteType(mk({ css: 'a'.repeat(100_001) }))).not.toEqual([]);
  });
});

describe('newNoteTypeId', () => {
  it('has prefix and 10 base36 chars', () => {
    expect(newNoteTypeId('f')).toMatch(/^f_[0-9a-z]{10}$/);
    expect(newNoteTypeId('t')).toMatch(/^t_[0-9a-z]{10}$/);
    expect(newNoteTypeId('f')).not.toBe(newNoteTypeId('f'));
  });
});

describe('htmlToText', () => {
  it('decodes, separates blocks, collapses whitespace', () => {
    expect(htmlToText('<div>a &amp; b</div><div>c</div>')).toBe('a & b\nc');
    expect(htmlToText('x<br>y&nbsp;&nbsp; z')).toBe('x\ny z');
    expect(htmlToText('<script>evil()</script>hi')).toBe('hi');
    expect(htmlToText('  <p> </p> ')).toBe('');
  });
});

describe('sanitizeHtml', () => {
  it('keeps allowed markup and attrs', () => {
    expect(sanitizeHtml('<p class="a" style="color:red">x<br><b>y</b></p>')).toBe(
      '<p class="a" style="color:red">x<br><b>y</b></p>',
    );
    expect(sanitizeHtml('<td colspan=2>x</td>')).toBe('<td colspan="2">x</td>');
    expect(sanitizeHtml('<img src="media:123e4567-e89b-12d3-a456-426614174000" alt="a">')).toBe(
      '<img src="media:123e4567-e89b-12d3-a456-426614174000" alt="a">',
    );
    expect(sanitizeHtml('a < b & c')).toBe('a &lt; b &amp; c');
  });
  it('unwraps disallowed tags but drops dangerous content', () => {
    expect(sanitizeHtml('<blink>hi</blink>')).toBe('hi');
    expect(sanitizeHtml('<form action=x><input name=a>t</form>')).toBe('t');
    expect(sanitizeHtml('a<style>body{}</style>b')).toBe('ab');
    expect(sanitizeHtml('<iframe src="https://x">fallback</iframe>z')).toBe('z');
    expect(sanitizeHtml('<object><param name=a></object>q')).toBe('q');
  });
  it('closes unclosed tags', () => {
    expect(sanitizeHtml('<div><b>x')).toBe('<div><b>x</b></div>');
    expect(sanitizeHtml('<script>alert(1)')).toBe('');
    expect(sanitizeHtml('<img src="https://a.test/x.png"')).not.toMatch(/<img[^>]*onerror/);
  });
});

describe('XSS battery', () => {
  const bad = (html: string) => {
    const out = sanitizeHtml(html);
    expect(out.toLowerCase()).not.toMatch(
      /<script|<svg|<iframe|\son\w+\s*=|javascript:|data:|expression\(/,
    );
    return out;
  };
  it('script tags in various forms', () => {
    expect(bad('<script>alert(1)</script>')).toBe('');
    expect(bad('<SCRIPT SRC=//evil.js></SCRIPT>')).toBe('');
    expect(bad('<scr<script>ipt>alert(1)</scr</script>ipt>')).not.toContain('<script');
    expect(bad('<script/x>alert(1)</script>')).toBe('');
  });
  it('event handlers', () => {
    expect(bad('<img src="https://a.test/x.png" onerror="alert(1)">')).toBe(
      '<img src="https://a.test/x.png">',
    );
    expect(bad('<img src=x onerror=alert(1)>')).toBe('');
    expect(bad('<div onclick="x()" onmouseover=y()>a</div>')).toBe('<div>a</div>');
    expect(bad('<body onload=alert(1)>t')).toBe('t');
  });
  it('javascript: hrefs', () => {
    expect(bad('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(bad('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(bad('<a href="  javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(bad('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(bad('<a href="java&#x09;script:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(bad('<a href="&#106;avascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(
      bad('<a href="&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;alert(1)">x</a>'),
    ).toBe('<a>x</a>');
    expect(bad('<a href="vbscript:x">x</a>')).toBe('<a>x</a>');
  });
  it('safe hrefs are kept', () => {
    expect(sanitizeHtml('<a href="https://a.test/?q=1&b=2">x</a>')).toBe(
      '<a href="https://a.test/?q=1&amp;b=2">x</a>',
    );
    expect(sanitizeHtml('<a href="mailto:a@b.c">x</a>')).toBe('<a href="mailto:a@b.c">x</a>');
  });
  it('data: and non-https image URLs', () => {
    expect(bad('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe('');
    expect(bad('<img src="data:text/html,<script>alert(1)</script>">')).toBe('');
    expect(bad('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<img src="http://a.test/x.png">')).toBe('');
    expect(sanitizeHtml('<img src="media:not-a-uuid">')).toBe('');
    expect(sanitizeHtml('<img src="//a.test/x.png">')).toBe('');
  });
  it('svg / math / template', () => {
    expect(bad('<svg onload=alert(1)><circle/></svg>x')).toBe('x');
    expect(bad('<svg><script>alert(1)</script></svg>')).toBe('');
    expect(bad('<math><mi xlink:href="javascript:alert(1)">x</mi></math>')).toBe('');
    expect(bad('<template><img src=x onerror=alert(1)></template>')).toBe('');
  });
  it('style attribute filtering', () => {
    expect(bad('<div style="width:expression(alert(1))">a</div>')).not.toContain('expression');
    expect(bad('<div style="background:url(javascript:alert(1))">a</div>')).toBe(
      '<div style="background:none">a</div>',
    );
    expect(
      bad('<div style="background:url(&quot;javascript:alert(1)&quot;)">a</div>'),
    ).not.toContain('javascript');
    expect(bad('<div style="background:u\\72l(javascript:alert(1))">a</div>')).not.toContain(
      'javascript',
    );
    expect(bad('<div style="color:red;behavior:url(x.htc)">a</div>')).not.toMatch(
      /behavior|x\.htc/,
    );
    expect(sanitizeHtml('<div style="background:url(https://a.test/i.png)">a</div>')).toContain(
      'url(&quot;https://a.test/i.png&quot;)',
    );
  });
  it('attribute quote breaking', () => {
    const out = sanitizeHtml('<a href=\'https://a.test/"onmouseover="alert(1)\'>x</a>');
    expect(out).toBe('<a href="https://a.test/&quot;onmouseover=&quot;alert(1)">x</a>');
    const out2 = sanitizeHtml("<div title='\"><script>alert(1)</script>'>x</div>");
    expect(out2).toBe('<div title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">x</div>');
    expect(sanitizeHtml('<div class="a" onclick="b"x>y</div>')).not.toContain('onclick');
  });
  it('entity-encoded tags remain text', () => {
    expect(sanitizeHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });
  it('is idempotent', () => {
    const inputs = [
      '<div><b>x</b> &amp; <a href="https://a.test">l</a></div>',
      'a < b',
      '<p style="color:red">q</p>',
    ];
    for (const i of inputs) expect(sanitizeHtml(sanitizeHtml(i))).toBe(sanitizeHtml(i));
  });
});

describe('sanitizeCss', () => {
  it('keeps normal css', () => {
    const css = '.card { color: red; font-size: 20px; }';
    expect(sanitizeCss(css)).toBe(css);
  });
  it('strips dangerous constructs', () => {
    expect(sanitizeCss('@import url(https://a.test/x.css);.a{color:red}')).toBe('.a{color:red}');
    expect(sanitizeCss('@charset "x";.a{}')).toBe('.a{}');
    expect(sanitizeCss('.a{width:expression(alert(1))}')).not.toMatch(/expression\(/i);
    expect(sanitizeCss('.a{behavior:url(x)}')).not.toMatch(/behavior:/i);
    expect(sanitizeCss('.a{-moz-binding:url(x)}')).not.toMatch(/-moz-binding/i);
    expect(sanitizeCss('.a{background:url(javascript:alert(1))}')).toBe('.a{background:none}');
    expect(sanitizeCss('.a{background:url(data:image/png;base64,AAA)}')).toBe(
      '.a{background:none}',
    );
    expect(sanitizeCss('.a{background:url(http://a.test/x.png)}')).toBe('.a{background:none}');
  });
  it('allows https and media urls', () => {
    expect(sanitizeCss('.a{background:url(https://a.test/x.png)}')).toContain(
      'https://a.test/x.png',
    );
    expect(
      sanitizeCss('.a{background:url("media:123e4567-e89b-12d3-a456-426614174000")}'),
    ).toContain('media:123e4567');
  });
  it('blocks </style> breakout, including split and comment forms', () => {
    for (const s of [
      '</style><script>alert(1)</script>',
      '</STYLE >',
      '</sty/**/le>',
      '<</style/style>/style>',
      '.a{}</st\\79le>',
    ]) {
      expect(sanitizeCss(s).toLowerCase()).not.toMatch(/<\/\s*style/);
    }
  });
  it('caps length', () => {
    expect(sanitizeCss('a'.repeat(200_000)).length).toBeLessThanOrEqual(100_000);
  });
});
