#!/usr/bin/env node
/**
 * Přehraje záznam **celé hry** z běžícího originálu (`tools/tracerules.py` →
 * `build/ref/rules/*.json.gz`) proti **pravidlům hry** — `app/caveRules.js`
 * (hlavní smyčka `$28F3`: konec jeskyně, bonus, životy, dva hráči, další
 * jeskyně, mezihry, OUT OF TIME, GAME OVER, zakrytí, demo) s `caveScan.js`
 * / `caveFrame.js` / `caveScreen.js` — a hlásí počet kontrol a rozdílů (M5).
 *
 *   ./tools/matchrules.mjs [--verbose] [soubor.json.gz …]
 *
 * Co se kontroluje, jeskyni po jeskyni:
 * - **stav hry** v každém háčku (`$2645` další jeskyně, `$288C` konec
 *   průchodů, `$2915` po `cave_end_vars`, `$2918` po `cave_end`, `$28F8`
 *   titulka): životy, číslo jeskyně a obtížnost, hráč, dva hráči, game
 *   over, skóre, nejvyšší skóre, **bloky obou hráčů** `$07C5`/`$07D4`,
 *   stavový řádek před narozením `$081F`, řádky LAST/HIGH titulky
 *   `$07E3`/`$07F7`, příznak mezihry, přírůstek bonusu `$07B0`
 * - **odkrývání a první průchod** každé jeskyně jako `matchscan.mjs`
 *   (obraz po snímcích, mřížka, sada B, stavový řádek, proměnné) — od
 *   druhé jeskyně **s přeneseným stavem** (okno, animace, počítadlo blikání
 *   `$0844`, pauza, tik, flicker) a s odpočtem narození 4 / 6 podle hráčů
 *   a joysticků
 * - **průchody se nepřehrávají** (to je `matchscan.mjs`); stav jeskyně se
 *   na konci (`$288C`) vezme ze záznamu a od něj se jede dál
 * - **konec jeskyně po snímcích**: sekundy bonusu (čas, skóre, životy,
 *   flicker bonusového života, na který konec čeká), OUT OF TIME (kdy ano
 *   a kdy ne, bliknutí a fire), GAME OVER / BONUS LIFE / stavový řádek
 *   (`$5EA4`), zakrývání `$1870` **znak po znaku** z nahraných hodnot
 *   `RANDOM` (`$1886`) i s okraji `$5000`–`$5002`, plné zakrytí `$1852`;
 *   krok VBI (scroll, animace, LMS, čas ve stavovém řádku …) proti logu
 *   snímku po celou dobu
 * - **kadence** (`CaveRules.COST`, změřená bez harnessu `tools/timerules.py`)
 *   se nekontroluje na nulu — harness ji o pár procent zpomaluje —, jen se
 *   hlásí: sekundy bonusu na snímek, délka čekání OUT OF TIME, zpoždění po
 *   bonusu a po GAME OVER, snímky zakrývání
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
const files = args.filter((a) => !a.startsWith('--'));
const require = createRequire(import.meta.url);
const { loadClassicScript } = require('../app/svision/tools/classicScript.cjs');
const CaveGen = loadClassicScript(path.join(ROOT, 'app/caveGen.js'));
const CaveScan = loadClassicScript(path.join(ROOT, 'app/caveScan.js'));
const CaveFrame = loadClassicScript(path.join(ROOT, 'app/caveFrame.js'));
const CaveRules = loadClassicScript(path.join(ROOT, 'app/caveRules.js'));
const { Atari8Screen } = await import('../app/svision/js/platform/canvas2D/atari8/atari8Screen.js');
const { CaveScreen } = await import('../app/caveScreen.js');

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const caves = read('data/caves.json'), charset = read('data/charset.json'), global = read('data/global.json');
const demoScript = Array.from(Buffer.from(read('data/demo.json').raw, 'hex'));
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
// ★ pořadí míst čtení RANDOM v tools/tracescan.py (id v záznamu)
const SITES = ['0D88', '0FB7', '1018', '124A', '15AD', '15B3', '15B9', '15BF', '1886', '18E5', '1936', '19D9', '19E5', '1B17'];
// ★ log snímku: 34 polí tracescan + 14 tracerules
const FRAME_FIELDS = ['rtclok', 'tick', 'scrollXLo', 'scrollX', 'scrollYLo', 'scrollY', 'hscrol', 'vscrol',
                      'rockfordX', 'rockfordY', 'animPhase', 'stick', 'birth', 'flash', 'lms0Lo', 'lms0Hi',
                      'facing', 'magicWall', 'flicker', 'cover', 'animBlink', 'animTap', 'statusLmsLo', 'color4',
                      'beforeBirth', 'time0', 'time1', 'time2', 'magicWallSec', 'magicWallTime', 'animToggle', 'amoebaMask',
                      'scanX', 'scanY',
                      'score0', 'score1', 'score2', 'score3', 'score4', 'score5', 'lives', 'paused',
                      'bonusCount', 'outOfTimeCount', 'caveOver', 'exitReached', 'trig', 'player'];
const F = {}; FRAME_FIELDS.forEach((k, i) => { F[k] = i; });
const BLOCK = 0x0780;
// ★ proměnné v bloku $0780–$087F záznamu
const V = {amoebaEnclosed: 0x0789, magicWall: 0x078A, magicWallSec: 0x078B, magicWallTime: 0x078C, diamondsEnough: 0x078D,
           amoebaGrow: 0x078E, amoebaGrewLast: 0x078F, beforeBirth: 0x0792, birth: 0x0793, noRockford: 0x0794, caveOver: 0x0795,
           sound2: 0x0799, facing: 0x079D, rockfordX: 0x079E, rockfordY: 0x079F, amoebaMask: 0x07A1, amoebaCount: 0x07A2, amoebaCountLast: 0x07A3,
           paused: 0x07A4, player: 0x07A6, twoPlayers: 0x07A7, exitReached: 0x07A8, gameOver: 0x07A9, demo: 0x07AB, twoJoysticks: 0x07AD,
           flash: 0x07AE, intermission: 0x07AF, lives: 0x07B6, caveNumber: 0x07B7, levelIndex: 0x07B8,
           flicker: 0x0833, tick: 0x0839, secondsGone: 0x083A, moved: 0x0842, trig: 0x0843, blink: 0x0844,
           scrollXLo: 0x0845, scrollX: 0x0846, scrollVxLo: 0x0847, scrollVx: 0x0848, scrollYLo: 0x0849, scrollY: 0x084A, scrollVyLo: 0x084B, scrollVy: 0x084C,
           animTap: 0x085A, animBlink: 0x085B, animPhase: 0x085C, animToggle: 0x085E, cover: 0x0859, caveTime: 0x0865, bonusCounter: 0x0879, stick: 0x0788};
const R = {add: [0x07B0, 6], diamondValue: [0x07B3, 3], score: [0x07B9, 6], high: [0x07BF, 6], save1: [0x07C5, 15], save2: [0x07D4, 15],
           lastRow: [0x07E3, 20], highRow: [0x07F7, 20], statusA: [0x080B, 20], statusB: [0x081F, 20],
           time: [0x0836, 3], collected: [0x083B, 2], needed: [0x083D, 2], extraValue: [0x083F, 3]};

let checks = 0, failures = 0, shown = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; if (shown++ < 80 || verbose) console.log('  CHYBA: '+label); }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const dir = path.join(ROOT, 'build/ref/rules');
const traces = files.length ? files : fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort().map((f) => path.join(dir, f));
const cadence = {bonus: [], delay: [], waitTrig: [], cover: [], gameOverDelay: []};
let totalCaves = 0, totalFrames = 0, totalHooks = 0;

for (const file of traces) {
  const rec = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const tag = path.basename(file, '.json.gz');
  const block = (b) => ({byte: (a) => b[a-BLOCK], range: (a, n) => Array.from(b.slice(a-BLOCK, a-BLOCK+n))});
  const first = block(hex(rec.caves[0].setupBlock));
  // ★ $2680 new_game s volbami menu (jeskyně a obtížnost podstrčené trasovačem, hráči a joysticky)
  const g = CaveRules.newGame({caveNumber: first.byte(V.caveNumber), levelIndex: first.byte(V.levelIndex),
                               twoPlayers: rec.players === 2, twoJoysticks: rec.joysticks === 2, demo: !!rec.demo});
  // náhoda: fronta na každé místo čtení
  const queues = {}, missing = {};
  SITES.forEach((site) => { queues[site] = []; missing[site] = 0; });
  const feed = (list) => list.forEach((e) => queues[SITES[e[0]]].push(e[1]));
  const feedVbi = (list, frame) => feed(list.filter((x) => x[2] === frame));
  const rand = (site) => { const q = queues[site]; if (!q.length) { missing[site]++; return 0; } return q.shift(); };
  const leftover = (sites, label) => sites.forEach((site) => { if (queues[site].length) { check(false, `${tag}: ${label}: JS nepřečetl ${queues[site].length}× RANDOM na $${site}`); queues[site].length = 0; } });
  const screen = new Atari8Screen();
  CaveScreen.build(screen, charset, global);
  let s = null;

  // --- stav hry proti bloku záznamu ---------------------------------------------
  const checkGame = (b, label, options) => {
    options = options || {};
    totalHooks++;
    const got = {lives: g.lives, caveNumber: g.caveNumber, levelIndex: g.levelIndex, player: g.player, twoPlayers: g.twoPlayers,
                 twoJoysticks: g.twoJoysticks, gameOver: g.gameOver, demo: g.demo, intermission: g.intermission};
    // skóre a životy mění průchody (diamanty, bonusový život) — na konci jeskyně jsou výsledek, ne pravidlo
    if (options.passOutcome) delete got.lives;
    Object.keys(got).forEach((k) => check(got[k] === b.byte(V[k]), `${tag}: ${label}: ${k} orig ${b.byte(V[k])} ≠ ${got[k]}`));
    const lists = {high: g.high, statusB: g.statusB, lastRow: g.lastRow, highRow: g.highRow,
                   save1: [g.saves[0].lives, g.saves[0].caveNumber, g.saves[0].levelIndex].concat(g.saves[0].score, g.saves[0].high),
                   save2: [g.saves[1].lives, g.saves[1].caveNumber, g.saves[1].levelIndex].concat(g.saves[1].score, g.saves[1].high)};
    if (options.add) lists.add = g.add;
    if (!options.passOutcome) lists.score = g.score;
    Object.keys(lists).forEach((k) => check(same(lists[k], b.range(R[k][0], R[k][1])), `${tag}: ${label}: ${k} orig ${b.range(R[k][0], R[k][1])} ≠ ${lists[k]}`));
  };
  // --- stav jeskyně proti bloku (proměnné jako matchscan) -----------------------
  const CAVE_VARS = ['rockfordX', 'rockfordY', 'facing', 'stick', 'trig', 'moved', 'blink', 'birth', 'beforeBirth', 'noRockford', 'caveOver', 'exitReached',
                     'magicWall', 'magicWallSec', 'magicWallTime', 'diamondsEnough', 'amoebaGrow', 'amoebaGrewLast', 'amoebaEnclosed', 'amoebaMask',
                     'amoebaCount', 'amoebaCountLast', 'secondsGone', 'tick', 'flash', 'lives', 'animPhase', 'animBlink', 'animTap', 'paused', 'flicker', 'cover', 'caveTime'];
  const checkCave = (b, label) => {
    const got = {};
    CAVE_VARS.forEach((k) => { got[k] = s[k]; });
    Object.assign(got, {scrollXLo: s.scroll.xLo, scrollX: s.scroll.x, scrollYLo: s.scroll.yLo, scrollY: s.scroll.y,
                        scrollVxLo: s.scroll.vxLo, scrollVx: s.scroll.vx, scrollVyLo: s.scroll.vyLo, scrollVy: s.scroll.vy, sound2: s.sound.envelope});
    Object.keys(got).forEach((k) => check(got[k] === b.byte(V[k]), `${tag}: ${label}: ${k} orig ${b.byte(V[k])} ≠ ${got[k]}`));
    const lists = {time: s.time, collected: s.collected, needed: s.needed, diamondValue: s.diamondValue, extraValue: s.extraValue, statusA: Array.from(s.status)};
    Object.keys(lists).forEach((k) => check(same(lists[k], b.range(R[k][0], R[k][1])), `${tag}: ${label}: ${k} orig ${b.range(R[k][0], R[k][1])} ≠ ${lists[k]}`));
  };
  const lmsOf = () => s.statusText === 'gameOver' ? 0x96 : s.statusText === 'outOfTime' ? 0xC0 : s.statusText === 'bonusLife' ? 0xD5 : s.statusInGame ? 0x0B : 0x1F;
  const compareScreen = (shot, label, pendingCell, pendingChar) => {
    const want = hex(shot);
    let bad = 0, firstBad = '';
    const covered = global.caveScreen.covered.char;
    const pending = pendingCell >= 0 ? CaveScreen.cellAddresses(pendingCell, global) : [];
    for (let a = 0; a < want.length; a++) {
      if (want[a] !== screen.memory[0x5000+a]) {
        if (want[a] === covered && pending.includes(0x5000+a)) continue;
        if (pendingChar === 0x5000+a && screen.memory[0x5000+a] === covered) continue;
        bad++; if (!firstBad) firstBad = `$${(0x5000+a).toString(16)} orig ${want[a]} ≠ ${screen.memory[0x5000+a]}`;
      }
    }
    checks++;
    if (bad) { failures++; if (shown++ < 80 || verbose) console.log(`  CHYBA: ${tag}: ${label}: obraz ${bad} znaků, první ${firstBad}`); }
  };
  const drawTiles = () => { CaveScreen.drawTiles(screen, s.tiles, charset, global); };
  let lastAnimFrame = null;
  const anim = () => ({phase: s.animPhase, moving: (lastAnimFrame ? lastAnimFrame[F.stick] : s.stick) != 0x0F, facing: lastAnimFrame ? lastAnimFrame[F.facing] : s.facing,
                       blink: s.animBlink, tap: s.animTap, magicWallFrame: s.magicWallFrame === undefined ? -1 : s.magicWallFrame,
                       coverRotation: s.coverRotation, flickerRows: s.flickerRows || null});
  const compareCharset = (shot, label) => {
    CaveScreen.animate(screen, charset, anim());
    const want = hex(shot);
    let bad = 0, firstBad = '';
    for (let a = 0; a < want.length; a++) {
      if (want[a] !== screen.memory[0x4400+a]) { bad++; if (!firstBad) firstBad = `$${(0x4400+a).toString(16)} orig ${want[a]} ≠ ${screen.memory[0x4400+a]}`; }
    }
    checks++;
    if (bad) { failures++; if (shown++ < 80 || verbose) console.log(`  CHYBA: ${tag}: ${label}: sada B ${bad} bajtů, první ${firstBad}`); }
  };
  // --- jeden snímek VBI proti záznamu -------------------------------------------
  const stepFrame = (e, label, skip) => {
    // poloha Rockforda, páčka a směr ze záznamu (mění se uprostřed průchodu — ZADANI §10.6)
    s.rockfordX = e[F.rockfordX]; s.rockfordY = e[F.rockfordY]; s.stick = e[F.stick]; s.facing = e[F.facing];
    CaveFrame.step(s, rand);
    totalFrames++;
    if ((e[F.animToggle] & 1) === 0) lastAnimFrame = e;
    const lms0 = (0x5000+global.caveScreen.tileRow*s.scroll.y+s.scroll.x) & 0xFFFF;
    const got = {tick: s.tick, scrollXLo: s.scroll.xLo, scrollX: s.scroll.x, scrollYLo: s.scroll.yLo, scrollY: s.scroll.y,
                 hscrol: s.hscrol, vscrol: s.vscrol, animPhase: s.animPhase, birth: s.birth, flash: s.flash, lms0Lo: lms0 & 0xFF, lms0Hi: lms0 >> 8,
                 magicWall: s.magicWall, flicker: s.flicker, cover: s.cover, animBlink: s.animBlink, animTap: s.animTap,
                 statusLmsLo: lmsOf(), beforeBirth: s.beforeBirth, time0: s.time[0], time1: s.time[1], time2: s.time[2],
                 magicWallSec: s.magicWallSec, magicWallTime: s.magicWallTime, animToggle: s.animToggle, amoebaMask: s.amoebaMask,
                 color4: (s.colors[4] & 0xF0) | (s.bkLum || 0),
                 score0: s.score[0], score1: s.score[1], score2: s.score[2], score3: s.score[3], score4: s.score[4], score5: s.score[5],
                 lives: s.lives, paused: s.paused, caveOver: s.caveOver, exitReached: s.exitReached, player: g.player};
    Object.keys(got).forEach((k) => { if (!(skip && skip[k])) check(got[k] === e[F[k]], `${tag}: ${label} snímek ${e[F.rtclok]}: ${k} orig ${e[F[k]]} ≠ ${got[k]}`); });
  };

  for (let ci = 0; ci < rec.caves.length; ci++) {
    const c = rec.caves[ci];
    totalCaves++;
    const label = `jeskyně ${ci+1}`;
    const setupBlock = block(hex(c.setupBlock));
    // ★ $2645 cave_setup: stav hry v okamžiku načtení jeskyně
    checkGame(setupBlock, `${label} setup`);
    const cave = caves.caves[g.caveNumber-1];
    const raw = CaveGen.bytesOf(cave.raw);
    const made = CaveGen.generate(raw, g.levelIndex);
    const options = CaveRules.caveOptions(g);
    options.previous = s; options.stick = 0;
    s = CaveScan.create(made, raw, g.levelIndex, options);
    CaveRules.attach(g, s);
    s.colors = cave.header.colors;
    if (ci === 0) {
      // ★ mezi fire v menu a $2645 pár snímků bez háčku: parita animace, fáze, okraje a otočení
      // zakrývacího znaku jako v matchscan (nepozorovatelný počáteční stav)
      const frames0 = c.uncover.flatMap((f) => f.frames);
      if (frames0.length) {
        s.animToggle = (frames0[0][F.animToggle]-1) & 0xFF;
        s.animPhase = (frames0[0][F.animToggle] & 1) ? frames0[0][F.animPhase] : (frames0[0][F.animPhase]-8) & 0x3F;
      }
      s.margin = c.uncover.length ? hex(c.uncover[0].screen)[0] : 0;
      s.marginTop = [s.margin, s.margin, s.margin];
      CaveScreen.drawMargin(screen, global, s.margin);
      if (c.passes.length) {
        const shot = hex(c.passes[0].charsetB), glyph = CaveScreen.charsetData(charset).blockB;
        let found = -1;
        for (let r = 0; r < 8; r++) {
          let ok = true;
          for (let y = 0; y < 8; y++) if (shot[0x3E0+y] !== glyph[0x3E0+((y+r) & 7)]) ok = false;
          if (ok) found = r;
        }
        const rotating = frames0.concat(c.passes[0].frames).filter((e) => e[F.cover] === 1).length;
        if (found >= 0) s.coverRotation = (found-rotating) & 7;
      }
    }
    // --- fáze 0: odkrývání po snímcích (jako matchscan) -----------------------------
    const mainByFrame = {};
    c.uncover.forEach((f) => f.randoms.forEach((e) => { (mainByFrame[e[2]] = mainByFrame[e[2]] || []).push(e); }));
    const vbiAll = c.uncover.flatMap((f) => f.vbiRandoms);
    // ★ cave_start_vars $1E7D běží na konci generování ve dvou částech přes 2–3
    // snímky: nuly (tik $0839 → 0, pauza, cave_over …) a po dekadických
    // převodech odpočet $0793 = 4 / 6 — nuly se poznají jako tik 1 po nenulovém,
    // zbytek jako první nenulový odpočet
    let reset = false, timed = false, started = false, prevTick = null;
    const headerTime = CaveScan.digits(raw[0x0E+g.levelIndex], 3);
    const setupEntry = (entry) => {
      if (!reset && prevTick !== null && entry[F.tick] === 1 && prevTick !== 0) { reset = true; CaveScan.startVarsZero(s); }
      prevTick = entry[F.tick];
      if (reset && !timed && entry[F.time0] === headerTime[0] && entry[F.time1] === headerTime[1] && entry[F.time2] === headerTime[2]) { timed = true; CaveScan.startVarsTime(s); }
      if (!started && entry[F.birth] !== 0) {
        if (!reset) { const tick = s.tick; CaveScan.startVarsZero(s); s.tick = tick; reset = true; }
        if (!timed) { CaveScan.startVarsTime(s); timed = true; }
        CaveScan.startVarsRest(s, {birth: options.birth}); started = true;
      }
      // ★ $2676 shodí kryt hned po plném kreslení $1954 — v tom snímku se dokreslí
      if (entry[F.cover] === 0 && s.cover && s.uncoverRound >= 120) { while (CaveScan.drawRow(s)); drawTiles(); CaveScreen.drawMargin(screen, global, s.margin); }
    };
    let firstEntry = true;
    for (const f of c.uncover) {
      for (const entry of f.frames) {
        setupEntry(entry);
        feedVbi(vbiAll, entry[F.rtclok]);
        // první jeskyně před cave_start_vars: hodnoty z bootu (matchscan); od druhé jeskyně se všechno nese dál
        // — jen barvy $1E71 přijdou až za háčkem $2904, který je těsně před VBI: první snímek má ještě staré
        const before = (ci === 0 && !started) ? {birth: true, beforeBirth: true, time0: true, time1: true, time2: true, magicWall: true, magicWallSec: true, magicWallTime: true,
                                                 amoebaMask: true, flicker: true, statusLmsLo: true, hscrol: !!options.intermission, vscrol: !!options.intermission,
                                                 score0: true, score1: true, score2: true, score3: true, score4: true, score5: true, lives: true, paused: true, caveOver: true, exitReached: true}
                     : (firstEntry && ci > 0) ? {color4: true} : null;
        firstEntry = false;
        stepFrame(entry, `${label} odkrývání`, before);
      }
      const k = f.clock.rtclok & 0xFF;
      let reads = 0, lastDrawn = -1;
      Object.keys(mainByFrame).map(Number).filter((fr) => ((k-fr) & 0xFF) >= 1 && ((k-fr) & 0xFF) < 8).sort((a, b) => ((a-k) & 0xFF)-((b-k) & 0xFF)).forEach((fr) => {
        mainByFrame[fr].forEach((e) => { reads++; const x = e[1]; if (x <= 39) lastDrawn = CaveScan.uncoverAccept(s, x); });
        delete mainByFrame[fr];
      });
      if (s.uncoverRound < 120 && reads) {
        drawTiles();
        compareScreen(f.screen, `${label} odkrývání kolo ${s.uncoverRound} řádek ${s.uncoverRow}`, lastDrawn);
      }
      leftover(SITES, `${label} odkrývání`);
    }
    Object.keys(mainByFrame).forEach((fr) => mainByFrame[fr].forEach((e) => { const x = e[1]; if (x <= 39) CaveScan.uncoverAccept(s, x); }));
    check(s.uncoverRound === 120, `${tag}: ${label}: odkrývání skončilo po ${s.uncoverRound} kolech`);
    // --- první průchod: stav jeskyně i hry ------------------------------------------
    // (háček $2884 přijde hned za cave_setup; snímky před ním ještě vidí kryt, dokud $1954 kreslí)
    if (!c.passes.length) { check(false, `${tag}: ${label}: bez průchodů`); continue; }
    const p0 = c.passes[0];
    feed(p0.randoms);
    for (const entry of p0.frames) { setupEntry(entry); feedVbi(p0.vbiRandoms, entry[F.rtclok]); stepFrame(entry, `${label} před 1. průchodem`); }
    leftover(SITES, `${label} před 1. průchodem`);
    if (s.cover) { while (CaveScan.drawRow(s)); drawTiles(); CaveScreen.drawMargin(screen, global, s.margin); }
    if (rec.demo) s.stick = demoScript[0] & 0x0F;                       // ★ $28B1: první bajt skriptu je v $0788 před prvním průchodem
    if (!started) { check(false, `${tag}: ${label}: cave_start_vars se v záznamu neobjevily`); CaveScan.startVars(s, {birth: options.birth}); }
    const b0 = block(hex(p0.block));
    const grid0 = hex(p0.grid);
    let badGrid = 0, firstGrid = '';
    for (let i = 3*40; i < 960; i++) { checks++; if (grid0[i] !== s.grid[i]) { badGrid++; failures++; if (!firstGrid) firstGrid = `(${i % 40},${Math.floor(i/40)})`; } }
    if (badGrid && (shown++ < 80 || verbose)) console.log(`  CHYBA: ${tag}: ${label} 1. průchod: mřížka ${badGrid} buněk, první ${firstGrid}`);
    compareScreen(p0.screen, `${label} 1. průchod`);
    compareCharset(p0.charsetB, `${label} 1. průchod`);
    checkCave(b0, `${label} 1. průchod`);
    checkGame(b0, `${label} 1. průchod`);
    check(lmsOf() === hex(p0.dlist)[4], `${tag}: ${label} 1. průchod: LMS stavu orig ${hex(p0.dlist)[4]} ≠ ${lmsOf()}`);
    if (verbose) console.log(`${tag}: ${label}: ${c.scenario.kind} — jeskyně ${g.caveNumber}/${g.levelIndex+1}, hráč ${g.player+1}, životy ${g.lives}, narození ${options.birth}, průchodů ${c.passes.length}`);

    // --- konec jeskyně: stav ze záznamu ($288C / $28E2) -------------------------------
    const end = c.end;
    if (!end) { check(false, `${tag}: ${label}: bez konce`); break; }
    const be = block(hex(end.block));
    // co se od 1. průchodu nemění průchody, nese JS sám: hra
    checkGame(be, `${label} ${end.hook}`, {passOutcome: true});
    // stav jeskyně po posledním průchodu — průchody nejsou tady, jsou v matchscan
    CAVE_VARS.forEach((k) => { s[k] = be.byte(V[k]); });
    Object.keys(R).filter((k) => ['time', 'collected', 'needed', 'diamondValue', 'extraValue'].includes(k)).forEach((k) => { s[k] = be.range(R[k][0], R[k][1]); });
    be.range(R.score[0], 6).forEach((d, i) => { g.score[i] = d; });
    s.scroll.xLo = be.byte(V.scrollXLo); s.scroll.x = be.byte(V.scrollX); s.scroll.yLo = be.byte(V.scrollYLo); s.scroll.y = be.byte(V.scrollY);
    s.scroll.vxLo = be.byte(V.scrollVxLo); s.scroll.vx = be.byte(V.scrollVx); s.scroll.vyLo = be.byte(V.scrollVyLo); s.scroll.vy = be.byte(V.scrollVy);
    s.sound.envelope = be.byte(V.sound2);
    s.status = hex(end.status).slice(0, 20);
    s.statusInGame = hex(end.dlist)[4] === 0x0B; s.statusText = null;
    s.grid = hex(end.grid); s.tiles = Uint8Array.from(s.grid);
    s.covered.fill(0); s.coverRounds = 0; s.coverRow = 0; s.coverMisses = 0;
    screen.memory.set(hex(end.screen), 0x5000);
    screen.memory.set(hex(end.charsetB), 0x4400);
    const lastVbi = [].concat(...c.passes.map((p) => p.frames), end.frames).pop();
    if (lastVbi) {
      s.hscrol = lastVbi[F.hscrol]; s.vscrol = lastVbi[F.vscrol]; s.animToggle = lastVbi[F.animToggle]; s.bkLum = lastVbi[F.color4] & 0x0F;
    }
    s.magicWallFrame = s.magicWall === 1 ? (s.animPhase & 0x1F) : -1;
    s.flickerRows = s.flicker > 1 ? [0x4700, 0x4708, 0x4780, 0x4788].map((a) => screen.memory[a]).concat([0x4700, 0x4708, 0x4780, 0x4788].map((a) => screen.memory[a+4])) : null;
    {
      // otočení zakrývacího znaku ze sady B
      const glyph = CaveScreen.charsetData(charset).blockB;
      for (let r = 0; r < 8; r++) { let ok = true; for (let y = 0; y < 8; y++) if (screen.memory[0x47E0+y] !== glyph[0x3E0+((y+r) & 7)]) ok = false; if (ok) s.coverRotation = r; }
    }
    // zbylá náhoda průchodů se zahodí (průchody se nepřehrávají)
    SITES.forEach((site) => { queues[site].length = 0; });
    lastAnimFrame = null;

    // --- konec jeskyně po snímcích -----------------------------------------------------
    // ★ $288C: cave_end_vars — bonus (po snímcích, řízený nahraným časem), nebo život / další jeskyně hned
    const timeAtEnd = s.time[0]*100+s.time[1]*10+s.time[2];
    const scoreAtEnd = g.score.reduce((n, d) => n*10+d, 0);
    // ★ cave_end_vars hned za háčkem — ale VBI může padnout mezi ně (háček pár
    // řádků před ní), proto se provede u první položky snímku s paused = 1
    // — a to ve dvou částech, protože VBI může padnout i mezi pauzu a zbytek:
    // pauza u paused = 1, zbytek u první pozorovatelné změny (životy, hráč,
    // cave_over = 0 u bonusu), nejpozději v háčku $2915
    let what = null, paused = false, bonusDone = 0, bonusTimes = 0, bonusScores = 0, bonusFinished = true;
    const applyEndVars = () => {
      if (rec.demo && !s.exitReached) { what = 'demoNoExit'; paused = true; }   // ★ $28E5: bez cave_end_vars, bez pauzy
      else {
        if (!paused) { paused = true; CaveRules.caveEndPause(g, s); }
        what = CaveRules.caveEndBranch(g, s);
      }
      bonusFinished = what !== 'bonus';
      step = what === 'bonus' ? 'bonus' : 'afterVars';
    };
    const hooks = c.hooks.slice();
    const events = [];   // snímky a háčky po čase
    c.endFrames.forEach((f) => events.push({kind: 'frame', at: f.clock.rtclok, f}));
    hooks.forEach((h) => events.push({kind: 'hook', at: h.clock.rtclok, h}));
    events.sort((a, b) => a.at-b.at || (a.kind === 'hook' ? 1 : -1));   // háček přijde uprostřed snímku, tj. po zastavení na konci VBI téhož čísla
    let step = 'endVars';
    // ★ čtení zakrývání ($1886) podle razítka RTCLOK, ne podle snímku, ve kterém je
    // nástroj přečetl (kruhový log je občas dodá o snímek později): razítko je
    // dolní bajt, celý čas se doplní z hodin toho čtení
    const coverAll = [];
    events.forEach((ev) => {
      const src = ev.kind === 'hook' ? ev.h : ev.f;
      src.randoms.filter((e) => SITES[e[0]] === '1886').forEach((e) => coverAll.push({at: ev.at-((ev.at-e[2]) & 0xFF), value: e[1]}));
    });
    let coverNext = 0;
    const coverReadsUntil = (clock) => { const out = []; while (coverNext < coverAll.length && coverAll[coverNext].at < clock) out.push([8, coverAll[coverNext++].value]); return out; };
    let outOfTimeSeen = false, onSince = null, offSince = null, waits = [], coverStart = null, coverEnd = null, lastCoverWrite = -1, endAt = end.clock.rtclok, caveEndAt = null, afterAt = null, lmsBefore = -1;
    let statusFrames = 0;
    for (const ev of events) {
      if (ev.kind === 'hook') {
        const h = ev.h, hb = block(hex(h.block));
        feed(h.randoms.filter((e) => SITES[e[0]] !== '1886'));
        // háček je uprostřed snímku: čtení s jeho razítkem jsou před ním jen u `after` (zakrývání skončilo), jinde až po něm
        applyCoverReads(coverReadsUntil(h.clock.rtclok+(h.hook === 'after' ? 1 : 0)), h.clock.rtclok);
        for (const entry of h.frames) { feedVbi(h.vbiRandoms, entry[F.rtclok]); if (afterEnd(entry, h.clock.rtclok)) endEntry(entry, `${label} ${h.hook}`); }
        if (h.hook === 'caveEnd') {
          // ★ $2915: po cave_end_vars a čekání na flicker
          caveEndAt = h.clock.rtclok;
          if (what === null) applyEndVars();
          check(bonusFinished, `${tag}: ${label} caveEnd: bonus ještě neskončil (${bonusTimes} sekund, čas ${s.time})`);
          if (what === 'bonus') {
            while (bonusScores < bonusTimes) { bonusScores++; CaveRules.bonusScore(g, s); }
            while (bonusDone < bonusTimes) { bonusDone++; CaveRules.bonusCount(g, s); }
            CaveRules.bonusDone(g, s);                                   // ★ $2808: zpoždění, další jeskyně, stavový řádek
          }
          if (rec.demo) g.caveNumber = 0;                              // ★ $28ED
          check(s.flicker === 0, `${tag}: ${label} caveEnd: flicker ${s.flicker} ≠ 0 (L1598 čeká)`);
          checkGame(hb, `${label} caveEnd`, {add: what === 'bonus'});
          check(same(Array.from(s.status), hb.range(R.statusA[0], 20)), `${tag}: ${label} caveEnd: stavový řádek $080B`);
          check(s.paused === hb.byte(V.paused), `${tag}: ${label} caveEnd: paused orig ${hb.byte(V.paused)} ≠ ${s.paused}`);
          // ★ $2012: OUT OF TIME jen při seconds_gone == čas jeskyně; pak next_status
          // — ten se v JS provede ve snímku, kde záznam ukáže změnu LMS nebo kryt
          // (háček přijde těsně před VBI a záznam změnu vidí až o snímek dál)
          step = CaveRules.outOfTime(s) ? 'outOfTime' : 'status';
          lmsBefore = hex(h.lms)[0];
          if (step === 'outOfTime') { s.statusText = 'outOfTime'; outOfTimeSeen = true; }
        } else if (h.hook === 'after') {
          // ★ $2918: po cave_end — zakryto, LMS podle textu
          afterAt = h.clock.rtclok;
          check(s.coverRounds === 48 || s.coverRounds === 0, `${tag}: ${label} after: zakrývání skončilo po ${s.coverRounds} kolech`);
          if (step === 'cover') finishCover();
          checkGame(hb, `${label} after`);
          drawTiles();
          compareScreen(h.screen, `${label} after (zakryto)`);
          check(lmsOf() === hex(h.lms)[0], `${tag}: ${label} after: LMS stavu orig ${hex(h.lms)[0]} ≠ ${lmsOf()}`);
          check(same(g.lastRow.concat(g.highRow), Array.from(hex(h.titleRows))), `${tag}: ${label} after: řádky LAST/HIGH`);
          if (coverStart !== null && coverEnd !== null) cadence.cover.push(coverEnd-coverStart);
          step = 'next';
        } else if (h.hook === 'setup') {
          // další jeskyně: stav hry zkontroluje začátek další iterace
          check(g.caveNumber !== 0, `${tag}: ${label} setup: JS má jeskyni 0 (titulku)`);
        } else if (h.hook === 'title') {
          check(g.caveNumber === 0, `${tag}: ${label} title: JS má jeskyni ${g.caveNumber}, ne titulku`);
          checkGame(hb, `${label} title`);
          check(same(g.lastRow.concat(g.highRow), Array.from(hex(h.titleRows))), `${tag}: ${label} title: řádky LAST/HIGH orig ${h.titleRows} ≠ ${Buffer.from(g.lastRow.concat(g.highRow)).toString('hex')}`);
        }
        continue;
      }
      const f = ev.f;
      feed(f.randoms.filter((e) => SITES[e[0]] !== '1886'));
      const coverReads = coverReadsUntil(f.clock.rtclok);
      for (const entry of f.frames) {
        feedVbi(f.vbiRandoms, entry[F.rtclok]);
        if (!afterEnd(entry, f.clock.rtclok)) continue;                   // položka snímku před koncem jeskyně, opožděná kruhovým logem
        endEntry(entry, `${label} konec`);
      }
      // ★ zakrývání $1870: nahrané hodnoty RANDOM ($1886) tohoto snímku znak po znaku
      applyCoverReads(coverReads, f.clock.rtclok);
      // ★ mezi čtením RANDOM a zápisem znaku může přijít VBI: poslední zapsaný
      // znak smí v záznamu ještě chybět; po 48. kole plní $1852 obraz přes
      // 2–3 snímky — ten se porovná až v háčku za ním
      if (f.screen && s.coverRounds < 48) compareScreen(f.screen, `${label} konec snímek ${f.clock.rtclok}`, -1, lastCoverWrite);
      leftover(SITES, `${label} konec snímek ${f.clock.rtclok}`);
    }
    if (what === 'bonus' && caveEndAt !== null && cadence.bonus.length) {
      const last = cadence.bonus[cadence.bonus.length-1];
      cadence.delay.push((caveEndAt-endAt)-last.frames);
    }
    if (outOfTimeSeen) waits.forEach((w) => cadence.waitTrig.push(w));
    if (g.gameOver && caveEndAt !== null && coverStart !== null) cadence.gameOverDelay.push(coverStart-caveEndAt);
    check(outOfTimeSeen === c.endFrames.some((f) => f.frames.some((e) => e[F.statusLmsLo] === 0xC0)), `${tag}: ${label}: OUT OF TIME JS ${outOfTimeSeen} ≠ záznam`);
    SITES.forEach((site) => check(missing[site] === 0, `${tag}: ${label}: JS přečetl ${missing[site]}× RANDOM na $${site} navíc`));
    SITES.forEach((site) => { missing[site] = 0; queues[site].length = 0; });

    // jedna položka snímku po konci jeskyně: co hlavní smyčka mění uprostřed
    // snímku, řídí záznam (kadence je model), hodnoty počítá kód
    function endEntry(entry, lbl) {
        if (!paused && entry[F.paused] === 1) { paused = true; CaveRules.caveEndPause(g, s); }   // ★ $282D
        if (what === null && paused && (entry[F.lives] !== s.lives || entry[F.player] !== g.player || (s.exitReached && entry[F.caveOver] === 0))) applyEndVars();   // ★ $2830
        // ★ Co hlavní smyčka mění uprostřed snímku, řídí záznam — kadence je
        // model (CaveRules.COST), hodnoty jsou kód: sekundy bonusu podle
        // nahraného času, LMS OUT OF TIME, kryt nahoru ($2032)
        if (step === 'bonus') {
          // iterace není vůči VBI atomická: čas, skóre a čítač se dorovnají každý zvlášť
          const t = entry[F.time0]*100+entry[F.time1]*10+entry[F.time2];
          const scoreNow = [0, 1, 2, 3, 4, 5].reduce((n, i) => n*10+entry[F['score'+i]], 0);
          const targetTime = (timeAtEnd-t+1000) % 1000, targetScore = Math.round((scoreNow-scoreAtEnd+1000000) % 1000000/(g.levelIndex+1)), targetCount = entry[F.bonusCount];
          while (bonusTimes < targetTime && !bonusFinished) { bonusTimes++; CaveRules.bonusTime(s); if (s.caveOver) bonusFinished = true; }
          while (bonusScores < targetScore && bonusScores < bonusTimes) { bonusScores++; CaveRules.bonusScore(g, s); }
          while (bonusDone < targetCount && bonusDone < bonusScores) { bonusDone++; CaveRules.bonusCount(g, s); }
          if (bonusFinished && bonusScores === bonusTimes && step === 'bonus') {
            cadence.bonus.push({iterations: bonusTimes, frames: (entry[F.rtclok]-endAt) & 0xFF});
            step = 'bonusDelay';
          }
        }
        if (step === 'outOfTime') {
          const on = entry[F.statusLmsLo] === 0xC0;
          if (on && onSince === null) { onSince = entry[F.rtclok]; if (offSince !== null) { waits.push(((entry[F.rtclok]-offSince) & 0xFF)/3); offSince = null; } }
          if (!on && onSince !== null) { waits.push((entry[F.rtclok]-onSince) & 0xFF); onSince = null; offSince = entry[F.rtclok]; }
          s.statusText = on ? 'outOfTime' : null;
          s.trig = entry[F.trig];                                          // ★ $1F97: wait_trig ukládá tlačítko do $0843
          if (!on && (entry[F.statusLmsLo] !== lmsBefore || entry[F.cover] === 1)) { CaveRules.outOfTimeDone(s); step = 'status'; }
        }
        if (step === 'status' && (entry[F.statusLmsLo] !== lmsBefore || entry[F.cover] === 1)) {
          nextStatusNow();                                                // ★ $201D next_status
          step = 'covering';
        }
        if (step !== 'bonus' && step !== 'bonusDelay' && entry[F.cover] === 1 && !s.cover) {
          s.cover = 1;                                                    // ★ $2032
        }
        endStep(entry, `${lbl} (${step})`);
    }
    function afterEnd(entry, clock) {
      // položka nese jen dolní bajt RTCLOK; celý čas je z hodin zastavení, které ji přečetlo
      const full = clock-((clock-entry[F.rtclok]) & 0xFF);
      return full > endAt;
    }
    function applyCoverReads(list, at) {
      lastCoverWrite = -1;
      if (!list.length) return;
      // čtení zakrývání znamenají, že next_status i $2032 už proběhly — i když
      // položka snímku, která to ukáže, přijde (kruhový log) o snímek později
      if (step === 'outOfTime') { s.statusText = null; CaveRules.outOfTimeDone(s); step = 'status'; }
      if (step === 'status') nextStatusNow();
      if (coverStart === null) { coverStart = at; step = 'cover'; s.cover = 1; }
      list.forEach((e) => {
        const address = CaveRules.coverRead(s, e[1]);
        if (address >= 0) { screen.memory[address] = global.caveScreen.covered.char; lastCoverWrite = address; }
      });
      if (s.coverRounds >= 48 && coverEnd === null) coverEnd = at;
    }
    function endStep(entry, lbl) {
      // proměnné, které konec jeskyně mění mimo VBI a JS je řídí sám: caveOver po bonusu, exitReached
      stepFrame(entry, lbl, null);
    }
    function nextStatusNow() {
      // ★ $201D: GAME OVER / status další jeskyně (BONUS LIFE)
      const text = CaveRules.nextStatus(g, s);
      if (verbose) console.log(`${tag}: ${label}: konec — ${what}, text ${text}, další ${g.caveNumber}/${g.levelIndex+1}, životy ${g.lives}, hráč ${g.player+1}, game over ${g.gameOver}`);
    }
    function finishCover() {
      check(s.coverRounds === 48, `${tag}: ${label}: zakrývání ${s.coverRounds} kol ≠ 48`);
      CaveRules.coverCave(s);
    }
    if (g.caveNumber === 0) break;
  }
  if (verbose) console.log(`${tag}: ${rec.caves.length} jeskyní`);
}

const mean = (a) => a.length ? a.reduce((x, y) => x+y, 0)/a.length : 0;
const bonusFrames = cadence.bonus.filter((b) => b.iterations >= 5);
console.log(`kadence (harness zpomaluje o pár %; model CaveRules.COST bez háčků): bonus ${bonusFrames.length ? (mean(bonusFrames.map((b) => b.frames/b.iterations))).toFixed(3) : '-'} snímku/s (model ${(CaveRules.COST.bonusIteration/312).toFixed(3)}), `
            + `zpoždění po bonusu ${cadence.delay.length ? mean(cadence.delay).toFixed(1) : '-'} snímků (model ${(4*CaveRules.COST.delay/312).toFixed(1)}), `
            + `čekání OUT OF TIME ${cadence.waitTrig.length ? mean(cadence.waitTrig).toFixed(1) : '-'} (model ${(CaveRules.COST.waitTrig/312).toFixed(1)}), `
            + `GAME OVER ${cadence.gameOverDelay.length ? mean(cadence.gameOverDelay).toFixed(1) : '-'} (model ${(4*CaveRules.COST.delay/312).toFixed(1)}), `
            + `zakrývání ${cadence.cover.length ? mean(cadence.cover).toFixed(1) : '-'} snímků (model 24, harness +30)`);
console.log(`matchrules.mjs: ${traces.length} záznamů, ${totalCaves} jeskyní, ${totalHooks} háčků, ${totalFrames} snímků, ${checks} kontrol, ${failures} rozdílů`);
process.exit(failures ? 1 : 0);
