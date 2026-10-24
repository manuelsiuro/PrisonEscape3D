// Dev tool: receives How to play's pictures from helpshot.ts in the dev build and writes them to
// public/help/, and the map viewer's in-game pictures from mapshot.ts (and their frames' numbers)
// to assets/maps/ (the browser can't write files). Run: npx tsx scripts/dev/shotsink.ts (port 5311).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const DIR = 'public/help';
const MAPS = 'assets/maps';
mkdirSync(DIR, { recursive: true });
/** A help picture, or a map viewer's in-game picture and its frame (N-<prison>-game, N-<prison>-outside-game). */
const HELP = /^[a-z]+\.webp$/;
const MAP = /^[0-9]-[a-z-]+-(game|outside-game)\.(png|json)$/;
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5310');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return void res.end();
  const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
  if (req.method !== 'POST' || !(HELP.test(name) || MAP.test(name))) {
    res.statusCode = 400;
    return void res.end('POST ?name=<id>.webp or ?name=N-<prison>-game.png');
  }
  const parts: Buffer[] = [];
  req.on('data', (c: Buffer) => parts.push(c));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    writeFileSync(`${MAP.test(name) ? MAPS : DIR}/${name}`, body);
    console.log(`${name}: ${Math.round(body.length / 1000)} kB`);
    res.end('ok');
  });
}).listen(5311, '127.0.0.1', () => console.log('shotsink on http://127.0.0.1:5311'));
