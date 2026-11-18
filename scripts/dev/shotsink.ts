// Dev tool: receives How to play's pictures from helpshot.ts in the dev build and writes them to
// public/help/, and the map viewer's in-game pictures from mapshot.ts (and their frames' numbers)
// to assets/maps/, and the prison cards' pictures from cardshot.ts to public/prisons/ (the browser can't write files). Run: npx tsx scripts/dev/shotsink.ts (port 5311).
// It may already be running from an earlier session (check the port; restart it if its code changed
// since). `npm run preview` uses 5311 too. It accepts pictures from http://localhost:5310 only, so
// take them on the main checkout's dev server, not a worktree's.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const DIR = 'public/help';
const MAPS = 'assets/maps';
/** 2.63.1: each prison card's picture (cardshot.ts), sent as <prison>.card.webp. */
const CARDS = 'public/prisons';
mkdirSync(DIR, { recursive: true });
mkdirSync(CARDS, { recursive: true });
/** A help picture, or a map viewer's in-game picture and its frame (N-<prison>-game, N-<prison>-outside-game). */
const HELP = /^[a-z]+\.webp$/;
const MAP = /^[0-9]-[a-z-]+-(game|outside-game)\.(webp|json)$/;
const CARD = /^[a-z-]+\.card\.webp$/;
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5310');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return void res.end();
  const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
  if (req.method !== 'POST' || !(HELP.test(name) || MAP.test(name) || CARD.test(name))) {
    res.statusCode = 400;
    return void res.end('POST ?name=<id>.webp or ?name=N-<prison>-game.webp');
  }
  const parts: Buffer[] = [];
  req.on('data', (c: Buffer) => parts.push(c));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    const to = CARD.test(name) ? `${CARDS}/${name.replace('.card', '')}` : `${MAP.test(name) ? MAPS : DIR}/${name}`;
    writeFileSync(to, body);
    console.log(`${name}: ${Math.round(body.length / 1000)} kB`);
    res.end('ok');
  });
}).listen(5311, '127.0.0.1', () => console.log('shotsink on http://127.0.0.1:5311'));
