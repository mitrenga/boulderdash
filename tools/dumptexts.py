#!/usr/bin/env python3
"""dumptexts — texty, šablony stavového řádku, titulka a demo → data/texts.json,
data/demo.json.

    ./tools/dumptexts.py

★ Z běhového kódu (`sources/asm/main.asm`, `disasm_notes.md` §7, §10):

- **řetězce** `$0A18`–`$0B27`: 13 × 20 znaků v interním kódu (bit 7 = barva
  v režimu 6 / PF3 v režimu 4), oddělené `$00`. Kdo je používá: `$2252`
  (titulka: `$4F20`, `$4F34`, `$4F48`, `$4F5C`, `$4F70`), `$2925` (kopie
  `$0A6C`/`$0A81` do RAM `$07E3`/`$07F7` = LAST/HIGH, `$0AAB` → `$081F`),
  `$1F67` (`$0A96` GAME OVER jako LMS stavového řádku), `$25BE` barvy
  titulky/menu (COLOR0–4)
- **stavový řádek** `$081F` (před narozením, šablona `$0AAB` „PLAYER 1,
  3 MEN A/0"): `$282B`–`$2883` zapisuje +7 hráč (`$07A6+$91`), +10 životy
  (`$07B6+$90`), +13 `A`/`E` (MAN/MEN podle `$07B6 == 1`), +16 jeskyni
  (`$07B7+$A0`), +18 úroveň (`$07B8+$91`); `$080B` (po narození):
  `$2943` +3 = `$BC` (diamant), `$1176` +1..2 ← `$083D+$50`, `$1187`
  +4..5 ← `$07B4+$90`, `$1165` +7..8 ← `$083B+$50`, `$10E7` +10..12 ←
  `$0836+$90` (čas), `$107C` +14..19 ← `$07B9+$90` (skóre). Co ty
  proměnné znamenají, doměří M5 — tady jsou jen pozice.
- **titulka**: obraz `$4C00` staví `$2252` (logo z bloku sady A
  `$4200`/`$4300` s bitem 7, rám znakem 3 `$2308`) — od M7 je to
  `tools/dumptitle.py` → `data/title.json`. `$2A12` (do M6 tady jako
  „šablona titulky") na obraz nejde: nic v kódu na tu adresu neukazuje.
- **demo** `$3BC0` (`$2896`): bajt = (počet << 4) | páčka (STICK nibble),
  konec páčkou 0 nebo fire; jednotka = jedno volání `$1D8F` (celý průchod
  mřížkou); jeskyně A, úroveň 1 (`$2583`)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
import bdlib

ROOT = os.path.join(os.path.dirname(__file__), '..')

STRINGS = [  # ★ adresa, klíč, kdo používá
    (0x0A18, 'byPeterLiepa', '$229C → titulka $4F20'),
    (0x0A2D, 'withChrisGray', '$22A9 → titulka $4F34'),
    (0x0A42, 'players', '$22FA → titulka $4F5C; $2222 mění +0 hráče ($07A7+$51) a +10 joysticky ($07AD+$51)'),
    (0x0A57, 'plyr12', '$22C6 → titulka $4F20 (během hry)'),
    (0x0A6C, 'last', '$2925 → RAM $07E3 (titulka $4F34)'),
    (0x0A81, 'high', '$2925 → RAM $07F7 (titulka $4F48)'),
    (0x0A96, 'gameOver', '$1F67: LMS stavového řádku'),
    (0x0AAB, 'playerStatus', '$2925 → $081F; $282B patchuje +7, +10, +13, +16, +18'),
    (0x0AC0, 'outOfTime', '$1FA7: LMS stavového řádku ($0AC0)'),
    (0x0AD5, 'bonusLife', '$1FF7: LMS stavového řádku ($0AD5)'),
    (0x0AEA, 'caveLevel', '$22ED → titulka $4F70; $2503 mění +7 jeskyni ($07B7+$60) a $2500 úroveň'),
    (0x0AFF, 'spacebarToResume', '$1C78: LMS stavového řádku ($0AFF) při pauze'),
    (0x0B14, 'pressButtonToPlay', '$22B6 → titulka $4F48'),
]

def main():
    mem = bdlib.program_image()
    strings = []
    for a, key, use in STRINGS:
        raw = mem[a:a + 20]
        assert mem[a + 20] == 0 or a == 0x0B14, '$%04X není ukončen nulou' % a
        strings.append({'key': key, 'address': '$%04X' % a, 'raw': raw.hex(), 'text': bdlib.decode_text(raw), 'use': use})
    texts = {
        '_comment': 'tools/dumptexts.py — texty referenčního programu v interním kódu (bit 7 = barva), šablony stavového řádku a titulka. Pozice patchů jsou z kódu; význam proměnných doměří M5.',
        'strings': strings,
        'titleColors': {'address': '$25BE', 'colors': list(mem[0x25BE:0x25C3])},
        'statusLine': {
            'buffers': ['$080B', '$081F'], 'lms': '$5EA4',
            'beforeBirth': {'template': 'playerStatus', 'buffer': '$081F',
                            'patches': [{'offset': 7, 'from': '$07A6 + $91', 'meaning': 'hráč 1/2'}, {'offset': 10, 'from': '$07B6 + $90', 'meaning': 'životy'},
                                        {'offset': 13, 'from': '$A1 if $07B6 == 1 else $A5', 'meaning': 'MAN/MEN'},
                                        {'offset': 16, 'from': '$07B7 + $A0', 'meaning': 'jeskyně'}, {'offset': 18, 'from': '$07B8 + $91', 'meaning': 'úroveň'}]},
            'inGame': {'buffer': '$080B', 'fixed': [{'offset': 3, 'value': 0xBC, 'meaning': 'diamant ($2943)'}],
                       'fields': [{'offset': 1, 'length': 2, 'from': '$083D + $50'}, {'offset': 4, 'length': 2, 'from': '$07B4 + $90'},
                                  {'offset': 7, 'length': 2, 'from': '$083B + $50'}, {'offset': 10, 'length': 3, 'from': '$0836 + $90', 'meaning': 'čas'},
                                  {'offset': 14, 'length': 6, 'from': '$07B9 + $90', 'meaning': 'skóre'}]}
        },
        'title': {'see': 'data/title.json (tools/dumptitle.py, M7): display list $0961, bitmapy režimu E, stavba obrazu $4C00 ($2252), animace ($2425)',
                  'unused': {'address': '$2A12', 'length': 0x2D80 - 0x2A12, 'note': 'do M6 tady jako šablona 19 × 40; nic v kódu na tu adresu neukazuje'},
                  'rows': {'$4F20': 'byPeterLiepa | plyr12', '$4F34': 'withChrisGray | last', '$4F48': 'pressButtonToPlay | high', '$4F5C': 'players', '$4F70': 'caveLevel'},
                  'rowsNote': 'řádky režimu 6 menu (DL $0928), titulka (DL $0961) je neukazuje'}
    }
    json.dump(texts, open(os.path.join(ROOT, 'data', 'texts.json'), 'w'), indent=1, ensure_ascii=False)

    raw = mem[0x3BC0:0x3C00]
    steps = []
    for b in raw:
        steps.append({'stick': b & 0x0F, 'count': b >> 4})
        if (b & 0x0F) == 0:
            break
    demo = {
        '_comment': 'tools/dumptexts.py — skript vstupů dema z $3BC0 ($2896): bajt = (počet << 4) | páčka (hodnota STICK: $F klid, $E nahoru, $D dolů, $B vlevo, $7 vpravo), jednotka = jeden průchod mřížkou ($1D8F), konec páčkou 0 nebo fire. Jeskyně A, úroveň 1 ($2583). Přehrání je M5.',
        'address': '$3BC0', 'cave': 1, 'level': 0, 'raw': raw[:len(steps)].hex(), 'steps': steps,
        'sticks': {'15': 'none', '14': 'up', '13': 'down', '11': 'left', '7': 'right'}
    }
    json.dump(demo, open(os.path.join(ROOT, 'data', 'demo.json'), 'w'), indent=1, ensure_ascii=False)
    print('data/texts.json: %d řetězců; data/demo.json: %d kroků (%d B)' % (len(strings), len(steps), len(steps)))
    for s in strings: print('  %s %-18s |%s|' % (s['address'], s['key'], s['text']))

if __name__ == '__main__':
    main()
