#!/usr/bin/env node
/**
 * Porovná jeskyně vygenerované **kódem hry** (`app/caveGen.js` — týž skript,
 * který běží ve workeru — a `app/caveScreen.js`, které kreslí model) se
 * záznamem běžícího originálu `build/ref/cavegen.json`
 * (`tools/tracecavegen.py`: 20 jeskyní × 5 obtížností, 150 snímků po fire).
 *
 *   ./tools/matchcavegen.mjs [--verbose]
 *
 * Kontroly na každou ze 100 jeskyní:
 * - kopie hlavičky a instrukcí `$5F00` = bajty z `data/caves.json`
 * - **mřížka** `$4C00`: řádky 2–23 × 40 buněk kód po kódu
 * - stav PRNG `$0781/$0782` po generování, start Rockforda `$079E/$079F`,
 *   příznak mezihry `$07AF`
 * - **obraz** `$5000`–`$5E6F`: dlaždice 2 × 2 každé buňky přes tabulku
 *   `$3C40` (`CaveScreen.drawGrid`) a okraje `$4A` — zachyceno na `$2674`,
 *   hned po nakreslení, před zakrytím
 * - display list `$5EA0` proti šabloně `$0B28` (struktura a LMS stavového
 *   řádku `$081F`; operandy LMS řádků ne — u jeskyní, kde Rockford nezačíná
 *   vlevo nahoře, je scroll ve VBI posune ještě před `$2674`, M3),
 *   HSCROL/VSCROL 3/0 tam, kde okno ještě stojí, COLPF0–3/COLBK proti hlavičce
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');
const CaveGen = loadClassicScript(path.join(ROOT, 'app/caveGen.js'));
const { Atari8Screen } = await import('../app/svision/js/platform/canvas2D/atari8/atari8Screen.js');
const { CaveScreen } = await import('../app/caveScreen.js');

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const caves = read('data/caves.json'), charset = read('data/charset.json'), global = read('data/global.json'), texts = read('data/texts.json');
const trace = read('build/ref/cavegen.json');
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));

let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; if (failures <= 40 || verbose) console.log('  CHYBA: '+label); }
}

const W = global.grid.width, FIRST = global.grid.caveRows[0], BASE = CaveScreen.address(global.caveScreen.base);
const dlTemplate = hex(global.displayList.raw);
const statusAddr = CaveScreen.address(global.displayList.statusBeforeBirth);
dlTemplate[4] = statusAddr & 0xFF; dlTemplate[5] = statusAddr >> 8;   // ★ $25A1

for (const rec of trace.caves) {
  const cave = caves.caves[rec.cave-1];
  const raw = CaveGen.bytesOf(cave.raw);
  const tag = `${cave.name}/${rec.level+1}`;
  const gen = CaveGen.generate(raw, rec.level);
  const header = hex(rec.header);
  // kopie hlavičky
  let same = true;
  for (let i = 0; i < raw.length; i++) if (header[i] !== raw[i]) same = false;
  check(same, `${tag}: kopie jeskyně na $5F00`);
  // mřížka
  const grid = hex(rec.grid);
  let bad = 0, firstBad = '';
  for (let y = FIRST; y < 24; y++) for (let x = 0; x < W; x++) {
    checks++;
    if (grid[y*W+x] !== gen.grid[y*W+x]) { bad++; failures++; if (!firstBad) firstBad = `(${x},${y}) orig ${grid[y*W+x].toString(16)} ≠ ${gen.grid[y*W+x].toString(16)}`; }
  }
  if (bad) console.log(`  CHYBA: ${tag}: mřížka ${bad} buněk, první ${firstBad}`);
  check(rec.rand[0] === gen.rand[0] && rec.rand[1] === gen.rand[1], `${tag}: PRNG po generování ${rec.rand} ≠ ${gen.rand}`);
  check(rec.rockford[0] === gen.rockford.x && rec.rockford[1] === gen.rockford.y, `${tag}: start Rockforda ${rec.rockford} ≠ ${[gen.rockford.x, gen.rockford.y]}`);
  check(!!rec.intermission === cave.intermission, `${tag}: příznak mezihry $07AF = ${rec.intermission}`);
  // obraz
  const screen = new Atari8Screen();
  CaveScreen.build(screen, charset, global);
  CaveScreen.applyColors(screen, cave.header.colors);
  CaveScreen.drawGrid(screen, gen.grid, charset, global);
  const shot = hex(rec.screen);
  let badTiles = 0, firstTile = '';
  for (let row = 0; row < global.caveScreen.rows; row++) for (let col = 0; col < W; col++) {
    for (const off of [0, 1, global.caveScreen.tileRow, global.caveScreen.tileRow+1]) {
      const a = BASE+row*global.caveScreen.rowStride+2*col+off;
      checks++;
      if (shot[a-0x5000] !== screen.memory[a]) { badTiles++; failures++; if (!firstTile) firstTile = `$${a.toString(16)} orig ${shot[a-0x5000]} ≠ ${screen.memory[a]}`; }
    }
  }
  if (badTiles) console.log(`  CHYBA: ${tag}: obraz ${badTiles} znaků, první ${firstTile}`);
  for (const range of global.caveScreen.margin.ranges) {
    const ends = range.split('–').map(CaveScreen.address);
    let ok = true;
    for (let a = ends[0]; a <= ends[1]; a++) if (shot[a-0x5000] !== screen.memory[a]) ok = false;
    check(ok, `${tag}: okraj ${range}`);
  }
  // display list a registry
  // ★ struktura DL a LMS stavového řádku; operandy LMS řádků jeskyně už
  // v $2674 posunul scroll ve VBI ke startu Rockforda (B, F–P) — to je M3
  const dl = hex(rec.dlist);
  let dlOk = true, lmsMoved = 0;
  for (let i = 0; i < dlTemplate.length; i++) {
    const isRowLms = i >= 7 && i < 6+24*3 && (i-6) % 3 !== 0;
    const mine = screen.memory[CaveScreen.address(global.displayList.address)+i];
    if (isRowLms) { if (dl[i] !== mine) lmsMoved++; continue; }
    if (dl[i] !== mine) dlOk = false;
  }
  check(dlOk, `${tag}: display list $5EA0 (struktura, LMS stavového řádku)`);
  if (verbose && lmsMoved) console.log(`${tag}: okno už posunuté (${lmsMoved} B LMS, M3)`);
  // ★ dokud okno stojí na šabloně, jsou HSCROL/VSCROL 3/0 (98 ze 100 jeskyní
  // v $2674); kde už scroll posunul LMS, posunul i HSCROL (M/2, M/5) — M3
  check(lmsMoved > 0 || (rec.hscrol === global.caveStart.hscrol && rec.vscrol === global.caveStart.vscrol), `${tag}: HSCROL/VSCROL ${rec.hscrol}/${rec.vscrol} při okně na šabloně`);
  check(rec.colors.every((c, i) => c === cave.header.colors[i]), `${tag}: barvy ${rec.colors} ≠ ${cave.header.colors}`);
  // stavový řádek před narozením
  CaveScreen.statusBeforeBirth(screen, texts, global, {player: 1, lives: 3, caveNumber: rec.cave, level: rec.level});
  const status = hex(rec.status);
  let stOk = true;
  for (let i = 0; i < 20; i++) if (status[i] !== screen.memory[statusAddr+i]) stOk = false;
  check(stOk, `${tag}: stavový řádek $081F "${Buffer.from(status).toString('hex')}"`);
  if (verbose) console.log(`${tag}: mřížka ${bad} rozdílů, obraz ${badTiles}, PRNG ${gen.rand}, Rockford ${gen.rockford.x},${gen.rockford.y}`);
}
console.log(`matchcavegen.mjs: ${trace.caves.length} jeskyní, ${checks} kontrol, ${failures} rozdílů`);
process.exit(failures ? 1 : 0);
