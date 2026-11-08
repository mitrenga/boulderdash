#!/usr/bin/env python3
"""dumptitle — titulka (logo BOULDER DASH, FIRST STAR) z referenčního
programu → data/title.json.

    ./tools/dumptitle.py

★ Z běhového kódu (`sources/asm/main.asm`, `disasm_notes.md` §7, §18,
`display_list.md` „Titulka"):

- **display list `$0961`** (SDLSTL po `$25D5`, jen když `$07AC` ≠ 0 —
  titulka; po START menu `$0928`): 3 × 8 prázdných řádků, LMS `$4C00`
  + 18 × režim 4 (19 řádků loga z dlaždic), LMS `$2D80` + 15 × režim E
  (16 řádků bitmapy), LMS `$3000` + 31 × režim E (32 řádků), JVB. Bez DLI.
- **obraz `$4C00`** (19 × 40, řádky `$2047` = `$4C00 + 40·n` — táž paměť,
  ve které ve hře leží mřížka jeskyně) staví `$2252`: řádky 1–2, 9–10
  a 17–18 znakem `$80`; logo z bloku sady A `$4200`/`$4300` s bitem 7
  (`$4200`+0…15 → `$4C50`, `$4300`+0…15 → `$4D90`, `$4210`+0…239 →
  `$4C78`, `$4310`+0…239 → `$4DB8`); nakonec dutý obdélník 40 × 19 znakem
  3 (`ins_rect` `$2152` s `$0867`–`$086B` = 3, 0, 0, 40, 19). Řádek 0 nemá
  jiný zdroj než ten rám.
- **bitmapy režimu E** `$2D80` (16 × 40 B) a `$3000` (32 × 40 B) jsou data
  v programu (logo FIRST STAR, © 1984).
- **barvy** `$25BE` → COLOR0–4 (`$25EE`), CHBAS `$40` (`$25CB`).
- **animace** (`$2425` z VBI, jen v režimu `$0876` = 1): každý druhý
  snímek (`$085E` liché → nic) `$15D1` otočí znak 0 sady A o řádek nahoru
  a `$240A` složí znak 9 = znak 6 | znak 0, znak 10 = znak 7 | znak 0
  (logo je z těch znaků, proto se „leskne"). `$2918` po každé jeskyni
  znak 0 vynuluje, `$2554` (hned za `$25C3`, tj. od druhého snímku titulky)
  do něj opíše znak 11 (v souboru je znak 0 nulový — první snímek titulky
  je vždy bez lesku, od druhého se leskne).
- **hudba** `$23A0` je v `data/global.json` (`title.notes`, M6); demo
  po druhém přetečení indexu not (`$0874` == 2, `$23FD`).

`$2A12` („šablona titulky" v `texts.json` do M6) na obraz nejde: nic v kódu
na tu adresu neukazuje, obraz titulky staví `$2252` do `$4C00`."""
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
import bdlib

ROOT = os.path.join(os.path.dirname(__file__), '..')

DLIST = 0x0961
SCREEN = 0x4C00

def display_list(mem):
    """Bajty display listu od $0961 po JVB včetně."""
    p = DLIST; out = bytearray()
    while True:
        op = mem[p]; low = op & 15
        n = 3 if (low == 1 or (low >= 2 and op & 0x40)) else 1
        out += mem[p:p + n]; p += n
        if low == 1 and op & 0x40:
            return bytes(out)
        assert len(out) < 256

def main():
    mem = bdlib.program_image()
    dl = display_list(mem)
    assert dl == bytes.fromhex('707070' '44004c' + '04' * 18 + '4e802d' + '0e' * 15 + '4e0030' + '0e' * 31 + '412809'), dl.hex()
    colors = list(mem[0x25BE:0x25C3])
    assert colors == [0x94, 0x96, 0x0C, 0x9E, 0x00]
    title = {
        '_comment': 'tools/dumptitle.py — titulka originálu: display list $0961, bitmapy režimu E, stavba obrazu $4C00 z bloku sady A ($2252), rám ($2308), barvy ($25BE), animace znaků 0/9/10 sady A ($2425). Doloženo tools/matchtitle.mjs proti paměti běžícího originálu.',
        'displayList': {'address': '$%04X' % DLIST, 'raw': dl.hex(), 'jvb': '$%04X' % (mem[DLIST + len(dl) - 2] | mem[DLIST + len(dl) - 1] << 8),
                        'note': '3 × 8 prázdných, LMS $4C00 + 18 × režim 4, LMS $2D80 + 15 × režim E, LMS $3000 + 31 × režim E; bez DLI'},
        'registers': {'chbase': 0x40, 'dmactl': 0x22, 'chactl': 0x02, 'hscrol': 0, 'vscrol': 0, 'pmbase': 0, 'gractl': 0, 'prior': 0, 'dli': [],
                      'note': '★ CHBAS $25CB; DMACTL/CHACTL/HSCROL/VSCROL/PMBASE/GRACTL/PRIOR změřené display_list.md (titulka)'},
        'colors': {'address': '$25BE', 'values': colors, 'note': '★ $25EE → COLOR0–4'},
        'screen': {
            'address': '$%04X' % SCREEN, 'rows': 19, 'columns': 40, 'rowsTable': '$2047 = $4C00 + 40·n (mřížka jeskyně ve hře)',
            'fill': {'value': 0x80, 'ranges': [{'address': '$4C28', 'length': 80}, {'address': '$4D68', 'length': 80}, {'address': '$4EA8', 'length': 80}], 'code': '$2252–$2262'},
            'logo': {'orBit': 0x80, 'block': 'sada A ($4000) + $200…$3FF', 'code': '$2264–$2290',
                     'copies': [{'from': '$4200', 'length': 16, 'to': '$4C50'}, {'from': '$4300', 'length': 16, 'to': '$4D90'},
                                {'from': '$4210', 'length': 240, 'to': '$4C78'}, {'from': '$4310', 'length': 240, 'to': '$4DB8'}]},
            'frame': {'object': 3, 'x': 0, 'y': 0, 'width': 40, 'height': 19, 'code': '$2308 → ins_rect $2152 (dutý obdélník)'}
        },
        'bitmaps': [{'address': '$2D80', 'rows': 16, 'raw': mem[0x2D80:0x2D80 + 16 * 40].hex()},
                    {'address': '$3000', 'rows': 32, 'raw': mem[0x3000:0x3000 + 32 * 40].hex()}],
        'animation': {'toggle': '$085E', 'everyOtherFrame': True, 'code': '$2425 (VBI, režim $0876 = 1)',
                      'rotate': {'char': 0, 'code': '$15D1: $4001…$4007 → $4000…$4006, starý $4000 → $4007'},
                      'compose': [{'char': 9, 'from': 6}, {'char': 10, 'from': 7}], 'composeCode': '$240A: znak = zdroj | znak 0',
                      'afterCave': {'char': 0, 'value': 0, 'code': '$2918'},
                      'menuStart': {'char': 0, 'from': 11, 'code': '$2554 (hned po $25C3 — od druhého snímku titulky)'},
                      'char0File': mem[0x4000:0x4008].hex(), 'char11File': mem[0x4058:0x4060].hex()},
        'tune': {'code': '$23A0', 'data': 'data/global.json title', 'demo': '★ $23FD: $07AB ≠ 0 a $0874 == 2 (druhé přetečení indexu not = 2 × 128 not × 8 snímků, první nota hned = 2 041 snímků od $2608; RTCLOK 2 060 od zapnutí) → $0875 = 1 → demo'},
        'unused': {'address': '$2A12', 'length': 0x2D80 - 0x2A12, 'note': 'v texts.json do M6 jako „šablona titulky"; nic v kódu na tu adresu neukazuje'}
    }
    json.dump(title, open(os.path.join(ROOT, 'data', 'title.json'), 'w'), indent=1, ensure_ascii=False)
    print('data/title.json: DL %d B, bitmapy %d + %d B, barvy %s' % (len(dl), 16 * 40, 32 * 40, ' '.join('$%02X' % c for c in colors)))

if __name__ == '__main__':
    main()
