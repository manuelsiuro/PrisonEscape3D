/**
 * The colours' tokens (session 7, v2.34.3): no stylesheet writes a colour where it's used. A colour lives in a
 * custom property on `:root`: in `01-base.css` when more than one file uses it, at the top of its file when one
 * alone does; a translucent one is its `-rgb` twin with the alpha where it's used (`rgba(var(--x-rgb), 0.4)`).
 * Checked here: no raw colour anywhere else (hex, rgb()/hsl() with numbers, a colour's name), each token
 * declared once, each `-rgb` twin the same colour as its token, a file's own tokens used by that file alone,
 * every `var()` defined somewhere (a misspelt one draws nothing, silently), and no colour in the title's
 * fixed inline styles. The loading screen in `index.html` is the one exception (it's up before the CSS).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './assert';

const DIR = 'src/styles';
const files = readdirSync(DIR)
  .filter((f) => /^\d.*\.css$/.test(f))
  .sort();

type Decl = { file: string; prop: string; value: string; onRoot: boolean; where: string };

/** Every declaration, with whether it sits straight in a top-level `:root` rule. Comments and strings can't fool it. */
function decls(file: string): Decl[] {
  const css = readFileSync(join(DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  let quote = '';
  let escaped = false;
  let paren = 0;
  const flush = () => {
    const t = buf.trim();
    buf = '';
    const i = t.indexOf(':');
    if (!t || i < 0 || stack.length === 0) return;
    out.push({
      file,
      prop: t.slice(0, i).trim(),
      value: t.slice(i + 1).trim(),
      onRoot: stack.length === 1 && stack[0] === ':root',
      where: stack.join(' > '),
    });
  };
  for (const ch of css) {
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      buf += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '{' && paren === 0) {
      stack.push(buf.trim());
      buf = '';
      continue;
    } else if (ch === '}' && paren === 0) {
      flush();
      stack.pop();
      continue;
    } else if (ch === ';' && paren === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  return out;
}

// The CSS colour names and the system colours (a raw colour too).
const NAMES =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext';
const RAW = new RegExp(
  String.raw`#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)?|(?<![\w-])(?:${NAMES.split(' ').join('|')})(?![\w-])`,
  'gi',
);
const unquoted = (v: string) => v.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
/** A translucent token, the one colour function allowed where a colour is used: rgba(var(--x-rgb), 0.4). */
const TWIN = /\brgba?\(\s*var\(--[\w-]+-rgb\)\s*,\s*[\d.]+%?\s*\)/g;
/** What's left to check once the allowed twins are out: a -rgb twin anywhere else draws nothing. */
const bare = (v: string) => unquoted(v).replace(TWIN, 'T');
const strayTwin = /var\(--[\w-]+-rgb\b/;
// Properties whose words aren't colours (a font named after one, an animation's name).
const WORDS =
  /^(font|font-family|animation|animation-name|transition|transition-property|grid-template-areas|grid-area|content|counter-reset|will-change)$/;

const all = files.flatMap(decls);
const tokens = new Map<string, Decl>();
let raw = 0;
for (const d of all) {
  if (d.prop.startsWith('--') && d.onRoot) {
    check(!tokens.has(d.prop), `${d.prop} is declared twice (${tokens.get(d.prop)?.file}, ${d.file}): a token has one home`);
    tokens.set(d.prop, d);
    continue;
  }
  if (WORDS.test(d.prop)) continue;
  const v = bare(d.value);
  const m = v.match(RAW);
  if (m) {
    raw++;
    check(false, `${d.file} ${d.where} { ${d.prop}: ${d.value} }: a raw colour (${m.join(', ')}); give it a token on :root`);
  }
  check(!strayTwin.test(v), `${d.file} ${d.where} { ${d.prop}: ${d.value} }: an -rgb twin outside rgba(var(--x-rgb), alpha) draws nothing`);
}

// Each -rgb twin is its token's colour.
const hexRgb = (h: string) => {
  let s = h.slice(1);
  if (s.length <= 4) s = [...s].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)).join(', ');
};
let twins = 0;
for (const [name, d] of tokens) {
  if (!name.endsWith('-rgb')) continue;
  twins++;
  const of = tokens.get(name.slice(0, -4));
  check(!!of, `${name} has no ${name.slice(0, -4)} beside it`);
  check(!of || /^#[0-9a-fA-F]{3,6}$/.test(of.value), `${of?.prop} has an -rgb twin, so it should be a plain hex (${of?.value})`);
  if (of && /^#[0-9a-fA-F]{3,6}$/.test(of.value))
    check(hexRgb(of.value) === d.value.replace(/\s+/g, ' '), `${name} (${d.value}) isn't ${of.prop} (${of.value})`);
  check(/^\d{1,3}, \d{1,3}, \d{1,3}$/.test(d.value), `${name} should be "r, g, b" (${d.value})`);
}

// Every var() is defined: on :root, in a rule, or set from the code.
const scoped = new Set(all.filter((d) => d.prop.startsWith('--') && !d.onRoot).map((d) => d.prop));
const tsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
const code = tsFiles('src').map((f) => readFileSync(f, 'utf8'));
const fromCode = new Set(code.flatMap((s) => [...s.matchAll(/setProperty\('(--[\w-]+)'|[";\s`{](--[\w-]+):/g)].map((m) => m[1] ?? m[2])));
const used = new Map<string, Set<string>>();
for (const d of all)
  for (const m of d.value.matchAll(/var\((--[\w-]+)\s*[,)]/g)) {
    const n = m[1];
    if (!used.has(n)) used.set(n, new Set());
    used.get(n)!.add(d.file);
    // (A fallback's name too: one defined nowhere means the fallback always wins, and reads as a choice.)
    check(tokens.has(n) || scoped.has(n) || fromCode.has(n), `${d.file} ${d.where}: var(${n}) is defined nowhere`);
  }
// A token's name declared again in a narrower scope changes it there: only --ink and --ink-soft are meant to
// (a dialog's text, the team game's), and no colour is written as either for that reason.
const OVERRIDDEN = new Set(['--ink', '--ink-soft']);
for (const d of all)
  if (d.prop.startsWith('--') && !d.onRoot && tokens.has(d.prop))
    check(OVERRIDDEN.has(d.prop), `${d.file} ${d.where} declares ${d.prop} again: a token keeps one value (give this its own name)`);

// The code's fixed inline styles may name tokens too.
for (const s of code) for (const m of s.matchAll(/var\((--[\w-]+)\)/g)) if (!used.has(m[1])) used.set(m[1], new Set(['(code)']));

// No dead colour: a colour token, or its -rgb twin, is used somewhere (a colour seen only through its twin
// keeps its hex beside it, for reading and for the editor's swatch).
for (const [name, d] of tokens) {
  if (name.endsWith('-rgb') || !unquoted(d.value).match(RAW)) continue;
  check(used.has(name) || used.has(`${name}-rgb`), `${name} (${d.file}) is used nowhere: drop it`);
}

// A file's own tokens are used by that file alone (a shared one goes in 01-base.css).
let local = 0;
for (const [name, d] of tokens) {
  if (d.file === '01-base.css') continue;
  local++;
  const by = [...(used.get(name) ?? [])].filter((f) => f !== d.file && f !== '(code)');
  check(by.length === 0, `${name} is ${d.file}'s own but ${by.join(', ')} uses it: move it to 01-base.css`);
}

// No colour in the code's fixed inline styles (a value worked out at run time, or a topic's own colour, is data).
let inline = 0;
for (const s of code)
  for (const m of s.matchAll(/style="([^"]*)"|cssText = `([^`]*)`|colors = \[([^\]]*)\]/g)) {
    inline++;
    const text = m[1] ?? m[2] ?? m[3];
    const fixed = bare(text.replace(/\$\{[^}]*\}/g, ''));
    const hit = fixed.match(RAW);
    check(!hit, `an inline style writes a colour (${hit?.join(', ')}): ${text}`);
    check(!strayTwin.test(fixed), `an inline style uses an -rgb twin outside rgba(): ${text}`);
  }

const colourTokens = [...tokens.values()].filter((d) => !d.prop.endsWith('-rgb') && unquoted(d.value).match(RAW));
console.log(`${files.length} stylesheets, ${all.length} declarations, ${raw} raw colours outside tokens`);
console.log(`${tokens.size} tokens on :root (${colourTokens.length} colours, ${twins} -rgb twins), ${local} of them a file's own`);
console.log(`${used.size} custom properties used, every one defined; ${inline} inline styles in the code, none with a colour`);
