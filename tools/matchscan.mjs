#!/usr/bin/env node
/**
 * Přehraje záznam průchodů z běžícího originálu (`tools/tracescan.py` →
 * `build/ref/scan/*.json.gz`) proti **kódu hry** — `app/caveScan.js`
 * (průchod `$1D8F`), `app/caveFrame.js` (krok VBI `$1BB0`) a
 * `app/caveScreen.js` (kreslení) — a hlásí počet kontrol a rozdílů.
 *
 *   ./tools/matchscan.mjs [--verbose] [--costs] [soubor.json.gz …]
 *
 * Co se kontroluje:
 * - **odkrývání** (`$18D8`, fáze 0): po každém zaznamenaném snímku obraz
 *   `$5000`–`$5DBF` znak po znaku, přičemž JS spotřebuje přesně hodnoty
 *   `RANDOM` (`$18E5`), které originál v tom snímku přečetl; na konci fáze
 *   plný obraz
 * - **průchody**: pro každý průchod k se JS nasype vstup (páčka, tlačítko)
 *   a hodnoty `RANDOM` po místech čtení (`$0D88`, `$0FB7`, `$1018`, `$124A`),
 *   pak se porovná mřížka `$4C00` buňku po buňce, obraz znak po znaku,
 *   stavový řádek `$080B`, sada B `$4400`–`$47FF` (animace dlaždic,
 *   Rockford, kouzelná zeď, zakrývací znak) a proměnné hry (Rockford,
 *   narození, čas, diamanty, skóre, kouzelná zeď, améba, scroll)
 * - **snímky** mezi průchody: `CaveFrame.step` proti logu VBI originálu —
 *   tik, odpočet, scroll `$0845`–`$084A`, HSCROL/VSCROL, LMS prvního řádku,
 *   fáze animace, bliknutí pozadí. Poloha Rockforda a páčka se do kroku
 *   snímku dosazují ze záznamu (originál je mění uprostřed průchodu, JS
 *   na jeho konci — `ZADANI.md` §10.6), takže se měří scroll sám o sobě;
 *   snímky, které v originálu proběhly před buňkou Rockforda (podle času
 *   VBI v průchodu), se provedou před průchodem, tik narození před vchodem
 *   se přiřadí průchodu, který ho v originálu viděl
 * - že JS spotřeboval přesně tolik hodnot náhody, kolik originál přečetl
 *
 * `--costs` navíc zapíše `build/ref/scan/costs.csv`: délku každého
 * průchodu v řádcích paprsku a počty obsluh — vstup pro
 * `tools/fitpasscost.py` (model kadence průchodu).
 */
import '../app/svision/tools/nodeEnv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const wantCosts = args.includes('--costs');
const files = args.filter((a) => !a.startsWith('--'));
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');
const CaveGen = loadClassicScript(path.join(ROOT, 'app/caveGen.js'));
const CaveScan = loadClassicScript(path.join(ROOT, 'app/caveScan.js'));
const CaveFrame = loadClassicScript(path.join(ROOT, 'app/caveFrame.js'));
const { Atari8Screen } = await import('../app/svision/js/platform/canvas2D/atari8/atari8Screen.js');
const { CaveScreen } = await import('../app/caveScreen.js');

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const caves = read('data/caves.json'), charset = read('data/charset.json'), global = read('data/global.json');
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
// ★ pořadí míst čtení RANDOM v tools/tracescan.py (id v záznamu)
const SITES = ['0D88', '0FB7', '1018', '124A', '15AD', '15B3', '15B9', '15BF', '1886', '18E5', '1936', '19D9', '19E5', '1B17'];
const MAIN_SITES = ['0D88', '0FB7', '1018', '124A', '1886', '18E5'];
const FRAME_FIELDS = ['rtclok', 'tick', 'scrollXLo', 'scrollX', 'scrollYLo', 'scrollY', 'hscrol', 'vscrol',
                      'rockfordX', 'rockfordY', 'animPhase', 'stick', 'birth', 'flash', 'lms0Lo', 'lms0Hi',
                      'facing', 'magicWall', 'flicker', 'cover', 'animBlink', 'animTap', 'statusLmsLo', 'color4',
                      'beforeBirth', 'time0', 'time1', 'time2', 'magicWallSec', 'magicWallTime', 'animToggle', 'amoebaMask',
                      'scanX', 'scanY'];

let checks = 0, failures = 0, shown = 0;
// háček před obsluhou buňky (snímky uprostřed průchodu, M4) — obaly obsluh
// se instalují jednou, háček si nastaví každý záznam
let midHook = null;
CaveScan.HANDLERS.forEach((h, code) => { if (h) CaveScan.HANDLERS[code] = (c) => { if (midHook) midHook(c.ptr+CaveScan.O.S); h(c); }; });
function check(condition, label) {
  checks++;
  if (!condition) { failures++; if (shown++ < 60 || verbose) console.log('  CHYBA: '+label); }
}

const dir = path.join(ROOT, 'build/ref/scan');
const traces = files.length ? files : fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort().map((f) => path.join(dir, f));
const costs = [];
let totalPasses = 0, totalFrames = 0;

for (const file of traces) {
  const rec = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const cave = caves.caves[rec.cave-1];
  const raw = CaveGen.bytesOf(cave.raw);
  const made = CaveGen.generate(raw, rec.level);
  const tag = path.basename(file, '.json.gz');
  const s = CaveScan.create(made, raw, rec.level, {intermission: cave.intermission, stick: 0});
  // náhoda: fronta na každé místo čtení; JS si bere z fronty svého místa
  const queues = {}, missing = {};
  SITES.forEach((site) => { queues[site] = []; missing[site] = 0; });
  const feed = (list) => list.forEach((e) => queues[SITES[e[0]]].push(e[1]));
  const rand = (site) => { const q = queues[site]; if (!q.length) { missing[site]++; return 0; } return q.shift(); };
  const leftover = (sites, label) => sites.forEach((site) => { if (queues[site].length) { check(false, `${tag}: ${label}: JS nepřečetl ${queues[site].length}× RANDOM na $${site}`); queues[site].length = 0; } });
  const screen = new Atari8Screen();
  CaveScreen.build(screen, charset, global);
  const compareScreen = (shot, label, pendingCell) => {
    CaveScreen.drawTiles(screen, s.tiles, charset, global);
    const want = hex(shot);
    let bad = 0, first = '';
    const covered = global.caveScreen.covered.char;
    const pending = pendingCell >= 0 ? CaveScreen.cellAddresses(pendingCell, global) : [];
    for (let a = 0; a < want.length; a++) {
      if (want[a] !== screen.memory[0x5000+a]) {
        if (want[a] === covered && pending.includes(0x5000+a)) continue;
        bad++; if (!first) first = `$${(0x5000+a).toString(16)} orig ${want[a]} ≠ ${screen.memory[0x5000+a]}`;
      }
    }
    checks++;
    if (bad) { failures++; if (shown++ < 60 || verbose) console.log(`  CHYBA: ${tag}: ${label}: obraz ${bad} znaků, první ${first}`); }
  };
  // sada B odpovídá poslednímu kroku VBI, který glyfy přepsal ($1B62: každý
  // druhý snímek) — s páčkou a směrem, jak je ten krok viděl
  let lastFrame = null, lastAnimFrame = null;
  const anim = () => ({phase: s.animPhase, moving: (lastAnimFrame ? lastAnimFrame.stick : s.stick) != 0x0F, facing: lastAnimFrame ? lastAnimFrame.facing : s.facing,
                       blink: s.animBlink, tap: s.animTap,
                       magicWallFrame: s.magicWallFrame === undefined ? -1 : s.magicWallFrame, coverRotation: s.coverRotation, flickerRows: s.flickerRows || null});
  const compareCharset = (shot, label) => {
    CaveScreen.animate(screen, charset, anim());
    const want = hex(shot);
    let bad = 0, first = '';
    for (let a = 0; a < want.length; a++) {
      if (want[a] !== screen.memory[0x4400+a]) { bad++; if (!first) first = `$${(0x4400+a).toString(16)} orig ${want[a]} ≠ ${screen.memory[0x4400+a]}`; }
    }
    checks++;
    if (bad) {
      failures++;
      if (shown++ < 60 || verbose) console.log(`  CHYBA: ${tag}: ${label}: sada B ${bad} bajtů, první ${first}`);
      if (process.env.SCANDEBUG) {
        const diffs = []; for (let a = 0; a < want.length; a++) if (want[a] !== screen.memory[0x4400+a]) diffs.push(`$${(0x4400+a).toString(16)}:${want[a]}/${screen.memory[0x4400+a]}`);
        console.log('    anim', JSON.stringify(anim()), 'lastFrame', lastFrame ? `stick ${lastFrame.stick} facing ${lastFrame.facing} blink ${lastFrame.animBlink} tap ${lastFrame.animTap} phase ${lastFrame.animPhase}` : '-', diffs.slice(0, 20).join(' '));
      }
    }
  };
  // jeden snímek VBI proti záznamu (po kroku hry originálu)
  let frameNo = 0;
  const stepFrame = (entry, label, skip) => {
    const e = {};
    FRAME_FIELDS.forEach((k, i) => { e[k] = entry[i]; });
    // poloha Rockforda, páčka a směr jsou vstupy scrollu a animace — ze
    // záznamu (§10.6); volající je po snímcích vrátí
    s.rockfordX = e.rockfordX; s.rockfordY = e.rockfordY; s.stick = e.stick; s.facing = e.facing;
    CaveFrame.step(s, rand);
    frameNo++; totalFrames++;
    lastFrame = e;
    if ((e.animToggle & 1) === 0) lastAnimFrame = e;
    const lms0 = (0x5000+global.caveScreen.tileRow*s.scroll.y+s.scroll.x) & 0xFFFF;
    const got = {tick: s.tick, scrollXLo: s.scroll.xLo, scrollX: s.scroll.x, scrollYLo: s.scroll.yLo, scrollY: s.scroll.y,
                 hscrol: s.hscrol, vscrol: s.vscrol, animPhase: s.animPhase, birth: s.birth, flash: s.flash, lms0Lo: lms0 & 0xFF, lms0Hi: lms0 >> 8,
                 magicWall: s.magicWall, flicker: s.flicker, cover: s.cover, animBlink: s.animBlink, animTap: s.animTap,
                 statusLmsLo: s.statusInGame ? 0x0B : 0x1F, beforeBirth: s.beforeBirth, time0: s.time[0], time1: s.time[1], time2: s.time[2],
                 magicWallSec: s.magicWallSec, magicWallTime: s.magicWallTime, animToggle: s.animToggle, amoebaMask: s.amoebaMask,
                 color4: (cave.header.colors[4] & 0xF0) | (s.bkLum || 0)};
    Object.keys(got).forEach((k) => { if (!(skip && skip[k])) check(got[k] === e[k], `${tag}: ${label} snímek ${e.rtclok}: ${k} orig ${e[k]} ≠ ${got[k]}`); });
  };
  // snímky mezi dvěma breakpointy: JS si po nich vezme zpět svou polohu Rockforda, páčku a směr
  const stepFrames = (entries, vbiRandoms, label) => {
    const own = {rockfordX: s.rockfordX, rockfordY: s.rockfordY, stick: s.stick, facing: s.facing};
    for (const entry of entries) {
      feedVbi(vbiRandoms, entry[0]);
      stepFrame(entry, label);
    }
    Object.assign(s, own);
  };
  // --- snímky uprostřed průchodu (M4) ----------------------------------------
  // ★ Průchod originálu trvá několik snímků a VBI mezitím tiká: sekunda hry
  // (maska améby $07A1, čas, odpočet vchodu) nebo vyhasnutí kouzelné zdi
  // platí od buňky, u které sken právě byl. JS dělá průchod atomicky
  // (ZADANI.md §10.6), ale nástroj snímek provede **uprostřed průchodu**:
  // log snímku nese polohu skenu $0790/$0791 (u které buňky VBI přišla)
  // a každé čtení RANDOM hlavní smyčky razítko RTCLOK, takže je známo i po
  // kolikátém čtení VBI přišla (čtení s razítkem T je až po VBI snímku T).
  // Snímek se provede před obsluhou první buňky od té polohy, u které už
  // proběhla všechna čtení, která ji předcházela — čtení uvnitř obsluhy
  // téže buňky tak rozhodne, jestli VBI přišla před ním, nebo po něm.
  // Obsluhy buněk jsou k tomu obalené háčkem a čtení RANDOM počítá obal `rand`.
  let mid = null;   // {pending: [{entry, readsBefore, pos}], reads, vbiRandoms, label}
  const stepMid = (f) => {
    const own = {rockfordX: s.rockfordX, rockfordY: s.rockfordY, stick: s.stick, facing: s.facing};
    const was = mid; mid = null;
    feedVbi(was.vbiRandoms, f.entry[0]);
    stepFrame(f.entry, was.label);
    mid = was;
    Object.assign(s, own);
  };
  const midBeforeCell = (index) => {
    if (!mid) return;
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads && mid.pending[0].pos <= index) {
      stepMid(mid.pending.shift());
    }
  };
  const midBeforeRead = () => {
    if (!mid) return;
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads) {
      stepMid(mid.pending.shift());
    }
    mid.reads++;
  };
  const midFinish = () => {
    const was = mid; mid = null;
    while (was.pending.length) {
      const f = was.pending.shift();
      const own = {rockfordX: s.rockfordX, rockfordY: s.rockfordY, stick: s.stick, facing: s.facing};
      feedVbi(was.vbiRandoms, f.entry[0]);
      stepFrame(f.entry, was.label);
      Object.assign(s, own);
    }
  };
  midHook = midBeforeCell;
  const randMid = (site) => { if (mid && MAIN_SITES.includes(site)) midBeforeRead(); return rand(site); };
  const feedVbi = (list, frame) => feed(list.filter((x) => x[2] === frame));

  // --- fáze 0: odkrývání ($18D8) po snímcích --------------------------------
  // hodnoty RANDOM hlavní smyčky podle razítka snímku (záznam, který breakpoint
  // zastihl uprostřed zápisu, přijde až v dalším čtení); krok VBI od
  // cave_start_vars ($0793 = 4); okraje $4A až po plném kreslení
  const mainByFrame = {};
  rec.uncover.forEach((f) => f.randoms.forEach((e) => { (mainByFrame[e[2]] = mainByFrame[e[2]] || []).push(e); }));
  const vbiAll = rec.uncover.flatMap((f) => f.vbiRandoms);
  // ★ krok hry běží od fire v menu (režim 0); $1E7D cave_start_vars běží až
  // na konci generování a se čtyřmi dekadickými převody trvá 2–3 snímky:
  // tik $0839 se pozná jako 1 po nenulovém, odpočet $0793 jako první
  // nenulový v záznamu — v tom snímku se provede CaveScan.startVars; do té
  // doby se nic z $1E7D nekontroluje (platí hodnoty z minulé jeskyně /
  // bootu) a v mezihře ani HSCROL/VSCROL (scroll $1814 se s $0793 = 0
  // nevolá a harness začíná s nulou v $0674/$0675)
  let reset = false, started = false, prevTick = null, uncoverChecks = 0;
  // ★ okraje $5000–$5002 před prvním plným kreslením: co tam nechala titulka
  // (0 po bootu, nebo $7C z $1870 — liší se běh od běhu), nepozorovatelný
  // počáteční stav jako parita animace; hra bere 0
  s.margin = rec.uncover.length ? hex(rec.uncover[0].screen)[0] : 0;
  CaveScreen.drawMargin(screen, global, s.margin);
  // ★ mezi fire v menu a breakpointem $2645 uběhne pár snímků bez háčku:
  // parita $085E a fáze $085C se vezmou z prvních dvou záznamů, otočení
  // zakrývacího znaku z první zaznamenané sady B (nepozorovatelný počáteční stav)
  const first = rec.uncover.flatMap((f) => f.frames);
  if (first.length) {
    s.animToggle = (first[0][30]-1) & 0xFF;
    s.animPhase = (first[0][30] & 1) ? first[0][10] : (first[0][10]-8) & 0x3F;
  }
  if (rec.passes.length) {
    const shot = hex(rec.passes[0].charsetB), glyph = CaveScreen.charsetData(charset).blockB;
    let found = -1;
    for (let r = 0; r < 8; r++) {
      let ok = true;
      for (let y = 0; y < 8; y++) if (shot[0x3E0+y] !== glyph[0x3E0+((y+r) & 7)]) ok = false;
      if (ok) found = r;
    }
    // sada B je zaznamenaná až u prvního průchodu, tj. po všech snímcích fáze 0;
    // otáčí se v každém snímku, ve kterém byl kryt ($0859) zvednutý
    const rotating = first.filter((e) => e[19] === 1).length;
    if (found >= 0) s.coverRotation = (found-rotating) & 7;
  }
  for (const f of rec.uncover) {
    for (const entry of f.frames) {
      if (!reset && prevTick !== null && entry[1] === 1 && prevTick !== 0) { reset = true; s.tick = 0; }
      prevTick = entry[1];
      if (!started && entry[12] !== 0) { const tick = s.tick; CaveScan.startVars(s); s.tick = tick; started = true; }
      // ★ $2676 shodí kryt ($0859 = 0) hned po plném kreslení $1954 — když to
      // záznam ukáže před posledním breakpointem fáze 0, dokreslí se tady
      if (entry[19] === 0 && s.cover && s.uncoverRound >= 120) { while (CaveScan.drawRow(s)); }
      feedVbi(vbiAll, entry[0]);
      const before = started ? null : {birth: true, beforeBirth: true, time0: true, time1: true, time2: true, magicWall: true, magicWallSec: true, magicWallTime: true, amoebaMask: true, flicker: true, statusLmsLo: true,
                                       hscrol: !!cave.intermission, vscrol: !!cave.intermission};
      stepFrame(entry, 'odkrývání', before);
    }
    // ★ čtení $18E5 s razítkem před tímhle breakpointem (RTCLOK už je o 1 dál)
    const k = f.clock.rtclok & 0xFF;
    let reads = 0, lastDrawn = -1;
    Object.keys(mainByFrame).map(Number).filter((fr) => ((k-fr) & 0xFF) >= 1 && ((k-fr) & 0xFF) < 8).sort((a, b) => ((a-k) & 0xFF)-((b-k) & 0xFF)).forEach((fr) => {
      mainByFrame[fr].forEach((e) => { reads++; const x = e[1]; if (x <= 39) lastDrawn = CaveScan.uncoverAccept(s, x); });
      delete mainByFrame[fr];
    });
    if (s.uncoverRound < 120 && reads) {
      // ★ mezi čtením RANDOM a zápisem dlaždice může přijít VBI (breakpoint):
      // poslední přijatá buňka pak v záznamu ještě nese kryt — jediný povolený rozdíl
      compareScreen(f.screen, `odkrývání kolo ${s.uncoverRound} řádek ${s.uncoverRow}`, lastDrawn);
      uncoverChecks++;
    }
    leftover(SITES, 'odkrývání');
  }
  Object.keys(mainByFrame).forEach((fr) => mainByFrame[fr].forEach((e) => { const x = e[1]; if (x <= 39) CaveScan.uncoverAccept(s, x); }));
  check(s.uncoverRound === 120, `${tag}: odkrývání skončilo po ${s.uncoverRound} kolech`);
  while (CaveScan.drawRow(s));
  CaveScreen.drawMargin(screen, global, s.margin);
  compareScreen(rec.uncover[rec.uncover.length-1].screen, 'plný obraz po odkrytí');
  if (verbose) console.log(`${tag}: odkrývání ${rec.uncover.length} snímků, ${uncoverChecks} obrazů`);

  // --- průchody ---------------------------------------------------------------
  const passes = rec.passes;
  const compareState = (p, k) => {
    const v = p.vars;
    const grid = hex(p.grid);
    let bad = 0, first = '';
    for (let i = 3*40; i < 960; i++) {
      checks++;
      if (grid[i] !== s.grid[i]) { bad++; failures++; if (!first) first = `(${i % 40},${Math.floor(i/40)}) orig $${grid[i].toString(16)} ≠ $${s.grid[i].toString(16)}`; }
    }
    if (bad && (shown++ < 60 || verbose)) console.log(`  CHYBA: ${tag}: po průchodu ${k}: mřížka ${bad} buněk, první ${first}`);
    compareScreen(p.screen, `po průchodu ${k}`);
    compareCharset(p.charsetB, `po průchodu ${k}`);
    const status = hex(p.status);
    let stOk = true;
    for (let i = 0; i < 20; i++) if (status[i] !== s.status[i]) stOk = false;
    check(stOk, `${tag}: po průchodu ${k}: stavový řádek $080B ${p.status.slice(0, 40)} ≠ ${Buffer.from(s.status).toString('hex')}`);
    const got = {rockfordX: s.rockfordX, rockfordY: s.rockfordY, facing: s.facing, stick: s.stick, trig: s.trig, moved: s.moved, blink: s.blink,
                 birth: s.birth, beforeBirth: s.beforeBirth, noRockford: s.noRockford, caveOver: s.caveOver, exitReached: s.exitReached,
                 magicWall: s.magicWall, magicWallSec: s.magicWallSec, magicWallTime: s.magicWallTime, diamondsEnough: s.diamondsEnough,
                 amoebaGrow: s.amoebaGrow, amoebaGrewLast: s.amoebaGrewLast, amoebaEnclosed: s.amoebaEnclosed, amoebaMask: s.amoebaMask,
                 amoebaCount: s.amoebaCount, amoebaCountLast: s.amoebaCountLast, secondsGone: s.secondsGone, tick: s.tick, flash: s.flash,
                 lives: s.lives, animPhase: s.animPhase, animBlink: s.animBlink, animTap: s.animTap,
                 scrollXLo: s.scroll.xLo, scrollX: s.scroll.x, scrollYLo: s.scroll.yLo, scrollY: s.scroll.y,
                 scrollVxLo: s.scroll.vxLo, scrollVx: s.scroll.vx, scrollVyLo: s.scroll.vyLo, scrollVy: s.scroll.vy, hscrol: s.hscrol, vscrol: s.vscrol,
                 statusLmsLo: s.statusInGame ? 0x0B : 0x1F, sound2: s.sound.envelope};
    Object.keys(got).forEach((key) => check(got[key] === v[key], `${tag}: po průchodu ${k}: ${key} orig ${v[key]} ≠ ${got[key]}`));
    const lists = {time: s.time, collected: s.collected, needed: s.needed, diamondValue: s.diamondValue, extraValue: s.extraValue, score: s.score};
    Object.keys(lists).forEach((key) => check(lists[key].join() === v[key].join(), `${tag}: po průchodu ${k}: ${key} orig ${v[key]} ≠ ${lists[key]}`));
  };
  // ★ scénář (tracescan.py SCENARIOS): záplata mřížky, dlaždic a hlavičky
  // provedená v originálu na prvním breakpointu $1D8F — tady totéž
  if (rec.patch) {
    rec.patch.forEach(([x, y, code]) => { s.grid[y*40+x] = code; s.tiles[y*40+x] = code; });
    Object.keys(rec.header || {}).forEach((off) => { raw[Number(off)] = rec.header[off]; });
  }
  // stav před prvním průchodem = konec fáze 0
  if (passes.length) {
    feed(passes[0].randoms);
    stepFrames(passes[0].frames, passes[0].vbiRandoms, 'před 1. průchodem');
    leftover(SITES, 'před 1. průchodem');
    compareState(passes[0], -1);
  }
  for (let k = 0; k+1 < passes.length; k++) {
    const p = passes[k], next = passes[k+1];
    const input = {stick: p.input[0], trig: p.input[1]};
    feed(next.randoms);
    // ★ snímky VBI tohoto průchodu se provedou uprostřed průchodu tam, kde
    // v originálu přišly: poloha skenu ($0790 = x 0–39, 40 po řádku;
    // $0791 = řádek 1–21, 22 po průchodu → index buňky mřížky) a počet
    // čtení RANDOM hlavní smyčky před nimi (razítka). Dva krátké úseky jsou
    // nerozlišitelné od konce průchodu / řádku (mezi breakpointem $1D8F
    // a $0791 = 1; prolog $1D73 s $0790 = 40 z minula) — rozhodne čas
    const t0 = p.clock.rtclok*312+(p.clock.ypos+64) % 312, t1 = next.clock.rtclok*312+(next.clock.ypos+64) % 312;
    const rel = (stamp) => (stamp-p.clock.rtclok) & 0xFF;
    const mainReads = next.randoms.filter((e) => MAIN_SITES.includes(SITES[e[0]]));
    const pending = next.frames.map((entry) => {
      const t = (p.clock.rtclok+rel(entry[0]))*312, fraction = t > t0 ? (t-t0)/(t1-t0) : 0;
      const scanX = entry[32], scanY = entry[33];
      let pos = (scanY+2)*40+scanX;
      if (scanY === 22 && fraction < 0.5) pos = 120;
      if (scanY === 1 && scanX === 40 && fraction < 0.02) pos = 120;
      return {entry, readsBefore: mainReads.filter((e) => rel(e[2]) < rel(entry[0])).length, pos};
    });
    mid = {pending, reads: 0, vbiRandoms: next.vbiRandoms, label: `průchod ${k}`};
    const counts = CaveScan.pass(s, input, randMid);
    totalPasses++;
    if (process.env.SCANDEBUG) console.log(`${tag} průchod ${k}: vstup ${input.stick}/${input.trig} obsluhy 05=${counts[5] || 0} 25=${counts[0x25] || 0} blink JS ${s.blink} orig ${next.vars.blink} rock ${s.rockfordX},${s.rockfordY} facing ${s.facing} stick ${s.stick}`);
    leftover(MAIN_SITES, `průchod ${k}`);
    midFinish();
    leftover(SITES, `snímky průchodu ${k}`);
    compareState(next, k);
    if (wantCosts) {
      const t0 = p.clock.rtclok*312+(p.clock.ypos+64) % 312, t1 = next.clock.rtclok*312+(next.clock.ypos+64) % 312;
      costs.push(Object.assign({trace: tag, level: rec.level, lines: t1-t0}, counts));
    }
  }
  SITES.forEach((site) => check(missing[site] === 0, `${tag}: JS přečetl ${missing[site]}× RANDOM na $${site} navíc`));
  if (verbose) console.log(`${tag}: ${passes.length} průchodů, ${frameNo} snímků`);
}

if (wantCosts && costs.length) {
  const keys = ['trace', 'level', 'lines', 'handled', 'stores', 'rands'];
  const codes = Array.from(new Set(costs.flatMap((c) => Object.keys(c).filter((k) => /^\d+$/.test(k))))).map(Number).sort((a, b) => a-b);
  const lines = [keys.concat(codes.map((c) => 'c'+c.toString(16))).join(',')];
  costs.forEach((c) => lines.push(keys.map((k) => c[k]).concat(codes.map((code) => c[code] || 0)).join(',')));
  fs.writeFileSync(path.join(dir, 'costs.csv'), lines.join('\n')+'\n');
  console.log(`costs.csv: ${costs.length} průchodů`);
}
console.log(`matchscan.mjs: ${traces.length} záznamů, ${totalPasses} průchodů, ${totalFrames} snímků, ${checks} kontrol, ${failures} rozdílů`);
process.exit(failures ? 1 : 0);
