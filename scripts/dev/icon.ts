/**
 * The app icon, from code: a background and the art, written three ways.
 * - public/icon.svg: full bleed (the 192 and 512 PNGs and the 180 px apple-touch-icon);
 * - public/icon-maskable.svg: the art inside the middle ~80%, because Android cuts icons to
 *   a circle or squircle (listed with "purpose": "maskable" in the manifest);
 * - public/favicon.svg: a close-up of the main figure for browser tabs (a whole scene is a
 *   smudge at 16–32 px).
 *
 *   npx tsx scripts/dev/icon.ts && npm run icons     (npm run icons needs rsvg-convert: brew install librsvg)
 *
 * Replace BACKGROUND and ART with the new game's picture; check a preview of the PNGs in a
 * circle, a squircle and at 64/48/32 px before shipping. Drawing from geometry (Cratelands
 * builds an isometric island from a projection function) beats hand-placed paths.
 */
import { writeFileSync } from 'node:fs';

const DEFS = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16223a"/><stop offset="1" stop-color="#2d3f63"/></linearGradient>
  <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb066"/><stop offset="1" stop-color="#ff7714"/></linearGradient>
  <pattern id="brick" width="64" height="32" patternUnits="userSpaceOnUse"><rect width="64" height="32" fill="#7d7468"/><rect x="2" y="2" width="60" height="12" rx="2" fill="#a5543e"/><rect x="-30" y="18" width="60" height="12" rx="2" fill="#93492f"/><rect x="34" y="18" width="60" height="12" rx="2" fill="#9c4f36"/></pattern>`;

/** What fills the whole square: a night sky, a moon, the prison wall. */
const BACKGROUND = `<rect width="512" height="512" fill="url(#sky)"/>
  <circle cx="404" cy="92" r="38" fill="#f4ecd0"/>
  <circle cx="420" cy="82" r="34" fill="#16223a" opacity="0.9"/>
  <g fill="#ffffff" opacity="0.7"><circle cx="80" cy="70" r="3"/><circle cx="150" cy="120" r="2"/><circle cx="300" cy="50" r="2.5"/><circle cx="470" cy="190" r="2"/></g>
  <rect y="150" width="512" height="362" fill="url(#brick)"/>`;

/** What must stay visible: the lit cell window, one bar bent aside. */
const ART = `<rect x="126" y="160" width="260" height="260" rx="18" fill="#3a4250"/>
  <rect x="146" y="180" width="220" height="220" rx="8" fill="url(#glow)"/>
  <g stroke="#1d2430" stroke-width="20" stroke-linecap="round">
    <path d="M190 182V398M234 182V398M322 182V398"/>
    <path d="M278 182C278 250 300 280 340 300C300 320 278 340 278 398"/>
  </g>
  <rect x="140" y="270" width="232" height="16" rx="6" fill="#1d2430"/>`;

/** The middle of the art (the maskable version shrinks around it). */
const CENTRE = [256, 280];
/** The favicon's close-up: the point it zooms on, and how far. */
const CLOSE = { at: [256, 290], zoom: 1.75 };

const svg = (inner: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>${DEFS}${defs}</defs>
  ${inner}
</svg>
`;
const [cx, cy] = CENTRE;
writeFileSync('public/icon.svg', svg(`${BACKGROUND}\n  ${ART}`));
writeFileSync('public/icon-maskable.svg', svg(`${BACKGROUND}\n  <g transform="translate(256 256) scale(0.8) translate(${-cx} ${-cy})">${ART}</g>`));
writeFileSync(
  'public/favicon.svg',
  svg(`<g clip-path="url(#r)"><g transform="translate(256 256) scale(${CLOSE.zoom}) translate(${-CLOSE.at[0]} ${-CLOSE.at[1]})">${BACKGROUND}${ART}</g></g>`, '<clipPath id="r"><rect width="512" height="512" rx="112"/></clipPath>'),
);
console.log('wrote public/icon.svg, public/icon-maskable.svg, public/favicon.svg');
