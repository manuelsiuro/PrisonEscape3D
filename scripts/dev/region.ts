import { PRISONS } from '../../src/content/prisons';
const [id, x0, z0, x1, z1] = process.argv.slice(2);
const def = PRISONS.find((p) => p.id === id)!;
const rows = def.ground.split('\n').filter((r) => r.length >= 64);
let head = '    ';
for (let x = +x0; x <= +x1; x++) head += String(x % 10);
console.log(head);
for (let z = +z0; z <= +z1; z++) console.log(String(z).padStart(3) + ' ' + rows[z].slice(+x0, +x1 + 1));
