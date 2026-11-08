#!/usr/bin/env node
/**
 * Porovná obraz jeskyně, který nakreslí **skutečný kód knihovny**
 * (`Atari8Screen.paint32` nad `data/screen.json` — totéž, co jde do
 * prohlížeče přes `Atari8ScreenEntity`), s nezávislým rendererem
 * `tools/renderref.py` (Python, `build/ref/caveA.idx`: 320×240 indexů
 * barev z téže paměti, týchž registrů a týchž DLI dat).
 *
 *   ./tools/matchscreen.mjs [--verbose]
 *
 * **76 800 kontrol na referenci** — každý pixel; M3 přidala druhou
 * referenci s oknem posunutým scrollem (`data/screen_scroll.json`). Index barvy se převádí tou samou
 * tabulkou `Atari8Color.lookup`, takže se porovnává barva pixelu, ne RGB
 * po výpočtu.
 *
 * ★ Co ta nula dokazuje a co ne. Dokazuje, že dvě nezávislé implementace
 * ANTICu (JS v knihovně, Python v nástroji) čtou display list originálu,
 * LMS po řádcích, HSCROL/VSCROL, DLI a obě sady stejně — a že cesta
 * originál → `data/screen.json` → `Atari8Screen` nic neztratí. Nedokazuje
 * shodu s pixely skutečného stroje: atari800 bez displeje snímek neumí
 * uložit (`ZADANI.md` §10). Až bude odkud (Xvfb, Altirra), přibude třetí
 * strana porovnání a tenhle nástroj i jeho reference zůstanou.
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');

const { Atari8Screen } = await import('../app/svision/js/platform/canvas2D/atari8/atari8Screen.js');
const { Atari8Color } = await import('../app/svision/js/platform/canvas2D/atari8/atari8Color.js');
const { ScreenLoader } = await import('../app/screenLoader.js');

// ★ každá reference: data/screen.json (A/1 po narození, M1) a data/screen_*.json
// (M3: okno posunuté scrollem — LMS řádků, HSCROL i VSCROL mimo šablonu)
const names = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^screen(_.*)?\.json$/.test(f)).sort();
let checks = 0, diffs = 0;
const lut = Atari8Color.lookup(true);
for (const name of names) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
  const refName = name === 'screen.json' ? 'caveA' : name.replace(/^screen_/, '').replace(/\.json$/, '');
  const ref = fs.readFileSync(path.join(ROOT, 'build/ref', refName + '.idx'));
  const screen = new Atari8Screen();
  ScreenLoader.apply(screen, scene);
  const px = new Uint32Array(Atari8Screen.WIDTH*Atari8Screen.HEIGHT);
  screen.paint32(px, true);
  let mine = 0;
  const firsts = [];
  for (let i = 0; i < px.length; i++) {
    checks++;
    if (px[i] !== lut[ref[i]]) {
      diffs++; mine++;
      if (firsts.length < 10) {
        const index = lut.indexOf(px[i]);
        firsts.push(`(${i%320},${Math.floor(i/320)}) ref $${ref[i].toString(16)} js $${index.toString(16)}`);
      }
    }
  }
  if (verbose || mine) {
    console.log('  '+name+': unsupported:', JSON.stringify(screen.unsupported), 'DL $'+screen.dlist.toString(16), 'CHBAS $'+screen.chbase.toString(16), 'HSCROL', screen.hscrol, 'VSCROL', screen.vscrol);
    firsts.forEach((f) => console.log('  ' + f));
  }
  console.log(`  ${name}: ${px.length} kontrol, ${mine} rozdílů (snímek ${scene.frame}, HSCROL ${scene.registers.hscrol}, VSCROL ${scene.registers.vscrol})`);
}
console.log(`matchscreen.mjs: ${names.length} referencí, ${checks} kontrol, ${diffs} rozdílů`);
process.exit(diffs ? 1 : 0);
