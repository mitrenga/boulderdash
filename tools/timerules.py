#!/usr/bin/env python3
"""timerules — kadence konce jeskyně změřená **bez harnessu** (M5): kolik
snímků trvá jedna sekunda bonusu (`$27F1`), zpoždění `L1C55` (GAME OVER,
konec bonusu), zakrývání `$1870` a jedno čekání `wait_trig` `$1F75`
(OUT OF TIME). Háčky čtení `RANDOM` z `tracescan` by zakrývání zpomalily
(tisíce čtení), proto se tu do paměti sází jen háčky `BRK`
(`tracerules.HOOKS`) a všechno se čte po snímcích z proměnných hry.

    ./tools/timerules.py                # A/1: východ → 150 s bonusu, pak zakrytí; B: timeout → OUT OF TIME (3 bliknutí)

Výstup: tabulka do stdout; čísla jdou do `CaveRules` (`app/caveRules.js`)
a do `MILNIKY.md`."""
import os, sys, json, re, time, statistics
sys.path.insert(0, os.path.dirname(__file__))
import bdrun, tracerules
from a8emu import STICK_NONE

def install_hooks(e):
    for addr, sites, code in tracerules.HOOKS:
        e.write(addr, code)
        for site, expected, kind in sites:
            assert e.read(site, len(expected)) == expected, '$%04X' % site
            e.write(site, bytes([0x20, addr & 0xFF, addr >> 8]) + (b'\xea' if kind == 'jsr+nop' else b''))
    e.cmd('BBRK ON')

def run(cave, level, scen, fire_after=None, max_frames=20000):
    """Jedna jeskyně: záznam (snímek, $0879, čas, $0859, $0790, LMS) od konce
    jeskyně po další cave_setup; vstup podle scénáře."""
    e = bdrun.start()
    try:
        bdrun.to_menu(e)
        assert bdrun.cave_setup(e, cave, level)
        install_hooks(e)
        xitvbv = int.from_bytes(e.read(0x0224, 2), 'little')
        e.cmd('BPC %04X' % xitvbv)
        stick, trig, patched, phase, rows = STICK_NONE, 1, False, 'cave', []
        for i in range(max_frames):
            e.write(0x0278, [stick]); e.write(0x0284, [trig]); e.write(0x0279, [stick]); e.write(0x0285, [trig])
            pc = tracerules.parse_pc(e.cmd('CONT'))
            if pc == xitvbv:
                if phase == 'end':
                    rt = int.from_bytes(e.read(0x12, 3), 'big')
                    b = e.read(0x0780, 0x100)
                    # offsety od $0780: $0879 čítač bonusu, $0836–$0838 čas, $0859 kryt, $0790 kolo zakrývání, $0833 flicker, $0795 cave_over
                    rows.append({'rt': rt, 'bonus': b[0xF9], 'time': b[0xB6] * 100 + b[0xB7] * 10 + b[0xB8], 'cover': b[0xD9], 'round': b[0x10],
                                 'lms': e.peek(0x5EA4), 'flicker': b[0xB3], 'over': b[0x15]})
                    if fire_after is not None and len(rows) == fire_after:
                        trig = 0
                continue
            hook = tracerules.HOOK_PC.get(pc)
            if hook == tracerules.HOOK_PASS and not patched:
                tracerules.apply_scenario(e, scen)
                stick, trig = tracerules.scenario_input(scen, 0)
                patched = True
            elif hook in (tracerules.HOOK_END, tracerules.HOOK_CAVE_END, tracerules.HOOK_AFTER):
                rt = int.from_bytes(e.read(0x12, 3), 'big')
                rows.append({'rt': rt, 'hook': tracerules.HOOK_NAMES[hook]})
                phase = 'end'; trig = 1
            elif hook in (tracerules.HOOK_SETUP, tracerules.HOOK_TITLE):
                return rows
        raise RuntimeError('konec jeskyně nepřišel')
    finally:
        e.close()

def stats(name, values):
    if values:
        print('%-28s n=%3d střed %.3f min %.3f max %.3f' % (name, len(values), statistics.mean(values), min(values), max(values)))

def main():
    t0 = time.time()
    # --- bonus za čas: A/1, východ hned vedle vchodu, 150 s ---------------------
    rows = run(1, 0, {'kind': 'exit'})
    hooks = {r['hook']: r['rt'] for r in rows if 'hook' in r}
    frames = [r for r in rows if 'hook' not in r]
    end = hooks['end']
    # snímky, ve kterých $0879 poskočil: rozestupy = délka iterace
    bonus = [(r['rt'], r['bonus']) for r in frames]
    incs = [rt2 for (rt, b), (rt2, b2) in zip(bonus, bonus[1:]) if b2 != b]
    gaps = [b - a for a, b in zip(incs, incs[1:])]
    n = max(r['bonus'] for r in frames)
    first_over = next(r['rt'] for r in frames if r['over'])
    print('bonus: %d iterací, od konce jeskyně (rt %d) po cave_over rt %d = %d snímků → %.4f snímku na iteraci (%.1f řádků)' % (
        n, end, first_over, first_over - end, (first_over - end) / n, 312 * (first_over - end) / n))
    print('rozestupy skoků $0879:', ''.join(str(g) for g in gaps[:80]))
    cave_end = hooks['caveEnd']
    print('L1C55 po bonusu (cave_over → háček cave_end, včetně $1598 bez flickeru): %d snímků' % (cave_end - first_over))
    cover_on = next(r['rt'] for r in frames if r['cover'])
    after = hooks['after']
    rounds = [(r['rt'], r['round']) for r in frames if r['cover'] and r['rt'] < after]
    print('zakrývání: cover=1 od rt %d (háček cave_end %d), háček after rt %d → %d snímků; kolo $0790 po snímcích: %s' % (
        cover_on, cave_end, after, after - cover_on, ' '.join(str(b) for a, b in rounds)))
    # --- OUT OF TIME: A/1, čas 3 s, bez fire tři bliknutí, pak fire -------------
    rows = run(1, 0, {'kind': 'timeout', 'time': 3}, fire_after=900)
    hooks = {r['hook']: r['rt'] for r in rows if 'hook' in r}
    frames = [r for r in rows if 'hook' not in r]
    end = hooks['end']
    toggles = [r['rt'] for r, q in zip(frames, frames[1:]) if r['lms'] != q['lms']]
    print('OUT OF TIME: konec rt %d, LMS se přepíná na rt %s → rozestupy %s; háček cave_end rt %d, after rt %d' % (
        end, [t - end for t in toggles[:12]], [b - a for a, b in zip(toggles, toggles[1:])][:12], hooks['caveEnd'] - end, hooks['after'] - end))
    cover_on = next(r['rt'] for r in frames if r['cover'])
    print('zakrývání po smrti: cover=1 rt %d → after rt %d = %d snímků' % (cover_on, hooks['after'], hooks['after'] - cover_on))
    # --- GAME OVER: A/1 třikrát smrt --------------------------------------------
    print('%.0f s' % (time.time() - t0))

if __name__ == '__main__':
    main()
