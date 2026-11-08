#!/usr/bin/env python3
"""dumpglobal — geometrie mřížky, generátor, display list jeskyně, pořadí
jeskyní → data/global.json.

    ./tools/dumpglobal.py

★ Z běhového kódu (`sources/asm/main.asm`, `disasm_notes.md` §9):

- **mřížka** `$4C00`, 40 × 24 kódů objektů, tabulka řádků `$2047`;
  jeskyně = řádky 2–23. Náhodná výplň `$1C02` plní řádky 3–23 (y = 1..21;
  `$1840` s A = 1 dá `$4C4F`, + `$29` = `$4C78` = řádek 3, ukazatel pak
  běží dál po 40), x 0..39; pak rám oceli `$2235` (dutý obdélník
  objektem 7 na 0,2 40×22) a teprve pak instrukce `$21A8`.
- **PRNG** `$0C01` (semínko 1 `$0782` = 0, semínko 2 `$0781` = hlavička
  `$04+úroveň`, konstanta `$13`) — algoritmus je v `app/caveGen.js`.
- **obraz jeskyně** `$5003` + 160 × řádek (tabulka `$09EB`, 22 řádků; dlaždice
  2 × 2 znaky, řádek 80 B); `$5000`–`$5002` a `$5DC3`–`$5E62` = `$4A`
  (`$18BF`); odkrývání plní obraz znakem `$7C` (`$1852`).
- **display list** šablona `$0B28` (81 B) → `$5EA0` (`$29C4`); LMS
  stavového řádku `$5EA4/$5EA5` (`$081F` před narozením, `$25A1`);
  registry na startu jeskyně: CHBAS `$40`, DLI → `$44`, HSCROL 3, VSCROL 0
  (`matchcavegen.mjs`: platí všude, kde okno ještě stojí na šabloně).
  **Operandy LMS řádků** šablony (`$5000`, `$5050`…) a HSCROL platí jen pro
  okno vlevo nahoře — u jeskyní, kde Rockford začíná jinde, je scroll ve
  VBI posune ještě během generování (LMS u B, F–P; HSCROL u M/2, M/5 —
  M3); aplikace v M2 nechává okno na šabloně.
- **pořadí jeskyní** `$1E0B`: dvojice (další jeskyně, příznak mezihry)
  pro čísla 1–20 (`$1E33` → `$07AF`, `$27B8` → další); `$15` = konec cyklu
  (úroveň +1, jeskyně A, `$27B8`)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
import bdlib

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'data', 'global.json')

def main():
    mem = bdlib.program_image()
    rows = [int.from_bytes(mem[0x2047 + 2 * i:0x2049 + 2 * i], 'little') for i in range(24)]
    screen_rows = [int.from_bytes(mem[0x09EB + 2 * i:0x09ED + 2 * i], 'little') for i in range(22)]
    seq = [{'number': i + 1, 'next': mem[0x1E0B + 2 * i], 'intermission': mem[0x1E0C + 2 * i]} for i in range(20)]
    assert rows == [0x4C00 + 40 * i for i in range(24)] and screen_rows == [0x5003 + 160 * i for i in range(22)]
    out = {
        '_comment': 'tools/dumpglobal.py — pevné tabulky a adresy referenčního programu: mřížka, generátor, obraz jeskyně, display list, pořadí jeskyní. Registry na startu jeskyně ověřuje tools/matchcavegen.mjs na 100 jeskyních.',
        'grid': {'address': '$4C00', 'width': 40, 'rows': 24, 'rowTable': '$2047', 'caveRows': [2, 23],
                 'randomFill': {'rows': [3, 23], 'columns': [0, 39], 'default': 1, 'code': '$1C02 / $1BE8'},
                 'steelFrame': {'object': 7, 'x': 0, 'y': 2, 'width': 40, 'height': 22, 'code': '$2235'},
                 'neighbours': {'table': '$2098', 'offsets': [-40, -39, 1, 41, 40, 39, -1, -41]}},
        'prng': {'routine': '$0C01', 'seed1': '$0782 = 0', 'seed2': '$0781 = hlavička[4 + úroveň]', 'constant': 0x13,
                 'usage': '$1BE8: objekt i platí, když nový $0782 < pravděpodobnost[i]; poslední platný vyhrává'},
        'caveScreen': {'base': '$5003', 'rowStride': 160, 'rowTable': '$09EB', 'rows': 22, 'tileRow': 80,
                       'margin': {'value': 0x4A, 'ranges': ['$5000–$5002', '$5DC3–$5E62'], 'code': '$18BF'},
                       'covered': {'char': 0x7C, 'code': '$1852 / $1870'}},
        'displayList': {'address': '$5EA0', 'template': '$0B28', 'raw': mem[0x0B28:0x0B28 + 0x51].hex(),
                        'statusLms': '$5EA4', 'statusBeforeBirth': '$081F', 'statusInGame': '$080B'},
        'caveStart': {'chbase': 0x40, 'dli': [{'chbase': 0x44}], 'dmactl': 0x22, 'chactl': 2, 'hscrol': 3, 'vscrol': 0, 'pmbase': 0, 'gractl': 0, 'prior': 0,
                      'colorsFromHeader': '$13–$17 → COLOR0–4 ($1E71)',
                      'windowNote': 'LMS řádků = šablona (okno vlevo nahoře); originál je scrollem ve VBI posune ke startu Rockforda ještě před nakreslením — M3'},
        'sequence': {'table': '$1E0B', 'endOfCycle': 0x15, 'entries': seq},
        'menu': {'startCaves': [1, 5, 9, 13], 'levels': 5, 'demo': {'cave': 1, 'level': 0}},
        # ★ hudba titulky $23A0 (M6): noty = bajty stránky $4400 (sada B, data/charset.json) jako index (×2) do tabulky 16bit
        # dělitelů $2328 — 60 dvojic dat a za nimi kód, protože index sahá přes celou stránku
        'title': {'code': '$23A0', 'noteTable': '$2328', 'notes': mem[0x2328:0x2428].hex(), 'notePage': '$4400',
                  'audctl': 0x78, 'init': '$2608: AUDC1 = AUDC3 = 0, SKCTL = 3, AUDCTL = $78'}
    }
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print('data/global.json: DL %d B, pořadí %s' % (len(out['displayList']['raw']) // 2, ' '.join('%d→%d%s' % (s['number'], s['next'], '*' if s['intermission'] else '') for s in seq)))

if __name__ == '__main__':
    main()
