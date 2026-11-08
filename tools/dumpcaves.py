#!/usr/bin/env python3
"""dumpcaves — 20 jeskyní z tabulky originálu → data/caves.json.

    ./tools/dumpcaves.py [--print]

★ Vše odečteno z běhového kódu (sources/asm/main.asm, disasm_notes.md §4, §9):

- tabulka ukazatelů `$3500` (20 slov, relativně k `$3528`; `$1E33`:
  `$3528 + ptr[číslo−1]`), jeskyně se kopíruje na `$5F00` (240 B)
- hlavička 32 B: `$00` číslo, `$01` čas kouzelné zdi / améby, `$02` hodnota
  diamantu, `$03` extra hodnota, `$04`–`$08` semínka PRNG (obtížnost 1–5,
  `$1E61`: `$0781 = $5F04+X`), `$09`–`$0D` počty diamantů (`$1ED1`),
  `$0E`–`$12` časy (`$1EB2`), `$13`–`$17` **COLOR0–4** (`$1E71`),
  `$18`–`$1B` čtyři náhodné objekty, `$1C`–`$1F` jejich pravděpodobnosti
  (`$1BE8`: objekt platí, když PRNG < pravděpodobnost; poslední platný vyhrává)
- od `$20` kreslicí instrukce (`$21A8`): bity 6–7 typ, bity 0–5 objekt;
  `00` bod (x, y), `40` čára (x, y, délka, směr 0–7 podle `$2098`),
  `80` plný obdélník (x, y, šířka, výška, výplň — okraj objektem, vnitřek
  výplní, `$2112`), `C0` dutý obdélník (x, y, šířka, výška, `$2152`);
  konec `$FF`. Objekt `$25` (vchod) navíc zapíše start Rockforda `$079E/$079F`.

Jména objektů: ★ kde je zná kód (`$01` hlína = výchozí výplň, `$07` ocel =
rám `$2235`, `$25` = start Rockforda); zbytek podle tabulky C64 (Broadribb,
druhá ruka) — sedí na dlaždice sady, ale je to `?` do M3/M4."""
import os, sys, json, argparse
sys.path.insert(0, os.path.dirname(__file__))
import bdlib

ROOT = os.path.join(os.path.dirname(__file__), '..')
TABLE, POINTERS, COPY = 0x3528, 0x3500, 0x5F00
OUT = os.path.join(ROOT, 'data', 'caves.json')

# ★ směry čar: tabulka slov $2098 (−40, −39, +1, +41, +40, +39, −1, −41) nad mřížkou šířky 40
DIRECTIONS = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]

OBJECTS = {  # kód → jméno; ★ = z kódu Atari, jinak ? Broadribb (C64)
    0x00: 'space', 0x01: 'dirt', 0x02: 'brick', 0x03: 'magicWall', 0x04: 'preOutbox', 0x05: 'outbox',
    0x07: 'steel', 0x08: 'fireflyL', 0x09: 'fireflyU', 0x0A: 'fireflyR', 0x0B: 'fireflyD',
    0x10: 'boulder', 0x12: 'boulderFalling', 0x14: 'diamond', 0x16: 'diamondFalling',
    0x25: 'inbox', 0x30: 'butterflyD', 0x31: 'butterflyL', 0x32: 'butterflyU', 0x33: 'butterflyR',
    0x38: 'rockford', 0x3A: 'amoeba'
}
STARRED = {0x01, 0x07, 0x25}

def cave_name(n):
    return chr(ord('A') + n - 1) if n <= 16 else 'I%d' % (n - 16)

def decode_instructions(data, off):
    out = []
    while data[off] != 0xFF:
        code = data[off]; kind = code & 0xC0; obj = code & 0x3F
        x, y = data[off + 1], data[off + 2]
        if kind == 0x00:
            out.append({'type': 'point', 'object': obj, 'x': x, 'y': y}); off += 3
        elif kind == 0x40:
            out.append({'type': 'line', 'object': obj, 'x': x, 'y': y, 'length': data[off + 3], 'direction': data[off + 4]}); off += 5
        elif kind == 0x80:
            out.append({'type': 'filledRect', 'object': obj, 'x': x, 'y': y, 'width': data[off + 3], 'height': data[off + 4], 'fill': data[off + 5]}); off += 6
        else:
            out.append({'type': 'rect', 'object': obj, 'x': x, 'y': y, 'width': data[off + 3], 'height': data[off + 4]}); off += 5
    return out, off + 1

def dump(mem):
    ptrs = [int.from_bytes(mem[POINTERS + 2 * i:POINTERS + 2 * i + 2], 'little') for i in range(20)]
    caves = []
    for i, p in enumerate(ptrs):
        a = TABLE + p
        ins, end = decode_instructions(mem, a + 0x20)
        h = mem[a:a + 0x20]
        caves.append({
            'number': h[0], 'name': cave_name(h[0]), 'intermission': h[0] > 16,
            'address': '$%04X' % a, 'length': end - a, 'raw': mem[a:end].hex(),
            'header': {
                'magicWallTime': h[1], 'diamondValue': h[2], 'extraDiamondValue': h[3],
                'seeds': list(h[4:9]), 'diamondsNeeded': list(h[9:14]), 'times': list(h[14:19]),
                'colors': list(h[0x13:0x18]), 'randomObjects': list(h[0x18:0x1C]), 'randomProbabilities': list(h[0x1C:0x20])
            },
            'instructions': ins
        })
        assert h[0] == i + 1, 'jeskyně %d má číslo %d' % (i + 1, h[0])
    return {
        '_comment': 'tools/dumpcaves.py — 20 jeskyní z tabulky $3528 referenčního programu (ukazatele $3500). Hlavička 32 B (COLOR0–4 v $13–$17), kreslicí instrukce od $20. Doloženo tools/matchcaves.mjs (C64 surová data, cartridge) a tools/matchcavegen.mjs (100 vygenerovaných jeskyní proti originálu).',
        'table': '$%04X' % TABLE, 'pointers': '$%04X' % POINTERS, 'copy': '$%04X' % COPY,
        'directions': DIRECTIONS,
        'objects': {('%02X' % k): {'name': v, 'measured': k in STARRED} for k, v in OBJECTS.items()},
        'caves': caves
    }

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--print', action='store_true'); a = ap.parse_args()
    data = dump(bdlib.program_image())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, 'w'), indent=1)
    n = sum(len(c['instructions']) for c in data['caves'])
    print('data/caves.json: %d jeskyní, %d B dat, %d instrukcí' % (len(data['caves']), sum(c['length'] for c in data['caves']), n))
    if a.print:
        for c in data['caves']:
            h = c['header']
            print(c['number'], c['name'], c['address'], c['length'], 'B  sem', h['seeds'], 'diam', h['diamondsNeeded'], 'čas', h['times'], 'barvy', ['%02X' % x for x in h['colors']], 'náh', ['%02X' % x for x in h['randomObjects']], h['randomProbabilities'], len(c['instructions']), 'instr')

if __name__ == '__main__':
    main()
