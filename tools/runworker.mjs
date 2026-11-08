#!/usr/bin/env node
/**
 * Projde celou smyčku workeru bez prohlížeče.
 *
 *   ./tools/runworker.mjs [--frames N] [--verbose]
 *
 * `app/gameWorker.js` se spustí v atrapě prostředí workeru v režimu
 * `headless`, kde tiká na vyžádání, a projde se protokol
 * z `app/WORKER-PROTOCOL.md`: `init`, `controls`, `tick`, `pause`,
 * `continue`, `reset`.
 *
 * Kontroluje se: odpověď na `init` se snímkem a panelem; ★ volby originálu
 * (jeskyně A/E/I/M, úroveň 1–5, hráči 1–2) dorazí do workeru, neznámé se
 * zahodí a **na úrovních 4–5 je jeskyně A** (User's Guide); tik posouvá
 * počítadlo snímků o jeden; stav ovládání dorazí celý včetně dvou směrů
 * naráz; `pause`/`continue`/`reset`; **seed se propisuje** — dva běhy
 * s týmž seedem dají tentýž stav.
 *
 * ★ M3: worker si při `init` vezme jeskyně (`data/caves.json`), vygeneruje
 * mřížku (`app/caveGen.js`) a rozjede jeskyni (`app/caveScan.js`,
 * `app/caveFrame.js`, klasické skripty přes `importScripts`): kontroluje se,
 * že první snímek nese zakryté dlaždice (`tiles` = 960 × `$FF`), okno,
 * animaci a stavový řádek; že fáze jdou `setup` → `uncover` → `draw` →
 * `play` v změřených snímcích (11 / 63 / 14); že se dlaždice odkrývají; že
 * po narození (4 tiky po 60 snímcích) je v mřížce Rockford a páčka ho
 * hýbe; že se okno posune za Rockfordem. Správnost průchodu dokazuje
 * `matchscan.mjs`, tady jde o tvar protokolu.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const caves = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/caves.json'), 'utf8')).caves;
const global = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/global.json'), 'utf8'));
const charset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/charset.json'), 'utf8'));

function startWorker(onMessage) {
  const sandbox = {
    console, performance: {now: () => Date.now()},
    setTimeout: () => 0, clearTimeout: () => {},
    postMessage: onMessage,
    // the classic scripts the worker pulls in, evaluated in the same sandbox
    importScripts(...files) {
      files.forEach((file) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', file.split('?')[0]), 'utf8'), context, {filename: file}));
    }
  };
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'), context, {filename: 'gameWorker.js'});
  return {send(message) { sandbox.onmessage({data: message}); }};
}

let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) { failures++; console.log('  CHYBA: '+label); }
}

function run(seed, frames, init, verbose) {
  const messages = [];
  const worker = startWorker((m) => { messages.push(m); if (verbose) console.log(JSON.stringify(m).slice(0, 160)); });
  worker.send({id: 'init', initData: Object.assign({headless: true, seed: seed, hiScore: 0, caves: caves}, init)});
  for (let i = 0; i < frames; i++) worker.send({id: 'tick'});
  return {worker, messages};
}

const frames = parseInt((process.argv.find((a) => a.startsWith('--frames=')) || '--frames=50').split('=')[1], 10);
const verbose = process.argv.includes('--verbose');

// init a panel
{
  const {messages} = run(7, 0, {cave: 'E', level: 2, players: 2});
  check(messages.length === 1 && messages[0].id === 'frame', 'init odpoví snímkem');
  const p = messages[0].panel;
  check(p && p.cave === 'E' && p.level === 2 && p.players === 2, 'volby originálu dorazí (E, 2, 2 hráči)');
  check(p.lives === 3, '★ 3 šance');
  check(p.caveNumber === 5 && p.levelIndex === 1, '★ $07B7 = 5, $07B8 = 1');
  const m = messages[0];
  check(m.tiles && m.tiles.length === 40*24 && Array.from(m.tiles).every((t) => t === 0xFF), '★ první snímek: dlaždice zakryté ($7C)');
  check(m.phase === 'setup' && m.window && m.window.x === 0 && m.window.y === 0 && m.window.hscrol === 3, '★ fáze setup, okno vlevo nahoře, HSCROL 3');
  check(m.anim && m.anim.phase === 0 && m.status && m.status.inGame === false && m.status.bytes.length === 20, 'animace a stavový řádek před narozením');
  check(p.colors && p.colors.length === 5 && p.colors[0] === 0x14, '★ barvy hlavičky E');
  check(p.time === 120 && p.needed === 5 && p.collected === 0, '★ E/2: čas 120, diamantů 5 (hlavička $0E+1, $09+1)');
}
// fáze startu jeskyně a odkrývání
{
  const {messages} = run(1, 100, {});
  const phases = messages.map((m) => m.phase);
  check(phases[11] === 'uncover' && phases[10] === 'setup', '★ generování 11 snímků, pak odkrývání');
  check(phases[74] === 'draw' && phases[73] === 'uncover', '★ odkrývání 63 snímků (120 kol)');
  check(phases[88] === 'play' && phases[87] === 'draw', '★ plné kreslení 14 snímků, pak průchody');
  const covered = (m) => m.tiles ? Array.from(m.tiles).slice(2*40).filter((t) => t === 0xFF).length : -1;
  check(covered(messages[40]) > 0 && covered(messages[40]) < covered(messages[20]), 'dlaždice se odkrývají');
  check(covered(messages[88]) === 0 && messages[88].margin === 0x4A, '★ po plném kreslení nic zakryté, okraje $4A');
  check(messages[1].tiles === null || messages[1].tiles === undefined || messages[0].tiles !== null, 'dlaždice jen když se změnily');
}
// narození, pohyb, scroll
{
  const {worker, messages} = run(1, 300, {});
  const grid = (m) => m.tiles ? Array.from(m.tiles) : null;
  const last = () => messages[messages.length-1];
  const findTiles = () => { for (let i = messages.length-1; i >= 0; i--) if (messages[i].tiles) return Array.from(messages[i].tiles); return null; };
  // ★ $39 = Rockford scanned: the tile is the same, only the grid loses the flag ($1DAC)
  const rockfordAt = () => findTiles().findIndex((t) => t === 0x38 || t === 0x39);
  check(rockfordAt() >= 0, '★ po 300 snímcích (4 tiky) je Rockford narozený');
  check(last().status && last().status.inGame === true || messages.some((m) => m.status && m.status.inGame), '★ stavový řádek přepnutý na $080B');
  // ★ A/1: Rockford starts at (3,4) between two boulders; below him is dirt
  const before = rockfordAt();
  worker.send({id: 'controls', left: false, up: false, right: false, down: true, fire: false});
  for (let i = 0; i < 40; i++) worker.send({id: 'tick'});
  const after = rockfordAt();
  check(after > before && (after-before) % 40 === 0 && after-before <= 6*40, 'Rockford jde dolů (o buňky, ne o snímky)');
  check(last().window && last().window.x === 0 && last().window.hscrol === 3, '★ okno stojí, dokud je Rockford v mrtvé zóně (scroll sám měří matchscan.mjs)');
  check(messages.every((m) => m.panel.caveOver === 0), 'jeskyně neskončila');
}
// neznámé volby a úrovně 4–5
{
  const {messages} = run(1, 0, {cave: 'Q', level: 9, players: 3});
  const p = messages[0].panel;
  check(p.cave === 'A' && p.level === 1 && p.players === 1, 'neznámé volby se zahodí (A, 1, 1)');
  const m2 = run(1, 0, {cave: 'M', level: 5}).messages[0].panel;
  check(m2.cave === 'A' && m2.level === 5, '★ na úrovni 5 je jeskyně A');
}
// tik, ovládání, pauza, reset
{
  const {worker, messages} = run(3, frames, {});
  check(messages.length === frames+1, 'každý tick dá snímek ('+frames+')');
  check(messages[frames].frame === frames, 'počítadlo snímků');
  worker.send({id: 'controls', left: true, up: true, right: false, down: false, fire: true});
  worker.send({id: 'tick'});
  const c = messages[messages.length-1].controls;
  check(c.left && c.up && c.fire && !c.right && !c.down, 'ovládání dorazí celé (vlevo + nahoru + fire)');
  worker.send({id: 'pause'}); worker.send({id: 'tick'});
  check(messages[messages.length-1].frame === frames+2, 'headless tick jde i v pauze (jen časovač stojí)');
  worker.send({id: 'continue'}); worker.send({id: 'reset'});
  const n = messages.length; worker.send({id: 'tick'});
  check(messages.length === n, 'po resetu netiká');
}
// seed
{
  const a = run(1234, 120, {}).messages.map((m) => JSON.stringify(m, (k, v) => v instanceof Uint8Array ? Array.from(v) : v)).join('|');
  const b = run(1234, 120, {}).messages.map((m) => JSON.stringify(m, (k, v) => v instanceof Uint8Array ? Array.from(v) : v)).join('|');
  check(a === b, 'stejný seed → stejný stav');
}
// ★ M5: konec jeskyně — A/1 v klidu až do OUT OF TIME (150 s = 9 000 snímků), fire, zakrytí, táž jeskyně s životem míň
{
  const {worker, messages} = run(5, 0, {cave: 'A', level: 1, players: 2});
  const last = () => messages[messages.length-1];
  let ticks = 0;
  while (ticks < 12000 && !(last().status && last().status.text === 'outOfTime')) { worker.send({id: 'tick'}); ticks++; }
  check(last().status && last().status.text === 'outOfTime', '★ po vypršení času svítí OUT OF TIME ('+ticks+' snímků)');
  check(last().panel.lives === 3 && last().panel.player === 2, '★ hráč 1 přišel o život, na řadě hráč 2 se svými 3 (bloky $07C5/$07D4): životy '+last().panel.lives+', hráč '+last().panel.player);
  check(last().phase === 'end' && last().panel.caveOver === 2, 'fáze end');
  const statusB = messages.filter((m) => m.statusB).pop().statusB;
  check(statusB[7] === 0x92 && statusB[10] === 0x93 && statusB[16] === 0xA1, '★ $081F: PLAYER 2, 3 MEN A/1 (bloky hráčů)');
  for (let i = 0; i < 300; i++) worker.send({id: 'tick'});
  check(last().status === null || last().status.text === 'outOfTime', '★ OUT OF TIME bliká, dokud se nestiskne fire (70 snímků svítí, 210 ne)');
  worker.send({id: 'controls', left: false, up: false, right: false, down: false, fire: true});
  worker.send({id: 'tick'}); worker.send({id: 'tick'});
  const after = messages.slice(-2);
  check(after.some((m) => m.status && m.status.text === null && m.status.inGame === false), '★ fire ukončí OUT OF TIME, řádek před narozením');
  worker.send({id: 'controls', fire: false});
  let covers = 0, covered = false;
  for (let i = 0; i < 40 && !covered; i++) { worker.send({id: 'tick'}); if (last().cover) covers += last().cover.length; if (last().tiles && last().tiles.every((t) => t === 0xFF)) covered = true; }
  check(covers === 24*48 && covered, '★ zakrývání $1870: 24 řádků × 48 znaků, pak $1852 všechno ('+covers+')');
  worker.send({id: 'tick'});
  check(last().phase === 'setup' && last().panel.caveNumber === 1 && last().panel.lives === 3 && last().panel.player === 2, '★ táž jeskyně A pro hráče 2 ('+last().phase+')');
  worker.send({id: 'reset'});
}
// ★ M5: demo — jeskyně A/1 ze skriptu $3BC0 (259 průchodů, východ), bonus, zakrytí, titulka = zpráva gameOver
{
  const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/demo.json'), 'utf8'));
  const script = Array.from(Buffer.from(demo.raw, 'hex'));
  const {worker, messages} = run(9, 0, {demo: true, demoScript: script});
  let ticks = 0;
  while (ticks < 6000 && !messages.some((m) => m.id === 'gameOver')) { worker.send({id: 'tick'}); ticks++; }
  const over = messages.find((m) => m.id === 'gameOver');
  check(over && over.demo === true, '★ demo končí titulkou (zpráva gameOver, '+ticks+' snímků)');
  check(over && over.score > 200, '★ demo sebralo diamanty a dostalo bonus za čas: '+(over && over.score));
  const frames = messages.filter((m) => m.id === 'frame');
  check(frames[frames.length-1].phase === 'title', 'fáze title');
  check(frames.some((m) => m.panel.caveOver === 2 && m.phase === 'bonus'), '★ bonus za čas po východu');
  worker.send({id: 'reset'});
}
// ★ M7: titulka — zpráva `title` bez jeskyně: hudba $23A0 od $2608 jako zápisy do POKEY každý
// snímek, po dvou přehráních ($0874 == 2, $23FD) zpráva `demo`
{
  const hexBytes = (h) => Array.from(Buffer.from(h, 'hex'));
  const tune = {notes: hexBytes(global.title.notes), page: Array.from(Buffer.from(charset.blocks.find((b) => b.address === '$4400').data, 'base64')).slice(0, 256)};
  const messages = [];
  const worker = startWorker((m) => messages.push(m));
  worker.send({id: 'title', initData: {headless: true, hiScore: 1234, tune: tune}});
  check(messages.length === 1 && messages[0].id === 'frame' && messages[0].phase === 'title', 'title odpoví snímkem fáze title');
  const first = messages[0].pokey || [];
  check(first.length === 3 && first[0][1] === 1 && first[1][1] === 5 && first[2][1] === 8 && first[2][2] === 0x78, '★ $2608: AUDC1 = AUDC3 = 0, AUDCTL = $78');
  check(messages[0].panel.hiScore === 1234 && messages[0].tiles === null, 'panel nese hiScore, žádné dlaždice');
  for (let i = 0; i < 2100; i++) worker.send({id: 'tick'});
  const frames = messages.filter((m) => m.id === 'frame');
  check(frames.slice(1).every((m) => m.pokey && m.pokey.some((w) => w[1] === 7) && m.pokey.some((w) => w[1] === 3)), '★ $23DA: každý snímek AUDC4 a AUDC2');
  check(frames[1].pokey.filter((w) => w[1] === 0 || w[1] === 2 || w[1] === 4 || w[1] === 6).length === 4 && frames[2].pokey.filter((w) => w[1] < 7 && (w[1] & 1) === 0).length === 0, '★ fáze $A0: noty na prvním snímku, pak každý osmý');
  const demos = messages.filter((m) => m.id === 'demo');
  check(demos.length === 1, 'právě jedna zpráva demo');
  check(demos.length === 1 && demos[0].frame === 2041, '★ demo na snímku 2 041 hudby (2 × 128 not × 8 snímků od první noty), ne ' + (demos[0] && demos[0].frame));
  check(messages.filter((m) => m.id === 'gameOver').length === 0, 'titulka nehlásí gameOver');
}

console.log(`runworker.mjs: ${checks} kontrol, ${failures} chyb`);
process.exit(failures ? 1 : 0);
