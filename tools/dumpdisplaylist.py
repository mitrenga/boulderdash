#!/usr/bin/env python3
"""dumpdisplaylist — display listy, registry ANTIC/GTIA a texty obrazovek
běžícího originálu v každém stavu (titulka, menu, jeskyně před narozením,
po narození, demo) → sources/docs/display_list.md. Měřeno, ne odhadnuto."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from a8emu import *
import bdrun

OUT = os.path.join(bdrun.ROOT, 'sources', 'docs', 'display_list.md')

def snapshot(e, title, notes=''):
    dl = e.dlist().strip(); antic = e.regs('ANTIC').strip(); gtia = e.regs('GTIA').strip()
    vdslst = int.from_bytes(e.read(0x200, 2), 'little'); vvblkd = int.from_bytes(e.read(0x224, 2), 'little')
    chbas = e.peek(0x2F4); sdlst = int.from_bytes(e.read(0x230, 2), 'little')
    import re
    m = re.search(r'DLI LMS ([0-9A-F]{4}) MODE 6', dl)     # ★ stavový řádek: dva buffery $080B / $081F, DL střídá
    st_addr = int(m.group(1), 16) if m else bdrun.STATUS
    status = f'${st_addr:04X}: `' + bdrun.decode(e.read(st_addr, 20)) + '`'
    s = f"## {title}\n\n(snímek {e.frame} od zapnutí, RTCLOK {int.from_bytes(e.read(0x12,3),'big')}, režim `$0876` = {e.peek(bdrun.MODE)})\n\n"
    if notes: s += notes + '\n\n'
    s += f"SDLST `${sdlst:04X}` · CHBAS `${chbas:02X}` (sada na `${chbas<<8:04X}`) · VDSLST (DLI) `${vdslst:04X}` · VVBLKD (odložená VBI) `${vvblkd:04X}` · stavový řádek {status}\n\n"
    s += "```\n" + dl + "\n\n" + antic + "\n" + gtia + "\n```\n\n"
    return s

def main():
    e = bdrun.start(); parts = []
    parts.append(snapshot(e, 'Titulka (po zapnutí)', 'Logo z dlaždic v režimu 4 (`$4C00`, 19 řádků) a dva bloky režimu E (bitmapa `$2D80`, `$3000`).'))
    bdrun.to_menu(e)
    rows = [bdrun.decode(e.read(a, 20)) for a in (0x4F20, 0x4F34, 0x4F48, 0x4F5C, 0x4F70)]
    parts.append(snapshot(e, 'Menu (po START)', 'Pět řádků režimu 6 (20 znaků, dvojitá šířka):\n\n' + '\n'.join(f'- `{r}`' for r in rows)))
    bdrun.to_cave(e); f_cave = e.frame
    # odkrývání: kolik snímků se mění obraz jeskyně
    prev = e.read(bdrun.CAVE_SCREEN, 0xDC0); changes = []
    for k in range(40):
        e.frames(5); cur = e.read(bdrun.CAVE_SCREEN, 0xDC0)
        changes.append(sum(1 for i in range(len(cur)) if cur[i] != prev[i])); prev = cur
    last_big = max(i for i, c in enumerate(changes) if c > 4) + 1
    parts.append(snapshot(e, 'Jeskyně A/1 po odkrytí, před narozením',
        f'Po fire v menu se jeskyně **odkrývá** (náhodné buňky, ubývá): změněných bajtů obrazu po 5 snímcích: `{changes}` — odkrývání končí kolem snímku **{last_big*5}** po fire, pak bliká jen vchod (4 B = jedna buňka 2×2 každých 5 snímků) a hra **čeká na fire**; čas neběží.'))
    bdrun.birth(e); e.frames(30)
    parts.append(snapshot(e, 'Jeskyně A/1 po narození Rockforda', 'Po fire se Rockford narodí, stavový řádek přepne na diamanty/čas.'))
    e.savestate(os.path.join(bdrun.ROOT, 'build', 'caveA.a8s'))
    e.close()
    # demo: titulka bez vstupu
    e = A8Emu(bdrun.REF, timeout=2.0); first = e.dlist().strip().splitlines()[0]; step = 25; demo_at = None
    for i in range(0, 3000, step):
        e.frames(step); d = e.dlist().strip().splitlines()[0]
        if d != first: demo_at = e.frame; break
    parts.append(snapshot(e, 'Demo (titulka bez vstupu)', f'Titulka bez vstupu přejde do dema mezi snímkem **{demo_at-step} a {demo_at}** od zapnutí (krok měření {step} snímků).' if demo_at else 'Demo do 3000 snímků nenastalo.'))
    e.close()
    head = ("# Display listy a registry běžícího originálu\n\n"
            "★ Změřeno `tools/dumpdisplaylist.py` (atari800 5.0, 800XL PAL, OS XL rev. 2, obraz "
            "`[cart version].xex` = reference). Adresy jsou za běhu (program `$0900`–`$4CBF`, soubor − `$2000`).\n\n"
            "Co z toho plyne pro platformu, je v `../../ZADANI.md` §2; tady jsou jen výpisy.\n\n")
    open(OUT, 'w').write(head + '\n'.join(parts))
    print('→', OUT); print(open(OUT).read())

if __name__ == '__main__':
    main()
