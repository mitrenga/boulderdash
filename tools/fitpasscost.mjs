#!/usr/bin/env node
/**
 * Model kadence průchodu: kolik řádků paprsku (PAL, 312 na snímek) trvá
 * jeden průchod `$1D8F` podle toho, co v něm proběhlo.
 *
 *   ./tools/matchscan.mjs --costs && ./tools/fitpasscost.mjs
 *
 * ★ Průchod běží v hlavní smyčce a jeho délku určuje CPU brzděné DMA ANTICu,
 * zpožďovací smyčka `$1C2F` (`$1C2A`: 20/10/5/2/0 na řádek podle obtížnosti)
 * a práce obsluh objektů — není to celé číslo snímků a mění se s obsahem
 * jeskyně (změřeno 4,9–7,0 snímku). Tenhle nástroj vezme `build/ref/scan/
 * costs.csv` (délka každého zaznamenaného průchodu v řádcích + počty obsluh
 * po kódech objektů, zápisů `$0BDC` a čtení `RANDOM`) a metodou nejmenších
 * čtverců spočítá lineární model
 *
 *   řádky = základ + zpoždění[úroveň] · 21 + Σ (počet obsluhy kódu) · cena kódu + zápisy · cena
 *
 * který `CaveScan.passCost` (app/caveScan.js) používá k naplánování dalšího
 * průchodu. Vypíše koeficienty jako JS a chybu modelu (RMS a maximum
 * v snímcích) — ta je číslo do `MILNIKY.md` (★ změřeno regresí).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const csv = fs.readFileSync(path.join(ROOT, 'build/ref/scan/costs.csv'), 'utf8').trim().split('\n');
const header = csv[0].split(',');
const rows = csv.slice(1).map((line) => { const v = line.split(','); const o = {}; header.forEach((h, i) => { o[h] = i < 1 ? v[i] : Number(v[i]); }); return o; });
const codes = header.filter((h) => /^c[0-9a-f]+$/.test(h));
// ★ $1C2A: iterace zpožďovací smyčky na řádek
const ROW_DELAY = [20, 10, 5, 2, 0];

// vlastnosti: [1, zpoždění·21, zápisy, kód…]; obsluhy s nulovým výskytem se vynechají
const used = codes.filter((c) => rows.some((r) => r[c] > 0));
const names = ['base', 'delay', 'stores'].concat(used);
const X = rows.map((r) => [1, ROW_DELAY[r.level]*21, r.stores].concat(used.map((c) => r[c])));
const y = rows.map((r) => r.lines);

// normální rovnice (XᵀX) b = Xᵀy, Gaussova eliminace s pivotem
const n = names.length;
const A = Array.from({length: n}, () => new Array(n+1).fill(0));
X.forEach((x, k) => {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] += x[i]*x[j];
    A[i][n] += x[i]*y[k];
  }
});
for (let i = 0; i < n; i++) {
  let p = i;
  for (let r = i+1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
  [A[i], A[p]] = [A[p], A[i]];
  if (Math.abs(A[i][i]) < 1e-9) { A[i][i] = 1e-9; }
  for (let r = 0; r < n; r++) {
    if (r === i) continue;
    const f = A[r][i]/A[i][i];
    for (let c = i; c <= n; c++) A[r][c] -= f*A[i][c];
  }
}
const b = names.map((_, i) => A[i][n]/A[i][i]);

let sq = 0, worst = 0, sumAbs = 0;
rows.forEach((r, k) => {
  const pred = X[k].reduce((acc, v, i) => acc+v*b[i], 0);
  const err = (y[k]-pred)/312;
  sq += err*err; sumAbs += Math.abs(err); if (Math.abs(err) > worst) worst = Math.abs(err);
});
const mean = y.reduce((a, v) => a+v, 0)/y.length;
console.log(`fitpasscost.mjs: ${rows.length} průchodů, průměr ${(mean/312).toFixed(2)} snímku; model: RMS ${Math.sqrt(sq/rows.length).toFixed(3)}, střední |chyba| ${(sumAbs/rows.length).toFixed(3)}, max ${worst.toFixed(2)} snímku`);
const perLevel = {};
rows.forEach((r) => { (perLevel[r.level] = perLevel[r.level] || []).push(r.lines); });
Object.keys(perLevel).sort().forEach((l) => { const v = perLevel[l]; console.log(`  úroveň ${Number(l)+1}: ${v.length} průchodů, ${(v.reduce((a, x) => a+x, 0)/v.length/312).toFixed(2)} snímku (min ${(Math.min(...v)/312).toFixed(2)}, max ${(Math.max(...v)/312).toFixed(2)})`); });
console.log('\n  // ★ tools/fitpasscost.mjs — řádky paprsku na průchod, regrese z '+rows.length+' průchodů (MILNIKY.md M3)');
console.log('  static get COST() {');
console.log('    return {');
console.log(`      base: ${b[0].toFixed(1)}, delayIteration: ${b[1].toFixed(3)}, store: ${b[2].toFixed(2)},`);
console.log('      code: {'+used.map((c, i) => `0x${c.slice(1).toUpperCase()}: ${b[3+i].toFixed(1)}`).join(', ')+'}');
console.log('    };');
console.log('  } // COST');
