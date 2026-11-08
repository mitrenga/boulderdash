#!/usr/bin/env node
/**
 * Porovná titulku, kterou **staví kód remaku z dat** (`app/titleScreen.js`
 * nad `data/title.json`, `charset.json`, `texts.json` — totéž, co kreslí
 * MainModel), s pamětí **běžícího originálu** (`data/screen_title.json`
 * po zapnutí, `data/screen_title_after.json` po demu; `tools/mkscreen.py
 * --title [--after-demo]`).
 *
 *   ./tools/matchtitle.mjs [--verbose]
 *
 * Kontroluje se bajt po bajtu: display list `$0961`, bitmapy režimu E
 * `$2D80`/`$3000`, obraz loga `$4C00` (19 × 40), sada A mimo animované
 * znaky, registry ANTIC a barvy GTIA; pak **animace**: `titleFrames`
 * fotky (`$085E` a znaky 0, 9, 10 sady A po 64 snímcích) proti
 * `TitleScreen.step` — fáze otáčení znaku 0 a parita `$085E` jsou stav,
 * který si originál nese z minulosti, proto se na prvním snímku srovnají
 * (otočení 0–7, hodnota `$085E`) a od té chvíle musí každý snímek sedět.
 * Nakonec pixely: obě obrazovky přes `Atari8Screen.paint32`.
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const verbose = process.argv.includes('--verbose');

const { Atari8Screen } = await import('../app/svision/js/platform/canvas2D/atari8/atari8Screen.js');
const { ScreenLoader } = await import('../app/screenLoader.js');
const { TitleScreen } = await import('../app/titleScreen.js');
const { CaveScreen } = await import('../app/caveScreen.js');

const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name + '.json'), 'utf8'));
const data = {charset: load('charset'), global: load('global'), texts: load('texts'), title: load('title')};
const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const SET_A = CaveScreen.address(data.charset.blocks[0].address);
const ANIMATED = [0, 9, 10];

let checks = 0, diffs = 0;
function compare(label, mine, ref, offset) {
  let bad = 0, first = -1;
  for (let i = 0; i < ref.length; i++) {
    checks++;
    if (mine[i] !== ref[i]) { diffs++; bad++; if (first < 0) first = i; }
  }
  if (bad || verbose) console.log(`  ${label}: ${ref.length} kontrol, ${bad} rozdílů` + (bad ? ` (první $${(offset+first).toString(16)}: js $${mine[first].toString(16)} orig $${ref[first].toString(16)})` : ''));
}
function rotated(bytes, times) {
  let out = Uint8Array.from(bytes);
  for (let t = 0; t < times; t++) out = Uint8Array.from([...out.slice(1), out[0]]);
  return out;
}
function charOf(screen, c) { return screen.memory.slice(SET_A+c*8, SET_A+c*8+8); }

for (const name of ['screen_title', 'screen_title_after']) {
  const scene = load(name);
  const ref = ScreenLoader.apply(new Atari8Screen(), scene);
  const screen = TitleScreen.build(new Atari8Screen(), data);
  console.log(`${name}.json (snímek ${scene.frame}, RTCLOK ${scene.rtclok}):`);

  // --- the picture's memory
  const dl = CaveScreen.address(data.title.displayList.address), dlLength = data.title.displayList.raw.length/2;
  compare('display list $0961', screen.memory.slice(dl, dl+dlLength), ref.memory.slice(dl, dl+dlLength), dl);
  data.title.bitmaps.forEach((b) => {
    const a = CaveScreen.address(b.address), n = b.rows*40;
    compare(`bitmapa ${b.address}`, screen.memory.slice(a, a+n), ref.memory.slice(a, a+n), a);
  });
  const s = CaveScreen.address(data.title.screen.address), sn = data.title.screen.rows*data.title.screen.columns;
  compare('obraz loga $4C00', screen.memory.slice(s, s+sn), ref.memory.slice(s, s+sn), s);
  const mineA = Uint8Array.from(screen.memory.slice(SET_A, SET_A+1024)), refA = Uint8Array.from(ref.memory.slice(SET_A, SET_A+1024));
  ANIMATED.forEach((c) => { for (let i = 0; i < 8; i++) mineA[c*8+i] = refA[c*8+i] = 0; });
  compare('sada A mimo znaky 0/9/10', mineA, refA, SET_A);
  const regs = ['dlist', 'chbase', 'dmactl', 'chactl', 'vscrol', 'colbk'];
  compare('registry ' + regs.join('/'), regs.map((r) => screen[r]), regs.map((r) => ref[r]), 0);
  compare('COLPF0–3', screen.colpf, ref.colpf, 0);
  // HSCROL: the title's display list has no HS bit; the original leaves the cave's value in it (after the demo 3)
  if (verbose) console.log(`  HSCROL orig ${ref.hscrol} (bez vlivu: řádky titulky nemají bit HS)`);

  // --- the animation: align the phase on the first logged frame, then follow
  const frames = scene.titleFrames;
  const eleven = charOf(screen, data.title.animation.menuStart.from);
  let phase = -1;
  for (let r = 0; r < 8; r++) if (hex(rotated(eleven, r)) === frames[0].char0) phase = r;
  checks++;
  if (phase < 0) { diffs++; console.log(`  CHYBA: znak 0 na prvním snímku (${frames[0].char0}) není otočení znaku 11 (${hex(eleven)})`); continue; }
  const state = TitleScreen.start(frames[0].toggle);
  state.frame = 2;                                            // past the first frame and the copy of character 11
  screen.write(SET_A, rotated(eleven, phase));
  data.title.animation.compose.forEach((c) => {
    const out = new Uint8Array(8);
    for (let i = 0; i < 8; i++) out[i] = screen.memory[SET_A+c.from*8+i] | screen.memory[SET_A+i];
    screen.write(SET_A+c.char*8, out);
  });
  let animChecks = 0, animDiffs = 0;
  for (let f = 0; f < frames.length; f++) {
    if (f > 0) TitleScreen.step(screen, data.charset, data.title, state);
    const want = frames[f];
    checks++; if (state.toggle !== want.toggle) { diffs++; animDiffs++; console.log(`  snímek ${want.frame}: $085E js ${state.toggle} orig ${want.toggle}`); }
    for (const [c, key] of [[0, 'char0'], [9, 'char9'], [10, 'char10']]) {
      const mine = hex(charOf(screen, c));
      checks += 8; animChecks += 8;
      if (mine !== want[key]) { diffs += 8; animDiffs += 8; if (animDiffs <= 40) console.log(`  snímek ${want.frame}: znak ${c} js ${mine} orig ${want[key]}`); }
    }
    if (f === 0) {
      // --- the pixels, once the phase is aligned
      const px = new Uint32Array(Atari8Screen.WIDTH*Atari8Screen.HEIGHT), rx = new Uint32Array(px.length);
      screen.paint32(px, true); ref.paint32(rx, true);
      let bad = 0;
      for (let i = 0; i < px.length; i++) { checks++; if (px[i] !== rx[i]) { diffs++; bad++; } }
      console.log(`  pixely: ${px.length} kontrol, ${bad} rozdílů`);
    }
  }
  console.log(`  animace: ${frames.length} snímků (otočení ${phase}, $085E ${frames[0].toggle}), ${animChecks} kontrol, ${animDiffs} rozdílů`);
}
console.log(`matchtitle.mjs: 2 reference, ${checks} kontrol, ${diffs} rozdílů`);
process.exit(diffs ? 1 : 0);
