#!/usr/bin/env node
/**
 * Porovná `data/charset.json` (sady `$4000`–`$4BBF` a tabulka dlaždic `$3C40`
 * ze souboru programu) s **pamětí běžícího originálu**: `build/mem_menu.bin`
 * (menu, po START) a `build/ref/caveA.mem.bin` (jeskyně A/1 po narození).
 *
 *   ./tools/matchcharset.mjs [--verbose]
 *
 * ★ Kód hry glyfy za běhu přepisuje (`charset.runtimePatched`: znak 0 sady A,
 * kouzelná zeď, Rockford, prázdno při odkrývání) — ty rozsahy se z kontroly
 * vyjmou a **zvlášť se spočítá, kolik bajtů se v nich opravdu lišilo**;
 * všechno mimo ně musí být shodné bajt po bajtu. Tabulka `$3C40` je v
 * obou dumpech.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');
const charset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/charset.json'), 'utf8'));
const addr = (s) => parseInt(String(s).replace('$', ''), 16);
let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; console.log('  CHYBA: '+label); }
}
const patched = new Set();
for (const r of charset.runtimePatched) for (let i = 0; i < r.length; i++) patched.add(addr(r.address)+i);

for (const dumpName of ['build/mem_menu.bin', 'build/ref/caveA.mem.bin']) {
  const file = path.join(ROOT, dumpName);
  if (!fs.existsSync(file)) { console.log(`${dumpName}: není — přeskočeno`); continue; }
  const mem = fs.readFileSync(file);
  let inPatched = 0, patchedDiff = 0;
  for (const block of charset.blocks) {
    const data = Buffer.from(block.data, 'base64'), base = addr(block.address);
    let diff = [];
    for (let i = 0; i < data.length; i++) {
      if (patched.has(base+i)) { inPatched++; if (mem[base+i] !== data[i]) patchedDiff++; continue; }
      checks++;
      if (mem[base+i] !== data[i]) { failures++; diff.push(base+i); }
    }
    if (diff.length) console.log(`  CHYBA: ${dumpName} sada ${block.name}: ${diff.length} rozdílů mimo animované glyfy, první $${diff[0].toString(16)}`);
    if (verbose) console.log(`${dumpName} sada ${block.name}: ${data.length} B, ${diff.length} rozdílů`);
  }
  const tiles = mem.subarray(addr(charset.tiles.table), addr(charset.tiles.table)+64);
  check(charset.tiles.base.every((b, i) => b === tiles[i]), `${dumpName}: tabulka dlaždic $3C40`);
  console.log(`${dumpName}: v animovaných glyfech (${inPatched} B) se za běhu lišilo ${patchedDiff} B`);
}
console.log(`matchcharset.mjs: ${checks} kontrol, ${failures} rozdílů`);
process.exit(failures ? 1 : 0);
