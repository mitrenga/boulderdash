# Protokol mezi `gameModel.js` a `gameWorker.js`

Worker drží herní stav a tiká; model do něj posílá jen vstupy a kreslí to,
co dostane zpátky.

## ★ Tik je snímek PAL, 50 Hz

Referenční stroj je 800XL PAL (R-039). ★ Krok hry originálu, který běží
v odložené VBI (`$1BB0`, `sources/docs/disasm_notes.md` §2), je tady
`caveFrame.js` a běží **každý tik**: tik času (60 snímků = herní sekunda),
odpočet narození (4 tiky), scroll okna, fáze animace dlaždic, časovač
kouzelné zdi, bliknutí pozadí.

## ★ Průchod mřížkou není snímek

★ Průchod `$1D8F` běží v hlavní smyčce originálu a trvá několik snímků —
CPU brzdí DMA ANTICu a zpožďovací smyčka `$1C2F` podle obtížnosti
(`$1C2A`: 20/10/5/2/0 na řádek), takže délka průchodu **není celé číslo
snímků a závisí na obsahu jeskyně** (změřeno 4,9–7,0 snímku). Worker
průchod (`caveScan.js`) provede celý v jednom tiku a další naplánuje podle
**nákladového modelu v řádcích paprsku** (`CaveScan.passCost`), který je
regresí z tisíců zaznamenaných průchodů (`tools/fitpasscost.py`,
`MILNIKY.md` M3). Vědomá odchylka `ZADANI.md` §10.6.

## ★ Start jeskyně (fáze `phase`)

Podle změřených fází `$2645` (snímky PAL, bez háčků): `setup` ~11
(generování), `uncover` ~63 (`$18D8`: 120 kol po 22 náhodných buňkách nad
zakrývacím znakem `$7C`), `draw` ~14 (`$1954`: plné kreslení po řádcích),
`play` (průchody), pak ★ M5 `bonus` (bonus za čas `$27D4`, sekunda za
337 řádků), `end` (`cave_end` `$2012` po krocích: čekání na flicker, OUT OF
TIME, GAME OVER / BONUS LIFE / stavový řádek, zakrývání `$1870` po znacích,
zpoždění), a znovu `setup` další jeskyně, nebo `title` (GAME OVER či konec
dema → zpráva `gameOver`, model jde do titulky `MainModel`). Kadence konce
je model `CaveRules.COST` (`tools/timerules.py`, `ZADANI.md` §10.9).

## ★ Titulka (M7)

`MainModel` pošle `title` místo `init`: worker nemá jeskyni, jen hudbu
`$23A0` od `$2608` (`CaveRules.titleStart` / `titleStep`) — každý snímek
zápisy do POKEY v `frame.pokey`, obraz si model staví sám
(`app/titleScreen.js`). Příznak dema `$07AB` je v titulce vždy nahoře
(`menu_start` `$2566`), takže po druhém přehrání (`$0874` == 2, `$23FD`,
2 041 snímků) worker pošle `demo` a zastaví se; model spustí demo
(`init` s `demo: true`).

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `title` | `initData: {headless, hiScore, tune}` | ★ titulka (`$25C3` → `$2608`): bez jeskyně, hudba od začátku, `tune` = `{notes, page}` jako u `init`; odpoví snímkem fáze `title` a tiká. |
| `init` | `initData: {headless, cave, level, players, joysticks, hiScore, seed, caves, demo, demoScript, tune}` | start hry (★ `new_game` `$2680`); `caves` = pole z `data/caves.json`; `joysticks` 1/2 (★ dva hráči s jedním joystickem mají narození 6 tiků); `demo: true` = ★ `$2896`: jeskyně A/1, páčka ze `demoScript` (bajty `data/demo.json`), fire ukončí. `headless: true` tiká jen na `tick` (`tools/runworker.mjs`). |
| `controls` | `left`, `right`, `up`, `down`, `fire` (boolean) | úplný stav ovládání při každé změně. Worker z něj dělá ★ nibble STICK (`$0F` klid, `$0E` nahoru, `$0D` dolů, `$0B` vlevo, `$07` vpravo, úhlopříčky = obě), STRIG 0 = stisknuto; ★ úhlopříčka platí jako její vodorovná složka (`$1322`), protisměry se ruší. |
| `pause` / `continue` | – | zastaví / rozjede tikání. ★ `$1CDE`: pauza ztiší čip — worker pošle ještě jeden `frame` s devíti nulovými zápisy v `pokey` (M6). |
| `tick` | – | jeden snímek v režimu `headless`. |
| `reset` | – | zahodí stav. |

### ★ Náhoda: dva zdroje

Originál má dva (`ZADANI.md` §2): **generátor jeskyně** ze semínka v hlavičce
(★ pět semínek po obtížnostech) — `CaveGen.nextRandom`, bitově `$0C01`,
protože je to jeskyně sama — a **hardwarový `RANDOM` `$D20A`** za běhu
(★ 14 čtení: tlačení kamene `$124A`, růst améby `$1018`, zvuky `$0D88`/
`$0FB7`/`$1B17`/`$1936`, odkrývání `$18E5`, mrkání a podupávání Rockforda
`$19D9`/`$19E5`, flicker bonusového života `$15AD`–`$15BF`). Pro ten má
worker `nextRand(site)` (seedovaný xorshift; `site` = adresa čtení, kterou
`tools/matchscan.mjs` používá k nasypání nahraných hodnot po místech).
`Math.random()` nikdy.

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | viz níž | jeden snímek. |
| `gameOver` | `demo`, `gameOver`, `score`, `score2`, `hiScore` | ★ `$28F8`: titulka po GAME OVER nebo po demu — model jde do titulky (`MainModel`). |
| `demo` | `frame` | ★ `$23FD`: hudba titulky dohrála podruhé — demo; worker se zastaví. |
| `error` | `message` | rozbitý stav. |

Pole `frame`:

| klíč | obsah |
|---|---|
| `frame` | počítadlo snímků |
| `phase` | `setup` / `uncover` / `draw` / `play` / `bonus` / `end` / `title` |
| `tiles` | ★ 960 kódů objektů, **jejichž dlaždice stojí v obraze** (`$0BDC` kreslí, když ukládá; `$140D` kreslí zavřený východ bez uložení), `$FF` = zakryto; jen ve snímku, ve kterém se změnily |
| `margin`, `marginTop` | ★ `$18BF`: bajt okrajů obrazu (0 před prvním plným kreslením, pak `$4A`) a tři bajty `$5000`–`$5002` zvlášť — zakrývání je umí přepsat na `$7C` (M5); jen když se změnily |
| `cover` | ★ `$1870`: adresy znaků, které v tomhle snímku dostaly krycí znak `$7C` (po znacích okna, ne po dlaždicích; M5) |
| `statusB` | ★ `$081F`: řádek před narozením „PLAYER 1, 3 MEN A/1“, jak ho hra patchuje na konci každé jeskyně (`$282B`; M5); jen když se změnil |
| `window` | ★ `{x, y, hscrol, vscrol}` — LMS řádků = `$5000 + 80·(řádek + y) + x`, jemný scroll (`$1814`) |
| `anim` | ★ `{phase, moving, facing, blink, tap, magicWallFrame, coverRotation, flickerRows}` — co `$1A35`/`$1986`/`$1B12`/`$192C`/`$159E` kopírují do sady B |
| `bkLum` | ★ `$1AA6`: jas pozadí (`$F` při bliknutí, jinak 0) |
| `status` | ★ `{inGame, text, bytes[20]}` — buffer `$080B`, který buffer display list ukazuje (`$111C`) a text konce jeskyně přes něj (`gameOver` / `outOfTime` / `bonusLife` = LMS `$0A96` / `$0AC0` / `$0AD5`; M5); jen když se změnil |
| `panel` | `cave`, `level`, `caveNumber`, `levelIndex`, `colors`, `players`, `player` (1/2, ★ `$07A6`), `lives`, `score`, `score2` (oba hráči, ★ bloky `$07C5`/`$07D4`), `hiScore`, `time`, `collected`, `needed`, `caveOver`, `gameOver`, `demo` |
| `controls` | `left`, `right`, `up`, `down`, `fire` |
| `pokey` | ★ **zápisy do POKEY** za snímek (M6), jen když nějaké jsou: `[[řádek, registr, hodnota], …]` — registr 0–8 = `AUDF1, AUDC1 … AUDF4, AUDC4, AUDCTL` (`$D200`–`$D208`), řádek = scanline od začátku snímku (0 = VBI), u průchodu podle modelu kadence i za hranici snímku (průchod trvá několik snímků, ZADANI §10.6). Pořadí = pořadí zápisů originálu; `tools/matchsound.mjs` je kontroluje zápis po zápisu. Model je podává `audioManager.writeChip('pokey', {frame, writes})` (svision `ChipStream`) |

## Stav

**M3: jeskyně žije** — průchod a krok VBI jsou kód originálu, doložený
`tools/matchscan.mjs` (mřížka, obraz, sada B, log snímků). **M5: hra
kolem jeskyně** — `caveRules.js` doložený `tools/matchrules.mjs` na celých
hrách (bonus, životy, dva hráči, mezihry, OUT OF TIME, GAME OVER, zakrytí,
demo). **M6: zvuk** — `frame.pokey` jsou zápisy do POKEY na místech
originálu, doložené `tools/matchsound.mjs` (77 357 zápisů, 0 rozdílů);
model je podává svision `ChipStream` (R-040). Tvar protokolu hlídá
`tools/runworker.mjs` (48 kontrol).
