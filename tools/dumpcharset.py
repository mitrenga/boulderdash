#!/usr/bin/env python3
"""dumpcharset — znakové sady a tabulka dlaždic z originálu → data/charset.json.

    ./tools/dumpcharset.py

★ Odečteno z běhového kódu (`sources/asm/main.asm`, `disasm_notes.md` §9):

- **tři bloky** `$4000`–`$4BFF` (soubor `$6000`–`$6BFF`): sada A `$4000`
  (`CHBAS $40`: titulka, menu, stavový řádek), sada B `$4400` (DLI `$09E0`
  přepne `CHBASE $44` pro jeskyni), blok C `$4800`–`$4BBF` (zdroj
  animačních rámců, kopíruje se do sady B)
- **dlaždice 2 × 2**: objekt X → základní znak `$3C40[X]` a čtyři znaky
  `c, c+1, c+16, c+17` (`$0BA3`: `ADC #1`, `ADC #$0F`, `ADC #1`) — sada B
  je tedy 16 znaků na řádek dlaždic
- **glyfy přepisované za běhu** (nejsou v souboru takové, jaké je hra
  ukazuje) — seznam `RUNTIME` níž, každý s adresou kódu: znak 0 a znaky
  9–10 sady A (titulka), dlaždice motýla `$20`, kouzelné zdi `$22`,
  `$40`, diamantu `$48`, Rockforda `$4C`, prázdna `$60`, mušky `$64`
  a zakrývací znak `$7C`. Animace dlaždic: `$1A35` kopíruje každý druhý
  snímek 8 B řádky z **bloku C** (`$4800`, `$4900`, `$4A00`, `$4B00`
  + X, 8 rámců po 16 B) do sady B; Rockford z `$3D00`–`$3FFF`. Sémantika
  je M3/M4; tady jsou jen adresy, aby `matchcharset.mjs` věděl, co smí být
  jinak.

Tabulky `$3D00`–`$3FFF` (rámce Rockforda) se ukládají surově."""
import os, sys, json, base64
sys.path.insert(0, os.path.dirname(__file__))
import bdlib

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'data', 'charset.json')

BLOCKS = [('A', 0x4000, 0x400, 'titulka, menu, stavový řádek (CHBAS $40)'),
          ('B', 0x4400, 0x400, 'jeskyně — dlaždice 2 × 2 (DLI → CHBASE $44)'),
          ('C', 0x4800, 0x400, 'zdroj animačních rámců pro sadu B')]

# ★ rozsahy, které kód přepisuje za běhu (adresa, délka, kde v kódu). Dlaždice
# = základní znak z $3C40 → glyfy c, c+1 (+8 B) a c+16, c+17 (+$80 B).
RUNTIME = [
    [0x4000, 8, '$2554 ← $4058, $2918 ← 0, $15D1 rotace (znak 0 sady A)'],
    [0x4048, 16, '$240A: znaky 9–10 sady A ← $4030/$4038 OR znak 0 (titulka)'],
    [0x4500, 16, '$1A6C: dlaždice $20 (motýl) ← blok C $4B00/$4B08 + X, 8 rámců'],
    [0x4580, 16, '$1A78: dtto ← $4B80/$4B88 + X'],
    [0x4510, 16, '$1AFD ← $4670, $1B12 ← $4760 + X (kouzelná zeď, dlaždice $22)'],
    [0x4590, 16, 'dtto'],
    [0x4600, 16, '$1A54: dlaždice $40 (v $3C40 nepoužitá) ← blok C $4800/$4808 + X'],
    [0x4680, 16, '$1A60: dtto ← $4880/$4888 + X'],
    [0x4640, 16, '$1A3C: dlaždice $48 (diamant) ← blok C $4A00/$4A08 + X, 8 rámců'],
    [0x46C0, 16, '$1A48: dtto ← $4A80/$4A88 + X'],
    [0x4660, 16, '$1986–$1A34: dlaždice $4C (Rockford) ← $3D00–$3FFF podle směru a náhody'],
    [0x46E0, 16, 'dtto'],
    [0x4700, 16, '$15AD ← RANDOM při odkrývání, $1581 ← 0 (prázdno, dlaždice $60)'],
    [0x4780, 16, 'dtto'],
    [0x4720, 16, '$1A84: dlaždice $64 (muška) ← blok C $4900/$4908 + X, 8 rámců'],
    [0x47A0, 16, '$1A90: dtto ← $4980/$4988 + X'],
    [0x47E0, 8, '$193E: znak $7C (zakrytí při odkrývání) rotace'],
]
# ★ $1B62/$1A35: index rámce X = 2 × $085C, $085C += 8 každý druhý snímek, & $3F → 8 rámců po 16 B v bloku C

def main():
    mem = bdlib.program_image()
    tiles = list(mem[0x3C40:0x3C80])
    out = {
        '_comment': 'tools/dumpcharset.py — sady $4000–$4BFF referenčního programu (base64) a tabulka dlaždic $3C40. Doloženo tools/matchcharset.mjs (proti paměti běžícího originálu).',
        'blocks': [{'name': n, 'address': '$%04X' % a, 'length': l, 'note': note, 'data': base64.b64encode(mem[a:a + l]).decode('ascii')}
                   for n, a, l, note in BLOCKS],
        'tiles': {'table': '$3C40', 'layout': [0, 1, 16, 17], 'base': tiles},
        'runtimePatched': [{'address': '$%04X' % a, 'length': l, 'code': c} for a, l, c in RUNTIME],
        'rockfordFrames': {'address': '$3D00', 'length': 0x300, 'data': base64.b64encode(mem[0x3D00:0x4000]).decode('ascii'),
                           'note': '★ $1986–$1A34: 8B řádky glyfů kopírované do $4660/$4668/$46E0/$46E8 podle směru a náhody; význam rámců je M3'}
    }
    json.dump(out, open(OUT, 'w'), indent=1)
    used = sorted(set(tiles))
    print('data/charset.json: 3 bloky (%d B), dlaždice: %d objektů, základy %s' % (sum(b[2] for b in BLOCKS), sum(1 for t in tiles if t), ' '.join('%02X' % u for u in used)))

if __name__ == '__main__':
    main()
