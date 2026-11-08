#!/usr/bin/env node
/**
 * Co záznamy `build/ref/scan/*.json.gz` (tools/tracescan.py) opravdu
 * pokrývají — pro `MILNIKY.md`: které obsluhy a které jejich větve
 * v originálu proběhly, aby nula rozdílů `matchscan.mjs` něco dokazovala.
 *
 *   ./tools/scancoverage.mjs [soubor.json.gz …]
 *
 * Z mřížky po každém průchodu: mušky/motýli (kódy 08–0B, 30–33) a jejich
 * výbuchy (1B–1F na prázdno, 20–24 na diamanty), améba (3A/3B), z čeho
 * vyrostla; z proměnných: nejvyšší počet buněk améby, uzavření (`$0789`
 * = 0 → diamanty), ≥ 200 (→ kameny), stavy kouzelné zdi (`$078A` 1 mele,
 * 2/3 vyhaslá), smrt Rockforda (`$0794` = 16), východ, vypršení času.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const dir = path.join(ROOT, 'build/ref/scan');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const traces = files.length ? files : fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort().map((f) => path.join(dir, f));

const total = {records: 0, passes: 0, frames: 0, firefly: 0, butterfly: 0, amoeba: 0, explodeSpace: 0, explodeDiamond: 0, amoebaMax: 0,
               amoebaEnclosed: 0, amoeba200: 0, magicWallOn: 0, magicWallOff: 0, died: 0, exit: 0, timeOut: 0, extraValue: 0, bonusLife: 0, pushed: 0};
const rows = [];
for (const file of traces) {
  const rec = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const tag = path.basename(file, '.json.gz');
  const c = {tag, passes: rec.passes.length, frames: rec.passes.reduce((n, p) => n+p.frames.length, 0)+rec.uncover.reduce((n, f) => n+f.frames.length, 0),
             firefly: 0, butterfly: 0, amoeba: 0, explodeSpace: 0, explodeDiamond: 0, amoebaMax: 0, amoebaEnclosed: 0, amoeba200: 0,
             magicWallOn: 0, magicWallOff: 0, died: 0, exit: 0, timeOut: 0, extraValue: 0, bonusLife: 0, pushed: 0};
  let prevGrid = null, lives0 = null;
  for (const p of rec.passes) {
    const g = Buffer.from(p.grid, 'hex'), v = p.vars;
    let ff = 0, bf = 0, am = 0, es = 0, ed = 0;
    for (let i = 120; i < 960; i++) {
      const x = g[i];
      if (x >= 0x08 && x <= 0x0F) ff++;
      else if (x >= 0x30 && x <= 0x37) bf++;
      else if (x === 0x3A || x === 0x3B) am++;
      else if (x >= 0x1B && x <= 0x1F) es++;
      else if (x >= 0x20 && x <= 0x24) ed++;
    }
    c.firefly = Math.max(c.firefly, ff); c.butterfly = Math.max(c.butterfly, bf); c.amoeba = Math.max(c.amoeba, am);
    // nový výbuch = buňka, která v minulém průchodu výbuchem nebyla
    if (prevGrid) {
      for (let i = 120; i < 960; i++) {
        if (g[i] >= 0x1B && g[i] <= 0x1F && !(prevGrid[i] >= 0x1B && prevGrid[i] <= 0x1F)) c.explodeSpace++;
        if (g[i] >= 0x20 && g[i] <= 0x24 && !(prevGrid[i] >= 0x20 && prevGrid[i] <= 0x24)) c.explodeDiamond++;
      }
    }
    prevGrid = g;
    c.amoebaMax = Math.max(c.amoebaMax, v.amoebaCountLast);
    // uzavření platí jen s živou amébou pod 200 buňkami (po ztuhnutí v kameny příznak padá také)
    if (v.amoebaEnclosed === 0 && v.amoebaCountLast > 0 && v.amoebaCountLast < 200) c.amoebaEnclosed = 1;
    if (v.amoebaCountLast >= 200) c.amoeba200 = 1;
    if (v.magicWall === 1) c.magicWallOn = 1;
    if (v.magicWall >= 2) c.magicWallOff = 1;
    if (v.noRockford === 16) c.died = 1;
    if (v.exitReached) c.exit = 1;
    if (v.time.join() === '0,0,0') c.timeOut = 1;
    if (v.diamondsEnough) c.extraValue = 1;
    if (lives0 === null) lives0 = v.lives;
    if (v.lives > lives0) c.bonusLife = 1;
  }
  // ★ konec vypršením: poslední zaznamenaný průchod s časem 001 a jeskyně
  // skončila (tik na 000 → $0795 = 2 padne mezi průchodem a hookem konce;
  // proměnné po konci už přepisuje kód konce jeskyně, M5)
  const fv = rec.finalVars, last = rec.passes[rec.passes.length-1];
  if (rec.caveOver && last && last.vars.time.join() === '0,0,1' && !c.exit) c.timeOut = 1;
  if (fv && fv.exitReached) c.exit = 1;
  rows.push(c);
  Object.keys(total).forEach((k) => { if (k === 'records') total[k]++; else if (k === 'amoebaMax') total[k] = Math.max(total[k], c[k]); else total[k] += c[k]; });
}
const cols = ['tag', 'passes', 'frames', 'firefly', 'butterfly', 'amoeba', 'amoebaMax', 'amoeba200', 'amoebaEnclosed', 'explodeSpace', 'explodeDiamond', 'magicWallOn', 'magicWallOff', 'died', 'exit', 'timeOut', 'extraValue', 'bonusLife'];
console.log(cols.join('\t'));
rows.forEach((r) => console.log(cols.map((k) => r[k]).join('\t')));
console.log('---');
console.log(`${total.records} záznamů, ${total.passes} průchodů, ${total.frames} snímků`);
console.log(`mušky v ${rows.filter((r) => r.firefly).length} záznamech, motýli v ${rows.filter((r) => r.butterfly).length}, améba v ${rows.filter((r) => r.amoeba).length} (max ${total.amoebaMax} buněk; ≥ 200 → kameny v ${total.amoeba200}, uzavřená → diamanty v ${total.amoebaEnclosed})`);
console.log(`výbuchy: ${total.explodeSpace} buněk na prázdno, ${total.explodeDiamond} na diamanty; kouzelná zeď mele v ${total.magicWallOn}, vyhaslá v ${total.magicWallOff}`);
console.log(`Rockford zemřel v ${total.died}, východ v ${total.exit}, čas vypršel v ${total.timeOut}, extra hodnota v ${total.extraValue}, život navíc v ${total.bonusLife}`);
