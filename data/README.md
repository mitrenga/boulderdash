# data/

Datové soubory, které jdou do prohlížeče. **Každý z nich vyrábí nástroj
z `../tools/` z originálu** — žádný se needituje ručně a žádný neobsahuje
číslo, které by někdo odhadl. Server je posílá přes `db/appData.php`;
chybějící soubor dorazí jako `null` a aplikace to přežije.

| soubor | co v něm je | dělá ho | doloženo |
|---|---|---|---|
| `caves.json` | ★ 20 jeskyní z tabulky `$3528` (ukazatele `$3500`): surové bajty, hlavička 32 B (semínka, počty, časy, **5 barev `$13`–`$17` → COLOR0–4**, náhodné objekty a pravděpodobnosti), dekódované kreslicí instrukce, směry čar `$2098`, kódy objektů | `tools/dumpcaves.py` | `tools/matchcaves.mjs` (C64 opis Broadribba, cartridge) a `tools/matchcavegen.mjs` (100 jeskyní vygenerovaných kódem hry proti originálu) |
| `charset.json` | ★ sady `$4000` (A), `$4400` (B), blok C `$4800` (base64), tabulka dlaždic `$3C40` (objekt → základní znak; dlaždice c, c+1, c+16, c+17), rozsahy glyfů přepisovaných za běhu s adresou kódu, rámce Rockforda `$3D00`–`$3FFF` | `tools/dumpcharset.py` | `tools/matchcharset.mjs` proti paměti běžícího originálu (menu, jeskyně) |
| `texts.json` | ★ 13 řetězců `$0A18`–`$0B27` (interní kód, bit 7 = barva), pozice patchů stavového řádku (`$081F` před narozením, `$080B` ve hře), barvy titulky `$25BE` (`$2A12` není šablona — nic ji nečte, M7) | `tools/dumptexts.py` | stavový řádek `$081F` v `matchcavegen.mjs` (100×); texty GAME OVER / OUT OF TIME / BONUS LIFE a patche `$081F` v `matchrules.mjs` (M5) |
| `demo.json` | ★ skript vstupů dema `$3BC0`: (počet << 4) \| páčka, jednotka = průchod mřížkou `$1D8F`; jeskyně A/1 | `tools/dumptexts.py` | `tools/matchrules.mjs` — záznam skutečného dema (titulka → 259 průchodů → bonus → titulka) i dema ukončeného fire, 0 rozdílů (M5); worker ho přehrává z menu po 24 s |
| `global.json` | ★ mřížka `$4C00` 40 × 24 (jeskyně řádky 2–23, výplň 3–23, rám oceli), PRNG `$0C01`, obraz jeskyně `$5003` + 160·řádek s okraji `$4A`, šablona display listu `$0B28` → `$5EA0`, registry na startu jeskyně, pořadí jeskyní `$1E0B` | `tools/dumpglobal.py` | display list, HSCROL/VSCROL, okraje a barvy v `matchcavegen.mjs` (100×) |
| `title.json` | ★ titulka: display list `$0961` (režim 4 + E, bez DLI), bitmapy režimu E `$2D80`/`$3000` (FIRST STAR), stavba obrazu `$4C00` kódem `$2252` (řádky `$80`, logo z bloku sady A `$4200`/`$4300` \| `$80`, rám znakem 3), barvy `$25BE`, registry, animace lesku `$2425` (znak 0 otáčený `$15D1`, znaky 9/10 = 6/7 \| 0 `$240A`, `$2918`/`$2554`), pravidlo dema `$23FD` | `tools/dumptitle.py` | `tools/matchtitle.mjs` — 2 reference, 164 388 kontrol, 0 rozdílů (M7) |
| `screen_title.json`, `screen_title_after.json` | ★ titulka po zapnutí a po demu (`$2918` vynuloval znak 0): 64 KB paměti, registry, a `titleFrames` = 64 snímků `$085E` + znaků 0/9/10 sady A — **reference M7** | `tools/mkscreen.py --title [--after-demo] --frames 64` | `tools/matchscreen.mjs` (režim E platformy, 5 referencí, 384 000 kontrol, 0 rozdílů) a `tools/matchtitle.mjs` |
| `screen.json` | jeskyně A/1 po narození z běžícího originálu: 64 KB paměti, registry, DLI jako data — **reference M1**, aplikace ji od M2 nenačítá | `tools/mkscreen.py` | `tools/matchscreen.mjs` — 76 800 kontrol, 0 rozdílů proti nezávislému rendereru |
| `screen_scroll.json`, `screen_scroll2.json` | ★ jeskyně B/1 300 a 50 snímků po startu: okno posunuté scrollem ve VBI ke startu Rockforda (LMS řádků mimo šablonu; `scroll2` uprostřed pohybu s HSCROL 1 / VSCROL 4) — **reference M3** pro jemný scroll platformy | `tools/mkscreen.py --cave 2 --frames N --name …` | `tools/matchscreen.mjs` — 3 reference, 230 400 kontrol, 0 rozdílů |

## Co tu zatím není

`sounds.json` (POKEY, M6). Pravidla průchodu a kroku VBI (M3) nejsou data,
ale kód (`app/caveScan.js`, `app/caveFrame.js`) — jejich důkaz je
`tools/matchscan.mjs` nad záznamy `build/ref/scan/*.json.gz`
(`tools/tracescan.py`), které se necommitují (jsou z běhu originálu a dají
se za minutu vyrobit znovu).
