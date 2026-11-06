// Dev tool: receives the trailer's frames and sound from trailer.ts in the dev build and writes
// them under a folder (the browser can't write files). Run: npx tsx scripts/dev/trailersink.ts <dir>
// (port 5312). Then scripts/dev/trailercut.sh <dir> puts the film together.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const DIR = process.argv[2];
if (!DIR) throw new Error('usage: trailersink.ts <dir>');
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5310');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return void res.end();
  const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
  if (req.method !== 'POST' || !/^([a-z]+\/)?[a-z0-9-]+\.(jpg|png|wav|json)$/.test(name)) {
    res.statusCode = 400;
    return void res.end('POST ?name=[<folder>/]<file>.(jpg|png|wav|json)');
  }
  const parts: Buffer[] = [];
  req.on('data', (c: Buffer) => parts.push(c));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    const sub = name.includes('/') ? `${DIR}/${name.split('/')[0]}` : DIR;
    mkdirSync(sub, { recursive: true });
    writeFileSync(`${DIR}/${name}`, body);
    if (!/\d{5}\./.test(name) || name.endsWith('00000.jpg')) console.log(`${name}: ${Math.round(body.length / 1000)} kB`);
    res.end('ok');
  });
}).listen(5312, '127.0.0.1', () => console.log(`trailersink on http://127.0.0.1:5312 → ${DIR}`));
