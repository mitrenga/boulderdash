#!/usr/bin/env python3
"""tracecavegen — zlatý záznam vygenerovaných jeskyní z běžícího originálu:
20 jeskyní × 5 obtížností = 100 běhů atari800, každý od zapnutí.

    ./tools/tracecavegen.py [--jobs 4] [--frames 150] [--only 1,5,17]

Průchod: titulka → START → menu; v menu se podstrčí číslo jeskyně `$07B7`
a obtížnost `$07B8` (`bdrun.cave_setup` — menu je přepisuje jen při pohybu
páčky, takže je fire převezme do stavového řádku i do načtení jeskyně),
fire, zastavit na ★ `$2645` (start jeskyně), pak se nechá
doběhnout na ★ `$2674` (mřížka vygenerovaná, obraz nakreslený `$1954`,
ještě nezakrytý) a zapíše se:

- **mřížka** `$4C00`–`$4FBF` (40 × 24 kódů objektů; jeskyně = řádky 2–23)
- **obraz** `$5000`–`$5E6F` (44 × 80 znaků + okraje, dlaždice 2 × 2 z tabulky `$3C40`)
- kopie hlavičky + instrukcí `$5F00`–`$5FEF`, stav PRNG `$0781/$0782`,
  start Rockforda `$079E/$079F`, příznak mezihry `$07AF`, display list
  `$5EA0` (81 B), HSCROL/VSCROL, stíny COLOR0–4, stavový řádek `$081F`

a po dalších `--frames` snímcích (odkryto, čeká se na fire) totéž s příponou
`Later`: mřížka (co se pohnulo ještě před narozením), display list
a HSCROL/VSCROL (okno už posunuté ke startu Rockforda — scroll je M3),
stavový řádek

Výstup `build/ref/cavegen.json` čte `tools/matchcavegen.mjs`."""
import os, sys, json, re, argparse, time
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
import bdrun
from a8emu import STICK_NONE

ROOT = bdrun.ROOT
OUT = os.path.join(ROOT, 'build', 'ref', 'cavegen.json')

def rv(name, text):
    return int(re.search(name + r'=\s*([0-9A-F]{2})', text).group(1), 16)

def one(job):
    """Jeden běh; start atari800 není na snímek deterministický (SIGINT po
    time.sleep), takže se běh, který nechytil breakpoint nebo ve kterém monitor
    zmlkl, zopakuje od zapnutí (nejvýš 3×)."""
    for attempt in range(3):
        try:
            rec = one_run(job)
        except RuntimeError as err:
            print('  pokus %d %s: %s' % (attempt + 1, job[:2], err), flush=True); continue
        if rec['hit']:
            return rec
        print('  pokus %d %s: breakpoint nechycen' % (attempt + 1, job[:2]), flush=True)
    return rec

def one_run(job):
    cave, level, frames = job
    e = bdrun.start(); bdrun.to_menu(e)
    try:
        hit = bdrun.cave_setup(e, cave, level)
    except RuntimeError:
        e.close(); raise
    # ★ $2674: po JSR $1954 — mřížka hotová, obraz nakreslený, ještě před zakrytím ($1852) a odkrýváním
    drawn = bdrun.run_to(e, bdrun.CAVE_DRAWN)
    rec = {
        'cave': cave, 'level': level, 'hit': hit and drawn,
        'header': e.read(0x5F00, 0xF0).hex(),
        'grid': e.read(0x4C00, 40 * 24).hex(),
        'screen': e.read(0x5000, 0x0E70).hex(),
        'rand': list(e.read(0x0781, 2)),
        'rockford': list(e.read(0x079E, 2)),
        'intermission': e.peek(0x07AF),
    }
    e.set_breakpoint('xitvbv')
    e.frames(frames, trig=1)
    antic = e.regs('ANTIC'); gtia = e.regs('GTIA')
    rec.update({
        'frame': e.frame,
        'gridLater': e.read(0x4C00, 40 * 24).hex(),
        'caveNumber': e.peek(bdrun.CAVE_NUMBER), 'levelIndex': e.peek(bdrun.LEVEL_INDEX),
        'dlist': e.read(0x5EA0, 0x51).hex(),
        'hscrol': rv('HSCROL', antic), 'vscrol': rv('VSCROL', antic),
        'colors': [rv('COLPF%d' % i, gtia) for i in range(4)] + [rv('COLBK', gtia)],
        'status': e.read(0x081F, 20).hex(),
    })
    e.close()
    return rec

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=4); ap.add_argument('--frames', type=int, default=150)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    caves = [int(x) for x in a.only.split(',')] if a.only else list(range(1, 21))
    jobs = [(c, l, a.frames) for c in caves for l in range(5)]
    t = time.time()
    with Pool(a.jobs) as p:
        recs = p.map(one, jobs)
    bad = [r for r in recs if not r['hit'] or int(r['header'][:2], 16) != r['cave']]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'_comment': 'tools/tracecavegen.py — mřížka, obraz a registry originálu %d snímků po fire, 20 jeskyní × 5 obtížností' % a.frames,
               'frames': a.frames, 'caves': recs}, open(OUT, 'w'))
    print(f'{len(recs)} běhů za {time.time()-t:.0f} s → {OUT}; nezachycených: {len(bad)}', [(r['cave'], r['level']) for r in bad])

if __name__ == '__main__':
    main()
