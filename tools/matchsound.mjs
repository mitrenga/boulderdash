#!/usr/bin/env node
/**
 * Přehraje záznam **celé hry se zápisy do POKEY** z běžícího originálu
 * (`tools/tracesound.py` → `build/ref/sound/*.json.gz`) proti kódu hry
 * a porovná **zápis po zápisu** (M6): které registry, jaké hodnoty, v jakém
 * pořadí a — u zápisů z VBI — ve kterém snímku.
 *
 *   ./tools/matchsound.mjs [--verbose] [soubor.json.gz …]
 *
 * Co se přehrává (a odkud je kód):
 * - **odkrývání a průchody** jako `matchscan.mjs`: `CaveScan.pass` s nahranou
 *   páčkou a hodnotami `RANDOM` po místech čtení, snímky VBI uprostřed
 *   průchodu tam, kde v originálu přišly (poloha skenu + počet čtení);
 *   po každém průchodu mřížka `$4C00` a proměnné jeskyně z bloku záznamu
 * - **konec jeskyně, bonus, životy, dva hráči, mezihry, zakrývání, titulka**
 *   jako `matchrules.mjs` (stav hry v háčcích, konec po snímcích řízený
 *   záznamem, kadence je model)
 * - **titulka po hře** (`--title-frames` snímků): init `$2608` a hudba `$23A0`
 *   snímek po snímku (`CaveRules.titleStep` nad stránkou not `$4400`
 *   a tabulkou `$2328`); v záznamu dema i **titulka od zapnutí** — hudba
 *   uprostřed, takže se nejdřív najde fáze a index v tabulce
 *
 * Co se u zvuku kontroluje:
 * - **zápisy z VBI** (`$1ABF` obálky každý 8. snímek, `$192C` chrastění
 *   krytu, `$1B12`/`$1B54` kouzelná zeď, hudba titulky): pro každý snímek
 *   záznamu seznam (registr, hodnota) proti tomu, co JS zapsalo v
 *   `CaveFrame.step` / `CaveRules.titleStep` téhož snímku
 * - **zápisy z hlavní smyčky** (`$1C3D` ticho, `$1F57` start jeskyně,
 *   `$1D1E` améba zticha, `$1215`/`$1225` chůze a kopání, `$1385` obálka
 *   kanálu 2 po řádcích, `$0FAD` améba po řádcích, `$2746` bonusový sweep,
 *   `$2608` init titulky): jedna posloupnost za jeskyni v pořadí záznamu
 *   proti posloupnosti JS — pořadí a hodnoty; **řádek** zápisu uvnitř
 *   průchodu je model kadence (`passSpan`) a nekontroluje se (M7)
 * - **nepozorovatelný počáteční stav** první jeskyně: proměnné obálek
 *   `$0796`–`$079C` a fáze počítadla `$085D` se vezmou z prvního zápisu
 *   obálek v záznamu (ve hře je nese předchozí jeskyně; po zapnutí je
 *   nastavuje titulka, ve které si originál nechá Rockforda kopat v logu —
 *   ty zápisy hlavní smyčky titulky od zapnutí se nepřehrávají, remake
 *   titulku nemá)
 * - vstup dema: páčka z bloku `$0788` v háčku průchodu (skript `$3BC0`
 *   ji tam dává), tlačítko 1 (bez `--demo-fire`)
 * - **snímek uprostřed průchodu** (M4 + zvuk): log snímku nese proměnné
 *   zvuku za krokem VBI, takže se pozná, jestli VBI přišla před obsluhou
 *   buňky, mezi jejím čtením `RANDOM` a zápisem proměnné (améba do hlíny,
 *   diamant), za ní, před `sound_env2` na konci řádku nebo za ním; ladění:
 *   `SOUNDDEBUG='jeskyně 1 průchod 107' SOUNDFRAME=141 ./tools/matchsound.mjs …`
 *   vypíše umístění a háčky, `SOUNDDEBUG2=1` stav při rozdílu proměnných
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

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const caves = read('data/caves.json'), charset = read('data/charset.json'), global = read('data/global.json');
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
// ★ hudba titulky: tabulka $2328 (data/global.json) a stránka not = sada B $4400 (data/charset.json, base64)
const NOTES = hex(global.title.notes);
const NOTE_PAGE = Uint8Array.from(Buffer.from(charset.blocks[1].data, 'base64')).slice(0, 256);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// ★ pořadí míst čtení RANDOM v tools/tracescan.py (id v záznamu)
const SITES = ['0D88', '0FB7', '1018', '124A', '15AD', '15B3', '15B9', '15BF', '1886', '18E5', '1936', '19D9', '19E5', '1B17'];
const MAIN_SITES = ['0D88', '0FB7', '1018', '124A', '1886', '18E5'];
// ★ log snímku: 34 polí tracescan + 14 tracerules
const FRAME_FIELDS = ['rtclok', 'tick', 'scrollXLo', 'scrollX', 'scrollYLo', 'scrollY', 'hscrol', 'vscrol',
                      'rockfordX', 'rockfordY', 'animPhase', 'stick', 'birth', 'flash', 'lms0Lo', 'lms0Hi',
                      'facing', 'magicWall', 'flicker', 'cover', 'animBlink', 'animTap', 'statusLmsLo', 'color4',
                      'beforeBirth', 'time0', 'time1', 'time2', 'magicWallSec', 'magicWallTime', 'animToggle', 'amoebaMask',
                      'scanX', 'scanY',
                      'score0', 'score1', 'score2', 'score3', 'score4', 'score5', 'lives', 'paused',
                      'bonusCount', 'outOfTimeCount', 'caveOver', 'exitReached', 'trig', 'player',
                      'soundA', 'soundB', 'soundC', 'soundD', 'soundE', 'soundF', 'sound2'];   // ★ + 7 polí tracesound: proměnné zvuku, jak je VBI viděla
const F = {}; FRAME_FIELDS.forEach((k, i) => { F[k] = i; });
const SOUND_KEYS = {soundA: 'a', soundB: 'b', soundC: 'c', soundD: 'd', soundE: 'e', soundF: 'f', sound2: 'envelope'};
const BLOCK = 0x0780;
// ★ proměnné v bloku $0780–$087F záznamu (matchrules + zvuk)
const V = {amoebaEnclosed: 0x0789, magicWall: 0x078A, magicWallSec: 0x078B, magicWallTime: 0x078C, diamondsEnough: 0x078D,
           amoebaGrow: 0x078E, amoebaGrewLast: 0x078F, beforeBirth: 0x0792, birth: 0x0793, noRockford: 0x0794, caveOver: 0x0795,
           soundA: 0x0796, soundB: 0x0797, soundC: 0x0798, sound2: 0x0799, soundD: 0x079A, soundE: 0x079B, soundF: 0x079C,
           facing: 0x079D, rockfordX: 0x079E, rockfordY: 0x079F, amoebaMask: 0x07A1, amoebaCount: 0x07A2, amoebaCountLast: 0x07A3,
           paused: 0x07A4, player: 0x07A6, twoPlayers: 0x07A7, exitReached: 0x07A8, gameOver: 0x07A9, demo: 0x07AB, twoJoysticks: 0x07AD,
           flash: 0x07AE, intermission: 0x07AF, lives: 0x07B6, caveNumber: 0x07B7, levelIndex: 0x07B8,
           flicker: 0x0833, tick: 0x0839, secondsGone: 0x083A, moved: 0x0842, trig: 0x0843, blink: 0x0844,
           scrollXLo: 0x0845, scrollX: 0x0846, scrollVxLo: 0x0847, scrollVx: 0x0848, scrollYLo: 0x0849, scrollY: 0x084A, scrollVyLo: 0x084B, scrollVy: 0x084C,
           animTap: 0x085A, animBlink: 0x085B, animPhase: 0x085C, soundCounter: 0x085D, animToggle: 0x085E, cover: 0x0859, caveTime: 0x0865, bonusCounter: 0x0879, stick: 0x0788};
const R = {add: [0x07B0, 6], diamondValue: [0x07B3, 3], score: [0x07B9, 6], high: [0x07BF, 6], save1: [0x07C5, 15], save2: [0x07D4, 15],
           lastRow: [0x07E3, 20], highRow: [0x07F7, 20], statusA: [0x080B, 20], statusB: [0x081F, 20],
           time: [0x0836, 3], collected: [0x083B, 2], needed: [0x083D, 2], extraValue: [0x083F, 3]};
const LINES = 312;

let checks = 0, failures = 0, shown = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; if (shown++ < 80 || verbose) console.log('  CHYBA: '+label); }
}
const fmt = (w) => w ? `$${w[1].toString(16)}=${w[2] !== undefined ? w[2] : w[1]}` : '-';
const fmtList = (list) => list.map((w) => `${w[0]}:${w[1].toString(16).padStart(2, '0')}`).join(' ');

// háček před obsluhou buňky (snímky uprostřed průchodu, matchscan M4)
let midHook = null, midHookAfter = null;
CaveScan.HANDLERS.forEach((h, code) => { if (h) CaveScan.HANDLERS[code] = (c) => { if (midHook) midHook(c.ptr+CaveScan.O.S); h(c); if (midHookAfter) midHookAfter(c.ptr+CaveScan.O.S); }; });
let midCell = -1;   // the cell whose handler runs (for a vertical blank between its RANDOM read and its write of a sound variable)

const dir = path.join(ROOT, 'build/ref/sound');
const traces = files.length ? files : fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort().map((f) => path.join(dir, f));
let totalCaves = 0, totalFrames = 0, totalPasses = 0, totalWrites = 0, totalTitleFrames = 0, skippedBoot = 0;

for (const file of traces) {
  const rec = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const tag = path.basename(file, '.json.gz');
  if (!rec.sound) { check(false, `${tag}: záznam bez zvuku (tracerules, ne tracesound)`); continue; }
  const block = (b) => ({byte: (a) => b[a-BLOCK], range: (a, n) => Array.from(b.slice(a-BLOCK, a-BLOCK+n))});
  const first = block(hex(rec.caves[0].setupBlock));
  const g = CaveRules.newGame({caveNumber: first.byte(V.caveNumber), levelIndex: first.byte(V.levelIndex),
                               twoPlayers: rec.players === 2, twoJoysticks: rec.joysticks === 2, demo: !!rec.demo});
  // náhoda: fronta na každé místo čtení
  const queues = {}, missing = {};
  SITES.forEach((site) => { queues[site] = []; missing[site] = 0; });
  const feed = (list) => list.forEach((e) => queues[SITES[e[0]]].push(e[1]));
  const feedVbi = (list, frame) => feed(list.filter((x) => x[2] === frame));
  const rand = (site) => { const q = queues[site]; if (!q.length) { missing[site]++; return 0; } return q.shift(); };
  const leftover = (sites, label) => sites.forEach((site) => { if (queues[site].length) { check(false, `${tag}: ${label}: JS nepřečetl ${queues[site].length}× RANDOM na $${site}`); queues[site].length = 0; } });
  let s = null;
  // ★ záplata hlavičky scénáře (tracescan.SCENARIOS, kouzelná zeď: hlavička[1] = 1) je v $5F00 = v tabulce
  // jeskyní, takže platí i pro další hry téže jeskyně v záznamu
  const headerPatches = {};

  // --- zvuk: očekávané proudy a porovnání -------------------------------------------
  let expMain = [], mainPos = 0, expVbi = [], vbiPos = 0, soundLabel = '';
  // zápisy JS z hlavní smyčky: v pořadí za sebou proti záznamu jeskyně
  const flushMain = (label) => {
    const got = s ? s.pokey.splice(0, s.pokey.length) : [];
    got.forEach((w) => {
      const want = expMain[mainPos];
      totalWrites++;
      check(want && want[0] === w[1] && want[1] === w[2], `${tag}: ${label}: zápis hlavní smyčky #${mainPos} orig ${want ? fmtList([want]) : 'nic'} ≠ JS ${w[1]}:${w[2].toString(16).padStart(2, '0')}`);
      if (want) mainPos++;
    });
  };
  // zápisy JS z VBI snímku `frame` proti záznamu se stejným razítkem
  const vbiFrame = (frame, got, label) => {
    const want = [];
    while (vbiPos < expVbi.length && expVbi[vbiPos][2] === frame) want.push(expVbi[vbiPos++]);
    totalWrites += Math.max(want.length, got.length);
    const ok = want.length === got.length && want.every((w, i) => w[0] === got[i][1] && w[1] === got[i][2]);
    check(ok, `${tag}: ${label} snímek ${frame}: VBI orig [${fmtList(want)}] ≠ JS [${fmtList(got.map((w) => [w[1], w[2]]))}]`);
  };
  const expectWrites = (main, vbi) => { expMain = main; mainPos = 0; expVbi = vbi; vbiPos = 0; };
  const finishWrites = (label) => {
    check(mainPos === expMain.length, `${tag}: ${label}: originál zapsal ${expMain.length-mainPos} zápisů hlavní smyčky navíc (od #${mainPos}: ${fmtList(expMain.slice(mainPos, mainPos+12))})`);
    check(vbiPos === expVbi.length, `${tag}: ${label}: originál zapsal ${expVbi.length-vbiPos} zápisů VBI navíc (od snímku ${expVbi[vbiPos] ? expVbi[vbiPos][2] : '-'}: ${fmtList(expVbi.slice(vbiPos, vbiPos+8))})`);
  };

  // --- stav hry proti bloku záznamu (matchrules) --------------------------------------
  const checkGame = (b, label, options) => {
    options = options || {};
    const got = {lives: g.lives, caveNumber: g.caveNumber, levelIndex: g.levelIndex, player: g.player, twoPlayers: g.twoPlayers,
                 twoJoysticks: g.twoJoysticks, gameOver: g.gameOver, demo: g.demo, intermission: g.intermission};
    if (options.passOutcome) delete got.lives;
    Object.keys(got).forEach((k) => check(got[k] === b.byte(V[k]), `${tag}: ${label}: ${k} orig ${b.byte(V[k])} ≠ ${got[k]}`));
    const lists = {high: g.high, statusB: g.statusB, lastRow: g.lastRow, highRow: g.highRow,
                   save1: [g.saves[0].lives, g.saves[0].caveNumber, g.saves[0].levelIndex].concat(g.saves[0].score, g.saves[0].high),
                   save2: [g.saves[1].lives, g.saves[1].caveNumber, g.saves[1].levelIndex].concat(g.saves[1].score, g.saves[1].high)};
    if (options.add) lists.add = g.add;
    if (!options.passOutcome) lists.score = g.score;
    Object.keys(lists).forEach((k) => check(same(lists[k], b.range(R[k][0], R[k][1])), `${tag}: ${label}: ${k} orig ${b.range(R[k][0], R[k][1])} ≠ ${lists[k]}`));
  };
  const CAVE_VARS = ['rockfordX', 'rockfordY', 'facing', 'stick', 'trig', 'moved', 'blink', 'birth', 'beforeBirth', 'noRockford', 'caveOver', 'exitReached',
                     'magicWall', 'magicWallSec', 'magicWallTime', 'diamondsEnough', 'amoebaGrow', 'amoebaGrewLast', 'amoebaEnclosed', 'amoebaMask',
                     'amoebaCount', 'amoebaCountLast', 'secondsGone', 'tick', 'flash', 'lives', 'animPhase', 'animBlink', 'animTap', 'paused', 'flicker', 'cover', 'caveTime'];
  const soundOf = () => ({soundA: s.sound.a, soundB: s.sound.b, soundC: s.sound.c, sound2: s.sound.envelope, soundD: s.sound.d, soundE: s.sound.e, soundF: s.sound.f});
  const checkCave = (b, label, skip) => {
    const got = {};
    CAVE_VARS.forEach((k) => { if (!(skip && skip[k])) got[k] = s[k]; });
    Object.assign(got, {scrollXLo: s.scroll.xLo, scrollX: s.scroll.x, scrollYLo: s.scroll.yLo, scrollY: s.scroll.y,
                        scrollVxLo: s.scroll.vxLo, scrollVx: s.scroll.vx, scrollVyLo: s.scroll.vyLo, scrollVy: s.scroll.vy}, soundOf());
    Object.keys(got).forEach((k) => check(got[k] === b.byte(V[k]), `${tag}: ${label}: ${k} orig ${b.byte(V[k])} ≠ ${got[k]}`));
    const lists = {time: s.time, collected: s.collected, needed: s.needed, diamondValue: s.diamondValue, extraValue: s.extraValue, statusA: Array.from(s.status)};
    Object.keys(lists).forEach((k) => check(same(lists[k], b.range(R[k][0], R[k][1])), `${tag}: ${label}: ${k} orig ${b.range(R[k][0], R[k][1])} ≠ ${lists[k]}`));
  };
  const compareGrid = (shot, label) => {
    const grid = hex(shot);
    let bad = 0, firstBad = '';
    for (let i = 3*40; i < 960; i++) { checks++; if (grid[i] !== s.grid[i]) { bad++; failures++; if (!firstBad) firstBad = `(${i % 40},${Math.floor(i/40)}) orig $${grid[i].toString(16)} ≠ $${s.grid[i].toString(16)}`; } }
    if (bad && (shown++ < 80 || verbose)) console.log(`  CHYBA: ${tag}: ${label}: mřížka ${bad} buněk, první ${firstBad}`);
  };
  const lmsOf = () => s.statusText === 'gameOver' ? 0x96 : s.statusText === 'outOfTime' ? 0xC0 : s.statusText === 'bonusLife' ? 0xD5 : s.statusInGame ? 0x0B : 0x1F;

  // --- jeden snímek VBI proti záznamu: proměnné a zápisy do POKEY ------------------------
  // ★ log snímku vzniká za krokem VBI: v každém 8. snímku ($1ABF) je v něm b už zpola a e o jedna menší —
  // stav JS před krokem se porovnává s logem přes tentýž krok
  const soundAfterStep = () => {
    const env = ((s.sound.counter+1) & 7) === 0;
    return {soundA: s.sound.a, soundB: env ? s.sound.b >> 1 : s.sound.b, soundC: s.sound.c, soundD: s.sound.d,
            soundE: env && s.sound.e ? s.sound.e-1 : s.sound.e, soundF: s.sound.f, sound2: s.sound.envelope};
  };
  const soundMatches = (e) => { const after = soundAfterStep(); return Object.keys(SOUND_KEYS).every((k) => after[k] === e[F[k]]); };
  const stepFrame = (e, label, skip) => {
    s.rockfordX = e[F.rockfordX]; s.rockfordY = e[F.rockfordY]; s.stick = e[F.stick]; s.facing = e[F.facing];
    const n0 = s.pokey.length;
    CaveFrame.step(s, rand);
    // ★ proměnné zvuku po kroku ($1ABF čte $0796–$079C a půlí b, snižuje e): JS musí být ve stejném stavu
    if (!(skip && skip.sound)) {
      Object.keys(SOUND_KEYS).forEach((k) => {
        const ok = s.sound[SOUND_KEYS[k]] === e[F[k]];
        if (!ok && process.env.SOUNDDEBUG2) console.log(`    ${label} snímek ${e[F.rtclok]}: log time ${e[F.time0]}${e[F.time1]}${e[F.time2]} bonusCount ${e[F.bonusCount]} score ${e[F.score4]}${e[F.score5]} | JS time ${s.time.join('')} c ${s.sound.c} a ${s.sound.a} b ${s.sound.b} counter ${s.sound.counter} caveOver ${s.caveOver}`);
        check(ok, `${tag}: ${label} snímek ${e[F.rtclok]}: ${k} po VBI orig ${e[F[k]]} ≠ ${s.sound[SOUND_KEYS[k]]}`);
      });
    }
    const vbi = s.pokey.splice(n0, s.pokey.length-n0);
    vbiFrame(e[F.rtclok], vbi, label);
    totalFrames++;
    const got = {tick: s.tick, scrollXLo: s.scroll.xLo, scrollX: s.scroll.x, scrollYLo: s.scroll.yLo, scrollY: s.scroll.y,
                 hscrol: s.hscrol, vscrol: s.vscrol, animPhase: s.animPhase, birth: s.birth, flash: s.flash,
                 magicWall: s.magicWall, flicker: s.flicker, cover: s.cover, animBlink: s.animBlink, animTap: s.animTap,
                 statusLmsLo: lmsOf(), beforeBirth: s.beforeBirth, time0: s.time[0], time1: s.time[1], time2: s.time[2],
                 magicWallSec: s.magicWallSec, magicWallTime: s.magicWallTime, animToggle: s.animToggle, amoebaMask: s.amoebaMask,
                 score0: s.score[0], score1: s.score[1], score2: s.score[2], score3: s.score[3], score4: s.score[4], score5: s.score[5],
                 lives: s.lives, paused: s.paused, caveOver: s.caveOver, exitReached: s.exitReached, player: g.player};
    Object.keys(got).forEach((k) => { if (!(skip && skip[k])) check(got[k] === e[F[k]], `${tag}: ${label} snímek ${e[F.rtclok]}: ${k} orig ${e[F[k]]} ≠ ${got[k]}`); });
  };

  // --- snímky uprostřed průchodu (matchscan M4) --------------------------------------------
  let mid = null;
  const stepMid = (f, who) => {
    if (process.env.SOUNDDEBUG && mid && mid.label === process.env.SOUNDDEBUG) console.log(`  mid ${who}: snímek ${f.entry[F.rtclok]} pos ${f.pos} (scan ${f.entry[F.scanX]},${f.entry[F.scanY]}) readsBefore ${f.readsBefore} reads ${mid.reads} log sound2 ${f.entry[F.sound2]} b ${f.entry[F.soundB]} JS env ${s.sound.envelope} b ${s.sound.b}`);
    const own = {rockfordX: s.rockfordX, rockfordY: s.rockfordY, stick: s.stick, facing: s.facing};
    const was = mid; mid = null;
    feedVbi(was.vbiRandoms, f.entry[F.rtclok]);
    stepFrame(f.entry, was.label);
    mid = was;
    Object.assign(s, own);
  };
  // ★ VBI uprostřed obsluhy buňky: před ní, když viděla proměnné zvuku jako JS před obsluhou; jinak (obsluha
  // je už zapsala — kámen, diamant, sběr) až za ní
  const dbg = (who, index) => { if (process.env.SOUNDDEBUG && mid && mid.label === process.env.SOUNDDEBUG && mid.pending.length && process.env.SOUNDFRAME == mid.pending[0].entry[F.rtclok]) console.log(`    hook ${who} ${index}: pending pos ${mid.pending[0].pos} readsBefore ${mid.pending[0].readsBefore} reads ${mid.reads} log s2 ${mid.pending[0].entry[F.sound2]} b ${mid.pending[0].entry[F.soundB]} JS env ${s.sound.envelope} b ${s.sound.b} code $${s.grid[index+CaveScan.O.S] !== undefined ? s.grid[index+CaveScan.O.S].toString(16) : '?'}`); };
  const midBeforeCell = (index) => {
    if (!mid) return;
    midCell = index;
    dbg('before', index);
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads && (mid.pending[0].pos < index || (mid.pending[0].pos === index && soundMatches(mid.pending[0].entry)))) stepMid(mid.pending.shift(), `before cell ${index}`);
  };
  const midAfterCell = (index) => {
    if (!mid) return;
    dbg('after', index);
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads && mid.pending[0].pos <= index) stepMid(mid.pending.shift(), `after cell ${index}`);
  };
  const midBeforeRead = () => {
    if (!mid) return;
    dbg('read', -1);
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads) stepMid(mid.pending.shift(), 'before read');
    mid.reads++;
    // ★ VBI za čtením, ale před zápisem proměnné zvuku téže obsluhy (améba do hlíny $0F94, diamant $0D88): stav JS teď = co VBI viděla
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads && mid.pending[0].pos === midCell && soundMatches(mid.pending[0].entry)) stepMid(mid.pending.shift(), 'after read');
  };
  const midFinish = () => {
    const was = mid; mid = null;
    while (was.pending.length) {
      const f = was.pending.shift();
      const own = {rockfordX: s.rockfordX, rockfordY: s.rockfordY, stick: s.stick, facing: s.facing};
      feedVbi(was.vbiRandoms, f.entry[F.rtclok]);
      stepFrame(f.entry, was.label);
      Object.assign(s, own);
    }
  };
  // ★ VBI mezi poslední buňkou řádku a $1385 (obálka kanálu 2 se ještě nezvedla): poloha skenu už ukazuje
  // na první buňku dalšího řádku, rozhodne $0799 v logu
  const midRowEnd = (y) => {
    if (!mid) return;
    const index = (y+1)*40;
    dbg('rowEnd', index);
    while (mid.pending.length && mid.pending[0].readsBefore <= mid.reads && (mid.pending[0].pos < index || (mid.pending[0].pos === index && mid.pending[0].entry[F.sound2] === s.sound.envelope))) stepMid(mid.pending.shift(), `row end ${index}`);
  };
  midHook = midBeforeCell; midHookAfter = midAfterCell;
  const randMid = (site) => { if (mid && MAIN_SITES.includes(site)) midBeforeRead(); return rand(site); };

  // --- titulka: hudba $23A0 snímek po snímku ----------------------------------------------
  // skupiny zápisů VBI podle razítka; snímek s AUDC3 = $AA napřed je ještě VBI jeskyně (kryt chrastí)
  const groupByFrame = (list) => {
    const groups = [];
    list.forEach((w) => { if (groups.length && groups[groups.length-1].frame === w[2]) groups[groups.length-1].writes.push(w); else groups.push({frame: w[2], writes: [w]}); });
    return groups;
  };
  const playTitle = (title, label, vbiRandoms, demoFlag, syncTune) => {
    const groups = groupByFrame(title.vbiPokey);
    let tune = null;
    const out = [];
    if (!syncTune) {
      tune = CaveRules.titleStart(out);
      // ★ $2608: AUDC1 = AUDC3 = 0, AUDCTL = $78 — v hlavní smyčce hned za háčkem titulky
      const wantMain = title.pokey;
      check(wantMain.length === 3 && out.every((w, i) => wantMain[i] && wantMain[i][0] === w[1] && wantMain[i][1] === w[2]), `${tag}: ${label}: init titulky orig [${fmtList(wantMain)}] ≠ JS [${fmtList(out.map((w) => [w[1], w[2]]))}]`);
      out.length = 0;
    }
    let caveFrames = 0, tuneFrames = 0;
    for (const grp of groups) {
      const want = grp.writes;
      if (want[0][0] === 5 && want[0][1] === 0xAA && !s) {
        // ★ titulka od zapnutí: režim jeskyně už běží (kryt chrastí), ale jeskyně ještě není v záznamu — nepřehrává se
        skippedBoot += want.length;
        continue;
      }
      if (want[0][0] === 5 && want[0][1] === 0xAA && s && s.cover) {
        // ★ VBI jeskyně ještě běží (režim $0876 se přepne až v $25F9): chrastění krytu
        feedVbi(vbiRandoms, grp.frame);
        const n0 = s.pokey.length;
        CaveFrame.step(s, rand);
        const got = s.pokey.splice(n0, s.pokey.length-n0);
        totalWrites += want.length;
        check(want.length === got.length && want.every((w, i) => w[0] === got[i][1] && w[1] === got[i][2]), `${tag}: ${label} snímek ${grp.frame}: VBI jeskyně orig [${fmtList(want)}] ≠ JS [${fmtList(got.map((w) => [w[1], w[2]]))}]`);
        caveFrames++;
        continue;
      }
      if (!tune) {
        // ★ titulka od zapnutí: harness přišel doprostřed hudby — fáze je $A0 ve snímku se zápisy AUDF,
        // index ten, od kterého sedí noty prvních osmi takových snímků (stránka má opakované bajty,
        // jedna skupina nestačí)
        if (want.length < 6) continue;   // před prvním snímkem s notami se fáze nepozná
        const noteGroups = groups.filter((gg) => gg.frame === grp.frame || (gg.writes.length >= 6 && groups.indexOf(gg) > groups.indexOf(grp))).slice(0, 8)
                                 .map((gg) => [gg.writes[0][1], gg.writes[1][1], gg.writes[2][1], gg.writes[3][1]]);
        let found = -1;
        for (let x = 0; x < 256 && found < 0; x += 2) {
          let ok = true;
          for (let k = 0; k < noteGroups.length && ok; k++) {
            const xk = (x+2*k) & 0xFF;
            const y1 = (NOTE_PAGE[(xk+1) & 0xFF]*2) & 0xFF, y2 = (NOTE_PAGE[xk]*2) & 0xFF;
            const a = noteGroups[k];
            if (!(NOTES[y1] === a[0] && NOTES[(y1+1) & 0xFF] === a[1] && NOTES[y2] === a[2] && NOTES[(y2+1) & 0xFF] === a[3])) ok = false;
          }
          if (ok) found = x;
        }
        check(found >= 0, `${tag}: ${label}: noty prvních ${noteGroups.length} snímků s notami nesedí na žádný index stránky $4400`);
        if (found < 0) break;
        tune = {index: found, phase: 0xA0, repeats: 0, demo: false};
      }
      CaveRules.titleStep(tune, NOTES, NOTE_PAGE, out, demoFlag);
      const got = out.splice(0, out.length);
      totalWrites += want.length;
      check(want.length === got.length && want.every((w, i) => w[0] === got[i][1] && w[1] === got[i][2]), `${tag}: ${label} snímek ${grp.frame}: hudba orig [${fmtList(want)}] ≠ JS [${fmtList(got.map((w) => [w[1], w[2]]))}]`);
      tuneFrames++;
    }
    totalTitleFrames += tuneFrames;
    if (verbose) console.log(`${tag}: ${label}: ${caveFrames} snímků VBI jeskyně, ${tuneFrames} snímků hudby (titulka ${title.titleFrames || title.frames || '?'} snímků)`);
  };

  // --- titulka od zapnutí (záznam dema) ----------------------------------------------------
  if (rec.bootTitle) {
    skippedBoot += rec.bootTitle.pokey.length;
    check(rec.bootTitle.tunePage === Buffer.from(NOTE_PAGE).toString('hex'), `${tag}: stránka not $4400 při zapnutí ≠ sada B z data/charset.json`);
    playTitle(rec.bootTitle, 'titulka od zapnutí', [], true, true);
  }

  for (let ci = 0; ci < rec.caves.length; ci++) {
    const c = rec.caves[ci];
    totalCaves++;
    const label = `jeskyně ${ci+1}`;
    const setupBlock = block(hex(c.setupBlock));
    checkGame(setupBlock, `${label} setup`);
    const cave = caves.caves[g.caveNumber-1];
    const raw = CaveGen.bytesOf(cave.raw);
    const made = CaveGen.generate(raw, g.levelIndex);
    const options = CaveRules.caveOptions(g);
    options.previous = s; options.stick = 0;
    s = CaveScan.create(made, raw, g.levelIndex, options);
    CaveRules.attach(g, s);
    s.colors = cave.header.colors;
    s.rowEndHook = midRowEnd;
    Object.keys(headerPatches[g.caveNumber] || {}).forEach((off) => { raw[Number(off)] = headerPatches[g.caveNumber][off]; });
    // očekávané zápisy této jeskyně: v pořadí, ve kterém je trasovač četl
    const events = [];
    c.endFrames.forEach((f) => events.push({kind: 'frame', at: f.clock.rtclok, f}));
    c.hooks.forEach((h) => events.push({kind: 'hook', at: h.clock.rtclok, h}));
    events.sort((a, b) => a.at-b.at || (a.kind === 'hook' ? 1 : -1));
    // (zápisy háčku titulky přehrává playTitle — init $2608 a hudba jdou za háčkem)
    const ordered = [].concat(c.uncover, c.passes, c.end ? [c.end] : [], events.filter((ev) => !(ev.kind === 'hook' && ev.h.hook === 'title')).map((ev) => ev.kind === 'hook' ? ev.h : ev.f));
    expectWrites([].concat(...ordered.map((x) => x.pokey || [])), [].concat(...ordered.map((x) => x.vbiPokey || [])));
    if (ci === 0) {
      const frames0 = c.uncover.flatMap((f) => f.frames);
      if (frames0.length) {
        s.animToggle = (frames0[0][F.animToggle]-1) & 0xFF;
        s.animPhase = (frames0[0][F.animToggle] & 1) ? frames0[0][F.animPhase] : (frames0[0][F.animPhase]-8) & 0x3F;
        // ★ nepozorovatelný počáteční stav zvuku: fáze počítadla $085D z prvního zápisu $1ABF, proměnné obálek
        // z prvního logu snímku (ten je za krokem VBI: když v něm obálky šly ven, b bylo před ním dvojnásobné —
        // vezme se rovnou hodnota z prvního zápisu AUDC1/AUDC4)
        Object.keys(SOUND_KEYS).forEach((k) => { s.sound[SOUND_KEYS[k]] = frames0[0][F[k]]; });
        const firstEnv = expVbi.findIndex((w) => w[0] === 0);
        if (firstEnv >= 0) {
          const delta = (expVbi[firstEnv][2]-frames0[0][F.rtclok]) & 0xFF;
          s.sound.counter = (-delta-1) & 7;
          if (delta === 0 && expVbi[firstEnv+1] && expVbi[firstEnv+3]) {
            s.sound.b = expVbi[firstEnv+1][1] & 0x0F; s.sound.e = expVbi[firstEnv+3][1] & 0x0F;
          }
        }
      }
      s.margin = c.uncover.length ? hex(c.uncover[0].screen)[0] : 0;
      s.marginTop = [s.margin, s.margin, s.margin];
      // ★ počítadlo blikání $0844 nese titulka (v demu po zapnutí ho posunul Rockford kopající v logu) — z bloku prvního háčku
      if (c.passes.length) s.blink = block(hex(c.passes[0].block)).byte(V.blink);
      if (c.passes.length) {
        const shot = hex(c.passes[0].charsetB), glyph = Uint8Array.from(Buffer.from(charset.blocks[1].data, 'base64'));
        let found = -1;
        for (let r = 0; r < 8; r++) { let ok = true; for (let y = 0; y < 8; y++) if (shot[0x3E0+y] !== glyph[0x3E0+((y+r) & 7)]) ok = false; if (ok) found = r; }
        const rotating = frames0.concat(c.passes[0].frames).filter((e) => e[F.cover] === 1).length;
        if (found >= 0) s.coverRotation = (found-rotating) & 7;
      }
    }
    // --- fáze 0: odkrývání po snímcích (matchrules) -----------------------------------------
    const mainByFrame = {};
    c.uncover.forEach((f) => f.randoms.forEach((e) => { (mainByFrame[e[2]] = mainByFrame[e[2]] || []).push(e); }));
    const vbiAll = c.uncover.flatMap((f) => f.vbiRandoms);
    let reset = false, timed = false, started = false, prevTick = null;
    const headerTime = CaveScan.digits(raw[0x0E+g.levelIndex], 3);
    const dropCover = () => {
      // ★ $2676 kryt dolů, $2679 ticho, $267C kanál 2 připravený
      while (CaveScan.drawRow(s));
      s.pokeyLine = 0; CaveScan.silence(s); CaveScan.setupSound(s);
      flushMain(`${label} start jeskyně`);
    };
    const setupEntry = (entry) => {
      if (!reset && prevTick !== null && entry[F.tick] === 1 && prevTick !== 0) { reset = true; CaveScan.startVarsZero(s); }
      prevTick = entry[F.tick];
      if (reset && !timed && entry[F.time0] === headerTime[0] && entry[F.time1] === headerTime[1] && entry[F.time2] === headerTime[2]) { timed = true; CaveScan.startVarsTime(s); }
      if (!started && entry[F.birth] !== 0) {
        if (!reset) { const tick = s.tick; CaveScan.startVarsZero(s); s.tick = tick; reset = true; }
        if (!timed) { CaveScan.startVarsTime(s); timed = true; }
        CaveScan.startVarsRest(s, {birth: options.birth}); started = true;
      }
      if (entry[F.cover] === 0 && s.cover && s.uncoverRound >= 120) dropCover();
    };
    let firstEntry = true;
    for (const f of c.uncover) {
      for (const entry of f.frames) {
        setupEntry(entry);
        feedVbi(vbiAll, entry[F.rtclok]);
        const before = (ci === 0 && !started) ? {birth: true, beforeBirth: true, time0: true, time1: true, time2: true, magicWall: true, magicWallSec: true, magicWallTime: true,
                                                 amoebaMask: true, flicker: true, statusLmsLo: true, hscrol: !!options.intermission, vscrol: !!options.intermission,
                                                 score0: true, score1: true, score2: true, score3: true, score4: true, score5: true, lives: true, paused: true, caveOver: true, exitReached: true, sound: true}
                     : (firstEntry && ci > 0) ? {color4: true} : null;
        firstEntry = false;
        stepFrame(entry, `${label} odkrývání`, before);
      }
      const k = f.clock.rtclok & 0xFF;
      Object.keys(mainByFrame).map(Number).filter((fr) => ((k-fr) & 0xFF) >= 1 && ((k-fr) & 0xFF) < 8).sort((a, b) => ((a-k) & 0xFF)-((b-k) & 0xFF)).forEach((fr) => {
        mainByFrame[fr].forEach((e) => { const x = e[1]; if (x <= 39) CaveScan.uncoverAccept(s, x); });
        delete mainByFrame[fr];
      });
      leftover(SITES, `${label} odkrývání`);
    }
    Object.keys(mainByFrame).forEach((fr) => mainByFrame[fr].forEach((e) => { const x = e[1]; if (x <= 39) CaveScan.uncoverAccept(s, x); }));
    check(s.uncoverRound === 120, `${tag}: ${label}: odkrývání skončilo po ${s.uncoverRound} kolech`);
    if (!c.passes.length) { check(false, `${tag}: ${label}: bez průchodů`); continue; }

    // --- průchody: časová osa záznamu (háček + čtení po 16 snímcích) ------------------------
    // položka k = (konec průchodu k−1 z háčku k) + (průchod k po 16 snímcích); průchod k je tedy
    // passes[k] od hookCounts dál + passes[k+1] po hookCounts (poslední + end)
    const passes = c.passes;
    const partOf = (p, key, tail) => { const n = (p.hookCounts && p.hookCounts[key]) || 0; return tail ? p[key].slice(n) : p[key].slice(0, n); };
    const during = (k, key) => partOf(passes[k], key, true).concat(k+1 < passes.length ? partOf(passes[k+1], key, false) : (c.end ? c.end[key] : []));
    const p0 = passes[0];
    feed(partOf(p0, 'randoms', false));
    for (const entry of partOf(p0, 'frames', false)) { setupEntry(entry); feedVbi(partOf(p0, 'vbiRandoms', false), entry[F.rtclok]); stepFrame(entry, `${label} před 1. průchodem`); }
    leftover(SITES, `${label} před 1. průchodem`);
    if (s.cover) dropCover();
    if (rec.demo) s.stick = block(hex(p0.block)).byte(V.stick);
    if (!started) { check(false, `${tag}: ${label}: cave_start_vars se v záznamu neobjevily`); CaveScan.startVars(s, {birth: options.birth}); }
    const b0 = block(hex(p0.block));
    compareGrid(p0.grid, `${label} 1. průchod`);
    checkCave(b0, `${label} 1. průchod`);
    checkGame(b0, `${label} 1. průchod`);
    // ★ scénář (tracerules.apply_scenario): záplata mřížky, proměnných a hlavičky na prvním háčku
    (c.patch || []).forEach(([x, y, code]) => { s.grid[y*40+x] = code; s.tiles[y*40+x] = code; });
    Object.keys(c.patchVars || {}).forEach((a) => {
      const addr = parseInt(a, 16), v = c.patchVars[a];
      if (addr === 0x078D) s.diamondsEnough = v;
      else if (addr >= 0x0836 && addr <= 0x0838) { s.time[addr-0x0836] = v; CaveScan.statusTime(s); }
      else if (addr === 0x0865) s.caveTime = v;
      else if (addr >= 0x07B9 && addr <= 0x07BE) { s.score[addr-0x07B9] = v; g.score[addr-0x07B9] = v; CaveScan.statusScore(s); }
    });
    if (c.scenario && c.scenario.header && Object.keys(c.scenario.header).length) {
      headerPatches[g.caveNumber] = Object.assign(headerPatches[g.caveNumber] || {}, c.scenario.header);
      Object.keys(c.scenario.header).forEach((off) => { raw[Number(off)] = c.scenario.header[off]; });
    }
    if (verbose) console.log(`${tag}: ${label}: ${c.scenario.kind} — jeskyně ${g.caveNumber}/${g.levelIndex+1}, hráč ${g.player+1}, průchodů ${passes.length}`);

    for (let k = 0; k < passes.length; k++) {
      const p = passes[k], next = k+1 < passes.length ? passes[k+1] : c.end;
      if (!next) break;
      // ★ v demu bere průchod páčku z $0788, kam ji demo_play ($28A1) dává před ním — blok háčku k ji má
      if (rec.demo) s.stick = block(hex(p.block)).byte(V.stick);
      const input = rec.demo ? {stick: s.stick, trig: 1} : {stick: p.input[0], trig: p.input[1]};
      const randoms = during(k, 'randoms'), vbiRandoms = during(k, 'vbiRandoms'), frames = during(k, 'frames');
      feed(randoms);
      const t0 = p.clock.rtclok*LINES+(p.clock.ypos+64) % LINES, t1 = next.clock.rtclok*LINES+(next.clock.ypos+64) % LINES;
      const rel = (stamp) => (stamp-p.clock.rtclok) & 0xFF;
      const mainReads = randoms.filter((e) => MAIN_SITES.includes(SITES[e[0]]));
      const pending = frames.map((entry) => {
        const t = (p.clock.rtclok+rel(entry[F.rtclok]))*LINES, fraction = t > t0 ? (t-t0)/(t1-t0) : 0;
        const scanX = entry[F.scanX], scanY = entry[F.scanY];
        let pos = (scanY+2)*40+scanX;
        if (scanY === 22 && fraction < 0.5) pos = 120;
        // ★ (40, 1) těsně po začátku: prolog $1D73 s $0790 = 40 z minula, nebo konec prvního řádku — rozhodne obálka
        // kanálu 2 v logu, když se na konci prvního řádku mění (jinak jako matchscan podle času)
        if (scanY === 1 && scanX === 40 && fraction < 0.02 && !(s.sound.envelope !== 0x40 && entry[F.sound2] === ((s.sound.envelope+1) & 0x4F))) pos = 120;
        return {entry, readsBefore: mainReads.filter((e) => rel(e[2]) < rel(entry[F.rtclok])).length, pos};
      });
      mid = {pending, reads: 0, vbiRandoms, label: `${label} průchod ${k}`};
      s.passLine = 0; s.passSpan = 0;
      CaveScan.pass(s, input, randMid);
      totalPasses++;
      leftover(MAIN_SITES, `${label} průchod ${k}`);
      midFinish();
      leftover(SITES, `${label} snímky průchodu ${k}`);
      flushMain(`${label} průchod ${k}`);
      if (next.grid) compareGrid(next.grid, `${label} po průchodu ${k}`);
      checkCave(block(hex(next.block)), `${label} po průchodu ${k}`, rec.demo ? {stick: true} : null);   // v demu je $0788 v háčku k+1 už páčka dalšího průchodu
    }

    // --- konec jeskyně: stav ze záznamu ($288C / $28E2), jako matchrules --------------------------
    const end = c.end;
    if (!end) { check(false, `${tag}: ${label}: bez konce`); break; }
    const be = block(hex(end.block));
    checkGame(be, `${label} ${end.hook}`, {passOutcome: true});
    CAVE_VARS.forEach((k) => { s[k] = be.byte(V[k]); });
    Object.keys(R).filter((k) => ['time', 'collected', 'needed', 'diamondValue', 'extraValue'].includes(k)).forEach((k) => { s[k] = be.range(R[k][0], R[k][1]); });
    be.range(R.score[0], 6).forEach((d, i) => { g.score[i] = d; });
    s.scroll.xLo = be.byte(V.scrollXLo); s.scroll.x = be.byte(V.scrollX); s.scroll.yLo = be.byte(V.scrollYLo); s.scroll.y = be.byte(V.scrollY);
    s.scroll.vxLo = be.byte(V.scrollVxLo); s.scroll.vx = be.byte(V.scrollVx); s.scroll.vyLo = be.byte(V.scrollVyLo); s.scroll.vy = be.byte(V.scrollVy);
    s.sound.a = be.byte(V.soundA); s.sound.b = be.byte(V.soundB); s.sound.c = be.byte(V.soundC); s.sound.envelope = be.byte(V.sound2);
    s.sound.d = be.byte(V.soundD); s.sound.e = be.byte(V.soundE); s.sound.f = be.byte(V.soundF);
    s.status = hex(end.status).slice(0, 20);
    s.statusInGame = hex(end.dlist)[4] === 0x0B; s.statusText = null;
    s.grid = hex(end.grid); s.tiles = Uint8Array.from(s.grid);
    s.covered.fill(0); s.coverRounds = 0; s.coverRow = 0; s.coverMisses = 0;
    const lastVbi = [].concat(...c.passes.map((p) => p.frames), end.frames).pop();
    if (lastVbi) { s.hscrol = lastVbi[F.hscrol]; s.vscrol = lastVbi[F.vscrol]; s.animToggle = lastVbi[F.animToggle]; s.bkLum = lastVbi[F.color4] & 0x0F; }
    s.magicWallFrame = s.magicWall === 1 ? (s.animPhase & 0x1F) : -1;
    s.flickerRows = null;
    SITES.forEach((site) => { queues[site].length = 0; });
    // ★ $288C / $28E2: ticho hned za háčkem
    s.pokeyLine = 0; CaveScan.silence(s); flushMain(`${label} ${end.hook}`);

    // --- konec jeskyně po snímcích (matchrules) ---------------------------------------------------
    const timeAtEnd = s.time[0]*100+s.time[1]*10+s.time[2];
    const scoreAtEnd = g.score.reduce((n, d) => n*10+d, 0);
    let what = null, paused = false, bonusDone = 0, bonusTimes = 0, bonusScores = 0, bonusFinished = true, pendingTimeCheck = false;
    const applyEndVars = () => {
      if (rec.demo && !s.exitReached) { what = 'demoNoExit'; paused = true; }
      else {
        if (!paused) { paused = true; CaveRules.caveEndPause(g, s); }
        what = CaveRules.caveEndBranch(g, s);
      }
      bonusFinished = what !== 'bonus';
      step = what === 'bonus' ? 'bonus' : 'afterVars';
    };
    let step = 'endVars';
    const coverAll = [];
    events.forEach((ev) => {
      const src = ev.kind === 'hook' ? ev.h : ev.f;
      src.randoms.filter((e) => SITES[e[0]] === '1886').forEach((e) => coverAll.push({at: ev.at-((ev.at-e[2]) & 0xFF), value: e[1]}));
    });
    let coverNext = 0;
    const coverReadsUntil = (clock) => { const out = []; while (coverNext < coverAll.length && coverAll[coverNext].at < clock) out.push([8, coverAll[coverNext++].value]); return out; };
    let onSince = null, offSince = null, lmsBefore = -1, coverStart = null, endAt = end.clock.rtclok;
    let titleHook = null;
    for (const ev of events) {
      if (ev.kind === 'hook') {
        const h = ev.h, hb = block(hex(h.block));
        feed(h.randoms.filter((e) => SITES[e[0]] !== '1886'));
        applyCoverReads(coverReadsUntil(h.clock.rtclok+(h.hook === 'after' ? 1 : 0)), h.clock.rtclok);
        // (snímky háčku titulky — VBI jeskyně s krytem před přepnutím režimu — přehrává playTitle se zápisy titulky)
        if (h.hook !== 'title') for (const entry of h.frames) { feedVbi(h.vbiRandoms, entry[F.rtclok]); if (afterEnd(entry, h.clock.rtclok)) endEntry(entry, `${label} ${h.hook}`); }
        if (h.hook === 'caveEnd') {
          if (what === null) applyEndVars();
          check(bonusFinished, `${tag}: ${label} caveEnd: bonus ještě neskončil (${bonusTimes} sekund, čas ${s.time})`);
          if (what === 'bonus') {
            while (bonusScores < bonusTimes) { bonusScores++; CaveRules.bonusScore(g, s); }
            while (bonusDone < bonusTimes) { bonusDone++; CaveRules.bonusCount(g, s); }
            flushMain(`${label} bonus`);
            CaveRules.bonusDone(g, s);
          }
          if (rec.demo) g.caveNumber = 0;
          check(s.flicker === 0, `${tag}: ${label} caveEnd: flicker ${s.flicker} ≠ 0 (L1598 čeká)`);
          checkGame(hb, `${label} caveEnd`, {add: what === 'bonus'});
          check(s.paused === hb.byte(V.paused), `${tag}: ${label} caveEnd: paused orig ${hb.byte(V.paused)} ≠ ${s.paused}`);
          step = CaveRules.outOfTime(s) ? 'outOfTime' : 'status';
          lmsBefore = hex(h.lms)[0];
          if (step === 'outOfTime') s.statusText = 'outOfTime';
        } else if (h.hook === 'after') {
          check(s.coverRounds === 48 || s.coverRounds === 0, `${tag}: ${label} after: zakrývání skončilo po ${s.coverRounds} kolech`);
          if (step === 'cover') { check(s.coverRounds === 48, `${tag}: ${label}: zakrývání ${s.coverRounds} kol ≠ 48`); CaveRules.coverCave(s); }
          checkGame(hb, `${label} after`);
          step = 'next';
        } else if (h.hook === 'setup') {
          check(g.caveNumber !== 0, `${tag}: ${label} setup: JS má jeskyni 0 (titulku)`);
        } else if (h.hook === 'title') {
          check(g.caveNumber === 0, `${tag}: ${label} title: JS má jeskyni ${g.caveNumber}, ne titulku`);
          checkGame(hb, `${label} title`);
          titleHook = h;
        }
        continue;
      }
      const f = ev.f;
      feed(f.randoms.filter((e) => SITES[e[0]] !== '1886'));
      const coverReads = coverReadsUntil(f.clock.rtclok);
      for (const entry of f.frames) {
        feedVbi(f.vbiRandoms, entry[F.rtclok]);
        if (!afterEnd(entry, f.clock.rtclok)) continue;
        endEntry(entry, `${label} konec`);
      }
      applyCoverReads(coverReads, f.clock.rtclok);
      leftover(SITES, `${label} konec snímek ${f.clock.rtclok}`);
    }
    SITES.forEach((site) => check(missing[site] === 0, `${tag}: ${label}: JS přečetl ${missing[site]}× RANDOM na $${site} navíc`));
    SITES.forEach((site) => { missing[site] = 0; queues[site].length = 0; });
    if (titleHook) {
      // ★ $2608 a hudba $23A0 po hře: zápisy titulky jsou v záznamu za háčkem (expMain/expVbi je už neobsahují)
      finishWrites(`${label}`);
      playTitle(rec.title, `${label} titulka`, rec.title.vbiRandoms || titleHook.vbiRandoms, !!rec.demo, false);
    } else {
      finishWrites(`${label}`);
    }

    function endEntry(entry, lbl) {
      if (!paused && entry[F.paused] === 1) { paused = true; CaveRules.caveEndPause(g, s); }
      if (what === null && paused && (entry[F.lives] !== s.lives || entry[F.player] !== g.player || (s.exitReached && entry[F.caveOver] === 0))) applyEndVars();
      if (step === 'bonus') {
        const t = entry[F.time0]*100+entry[F.time1]*10+entry[F.time2];
        const scoreNow = [0, 1, 2, 3, 4, 5].reduce((n, i) => n*10+entry[F['score'+i]], 0);
        const targetTime = (timeAtEnd-t+1000) % 1000, targetScore = Math.round((scoreNow-scoreAtEnd+1000000) % 1000000/(g.levelIndex+1)), targetCount = entry[F.bonusCount];
        while (bonusTimes < targetTime && !bonusFinished) {
          // ★ $27F1: time_dec, pak time_check — VBI může padnout mezi ně: log má už nový čas, ale ještě starý tón / cave_over
          bonusTimes++; CaveRules.bonusTimeDec(s);
          const under10 = s.time[0] === 0 && s.time[1] === 0;
          const checkSeen = !under10 || (s.time[2] === 0 ? entry[F.caveOver] === 2 : entry[F.soundC] === ((0x32+s.time[2]) & 0xFF));
          if (checkSeen) { CaveRules.bonusTimeCheck(s); if (s.caveOver) bonusFinished = true; } else pendingTimeCheck = true;
        }
        while (bonusScores < targetScore && bonusScores < bonusTimes) { bonusScores++; CaveRules.bonusScore(g, s); }
        while (bonusDone < targetCount && bonusDone < bonusScores) { bonusDone++; CaveRules.bonusCount(g, s); }
        flushMain(`${lbl} bonus`);
        if (bonusFinished && bonusScores === bonusTimes && step === 'bonus') step = 'bonusDelay';
      }
      if (step === 'bonusDelay' && s.sound.a !== 0 && entry[F.soundA] === 0) {
        // ★ $280D: po čtyřech zpožděních L1C55 za bonusem zkreslení kanálu 1 = 0 — kadence je model (CaveRules.COST),
        // tady u první pozorovatelné změny: log snímku, ve kterém už VBI viděla $0796 = 0
        s.sound.a = 0;
      }
      if (step === 'outOfTime') {
        const on = entry[F.statusLmsLo] === 0xC0;
        if (on && onSince === null) { onSince = entry[F.rtclok]; offSince = null; }
        if (!on && onSince !== null) { onSince = null; offSince = entry[F.rtclok]; }
        s.statusText = on ? 'outOfTime' : null;
        s.trig = entry[F.trig];
        if (!on && (entry[F.statusLmsLo] !== lmsBefore || entry[F.cover] === 1)) { CaveRules.outOfTimeDone(s); step = 'status'; }
      }
      if (step === 'status' && (entry[F.statusLmsLo] !== lmsBefore || entry[F.cover] === 1)) { nextStatusNow(); step = 'covering'; }
      if (step !== 'bonus' && step !== 'bonusDelay' && entry[F.cover] === 1 && !s.cover) coverUp();
      stepFrame(entry, `${lbl} (${step})`, null);
      if (pendingTimeCheck) { pendingTimeCheck = false; CaveRules.bonusTimeCheck(s); if (s.caveOver) bonusFinished = true; }
    }
    function afterEnd(entry, clock) {
      const full = clock-((clock-entry[F.rtclok]) & 0xFF);
      return full > endAt;
    }
    function coverUp() {
      // ★ $2032 kryt nahoru, $2035 ticho
      s.cover = 1;
      s.pokeyLine = 0; CaveScan.silence(s); flushMain(`${label} kryt`);
    }
    function applyCoverReads(list, at) {
      if (!list.length) return;
      if (step === 'outOfTime') { s.statusText = null; CaveRules.outOfTimeDone(s); step = 'status'; }
      if (step === 'status') nextStatusNow();
      if (coverStart === null) { coverStart = at; step = 'cover'; if (!s.cover) coverUp(); }
      list.forEach((e) => { CaveRules.coverRead(s, e[1]); });
    }
    function nextStatusNow() {
      const text = CaveRules.nextStatus(g, s);
      if (verbose) console.log(`${tag}: ${label}: konec — ${what}, text ${text}, další ${g.caveNumber}/${g.levelIndex+1}, životy ${g.lives}, hráč ${g.player+1}, game over ${g.gameOver}`);
    }
    if (g.caveNumber === 0) break;
  }
  if (verbose) console.log(`${tag}: ${rec.caves.length} jeskyní`);
}

console.log(`matchsound.mjs: ${traces.length} záznamů, ${totalCaves} jeskyní, ${totalPasses} průchodů, ${totalFrames} snímků, ${totalTitleFrames} snímků hudby titulky, ${totalWrites} zápisů do POKEY (+ ${skippedBoot} hlavní smyčky titulky od zapnutí nepřehráno), ${checks} kontrol, ${failures} rozdílů`);
process.exit(failures ? 1 : 0);
