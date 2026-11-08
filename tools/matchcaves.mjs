#!/usr/bin/env node
/**
 * Nezávislá kontrola `data/caves.json` proti dvěma cizím opisům týchž dat:
 *
 * 1. **C64 surová data** (Broadribb, `sources/docs/raw/broadribb_rawCaveData.html`,
 *    druhá ruka): port od téhož autora nese tytéž jeskyně; ★ liší se jen
 *    pět bajtů barev `$13`–`$17` (VIC-II místo GTIA; `$16`–`$17` má C64
 *    „nepoužité", u většiny jeskyní tam má jiné hodnoty než Atari, u A
 *    tytéž). Očekávání: nula rozdílů mimo `$13`–`$17`. Opis mezihry 3
 *    na té stránce postrádá první bajt — doplní se a zapíše.
 * 2. **Cartridge** (`sources/rom/boulder_dash_cart_16k.rom`, jiné sestavení,
 *    `sources/rom/README.md`): tabulka jeskyní i ukazatelů bajt po bajtu.
 *    Přeskočí se, když ROM není (je mimo git).
 *
 *   ./tools/matchcaves.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');
const caves = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/caves.json'), 'utf8'));
let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; console.log('  CHYBA: '+label); }
}

// 1. C64
const html = fs.readFileSync(path.join(ROOT, 'sources/docs/raw/broadribb_rawCaveData.html'), 'latin1').replace(/<[^>]+>/g, '');
const c64 = [];
for (const m of html.matchAll(/Cave (\d+) \((Cave [A-P]|Intermission \d)\)[\s\S]*?decoded version\.\s*([0-9A-F \n\r]+?)\s*FF\s*\n/g)) {
  c64[parseInt(m[1], 10)-1] = m[3].trim().split(/\s+/).map((h) => parseInt(h, 16)).concat([0xFF]);
}
check(c64.filter(Boolean).length === 20, 'C64: nalezeno 20 jeskyní');
const C64_COLORS = [0x13, 0x14, 0x15, 0x16, 0x17];
caves.caves.forEach((cave, i) => {
  const a = Buffer.from(cave.raw, 'hex');
  let b = c64[i] || [];
  // ★ Broadribbův opis mezihry 3 postrádá první bajt (číslo jeskyně $13) —
  // chyba opisu, ne dat: po doplnění sedí bajt po bajtu
  if (b.length === a.length-1 && b[0] === a[1]) { b = [a[0]].concat(b); console.log(`${cave.name}: C64 opis bez prvního bajtu, doplněn`); }
  check(a.length === b.length, `${cave.name}: délka Atari ${a.length} ≠ C64 ${b.length}`);
  let diff = [];
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (C64_COLORS.includes(k)) continue;
    checks++;
    if (a[k] !== b[k]) { failures++; diff.push(k); }
  }
  if (diff.length) console.log(`  CHYBA: ${cave.name}: ${diff.length} rozdílů mimo barvy na ${diff.map((k) => '$'+k.toString(16)).join(' ')}`);
  if (verbose) console.log(`${cave.name}: ${a.length} B, C64 barvy ${C64_COLORS.map((k) => b[k].toString(16)).join(' ')} vs Atari ${C64_COLORS.map((k) => a[k].toString(16)).join(' ')}`);
});

// 2. cartridge
const romPath = path.join(ROOT, 'sources/rom/boulder_dash_cart_16k.rom');
if (fs.existsSync(romPath)) {
  const rom = fs.readFileSync(romPath);
  const first = Buffer.from(caves.caves[0].raw, 'hex').subarray(0, 16);
  const at = rom.indexOf(first);
  check(at >= 0, 'cartridge: tabulka jeskyní nalezena');
  if (at >= 0) {
    const table = parseInt(caves.table.slice(1), 16), ptrs = parseInt(caves.pointers.slice(1), 16);
    for (const cave of caves.caves) {
      const a = Buffer.from(cave.raw, 'hex'), off = parseInt(cave.address.slice(1), 16)-table;
      let diff = 0;
      for (let k = 0; k < a.length; k++) { checks++; if (a[k] !== rom[at+off+k]) { failures++; diff++; } }
      if (diff) console.log(`  CHYBA: cartridge ${cave.name}: ${diff} rozdílů`);
    }
    const romPtrs = at-(table-ptrs);
    caves.caves.forEach((cave, i) => {
      const p = parseInt(cave.address.slice(1), 16)-table;
      check(rom[romPtrs+2*i] === (p & 0xFF) && rom[romPtrs+2*i+1] === (p >> 8), `cartridge: ukazatel ${cave.name}`);
    });
    console.log(`cartridge: tabulka na $${(0x8000+at).toString(16).toUpperCase()}, ukazatele na $${(0x8000+romPtrs).toString(16).toUpperCase()}`);
  }
} else {
  console.log('cartridge: sources/rom/boulder_dash_cart_16k.rom není — přeskočeno');
}
console.log(`matchcaves.mjs: ${checks} kontrol, ${failures} rozdílů`);
process.exit(failures ? 1 : 0);
