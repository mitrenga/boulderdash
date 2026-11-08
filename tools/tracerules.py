#!/usr/bin/env python3
"""tracerules — záznam **celé hry** z běžícího originálu: co se děje po konci
jeskyně (M5) — bonus za čas, ztráta života, další jeskyně, mezihry, dva
hráči, OUT OF TIME, GAME OVER, titulka — a demo.

    ./tools/tracerules.py --cave 1 --level 1 --plan exit:t20,die,die,die --name G1
    ./tools/tracerules.py --cave 4 --level 1 --plan exit:t30,exit:t10,die,die,die,die --name G2   # D → X1 (BONUS LIFE) → E
    ./tools/tracerules.py --cave 1 --level 1 --players 2 --joysticks 1 --plan die,die,exit:t15,die,die,die,die --name P2
    ./tools/tracerules.py --cave 1 --level 1 --plan timeout:t5:f400,die,die,die --name T1        # OUT OF TIME, fire po 400 snímcích
    ./tools/tracerules.py --demo --name demo                                                     # titulka → demo → titulka
    ./tools/tracerules.py --demo --demo-fire 100                                                 # demo ukončené tlačítkem po 100 průchodech

Harness je ten z `tracescan.py` (čtení `RANDOM` a vstupů, log snímku ve VBI,
HSCROL/VSCROL), jen **místo spin-hooků jsou háčky `BRK`** — monitor
`atari800` s `BBRK ON` zastaví přesně v háčku, takže se stav čte v okamžiku
události a VBI mezitím netiká (u `tracescan` čekal `$288C` na timeout a čas
běžel dál — `finalVars` tam proto neplatí). Háčky:

- `$2884` / `$28D9` `JSR cave_scan` → průchod (vstup pro průchod se zapíše
  po záznamu; v demu se páčka nezapisuje, bere ji skript `$3BC0`)
- `$288C` konec smyčky průchodů (`cave_over ≠ 0`), `$28E2` konec dema
- `$2915` před `cave_end` (po `cave_end_vars`: bonus / život / další
  jeskyně a čekání na flicker) a `$2918` za ním (OUT OF TIME, GAME OVER,
  BONUS LIFE, zakrytí)
- `$2904` `cave_setup` další jeskyně, `$28F8` titulka (konec záznamu)

Mezi háčky se krokuje po snímcích (breakpoint na výstupu z VBI) a čte se
log snímku (34 polí `tracescan` + skóre, životy, pauza, čítač bonusu
`$0879`, čítač OUT OF TIME `$0866`, `cave_over`, `exit_reached`, tlačítko,
hráč) a obraz `$5000`, když se změnil (zakrývání `$1870`). Stav hry je
**blok `$0780`–`$087F`** (hex): proměnné jeskyně, skóre, uložené bloky obou
hráčů `$07C5`/`$07D4`, nejvyšší skóre `$07BF`, řádky LAST/HIGH titulky
`$07E3`/`$07F7`, stavové řádky `$080B`/`$081F`.

**Plán** = scénář pro každou jeskyni po řadě (`--plan`), záplata na prvním
breakpointu průchodu jako u `tracescan --scenario`:

- `exit[:tN][:sN]` — vedle vchodu zavřený východ a `$078D` = 1 (dost
  diamantů): Rockford po narození vejde → bonus za čas; `tN` = čas jeskyně
  N sekund (`$0836`–`$0838`), `sN` = skóre N (bonusový život při přechodu
  přes 500 uprostřed počítání)
- `die` — vedle vchodu muška v kapse ze zdí: vybuchne na narozeného
  Rockforda; fire držené → po 16 průchodech bez Rockforda konec
- `timeout[:tN][:fN]` — čas i `$0865` = N sekund, páčka v klidu → OUT OF
  TIME; `fN` = fire N snímků po konci jeskyně (bez něj bliká 20×)
- `idle` — nic (jeskyně běží až do vypršení času)
- `magicwall`, `amoebabox` — záplata mřížky a hlavičky z `tracescan.SCENARIOS`
  (jeskyně H / A, páčka v klidu; M6 kvůli zvuku zdi a améby)

Výstup `build/ref/rules/<name>.json.gz` čte `tools/matchrules.mjs`.

M6 (`tracesound.py` nad tímhle harnessem): každá položka nese i `pokey` /
`vbiPokey` (zápisy do POKEY hlavní smyčky / VBI — prázdné bez harnessu
zvuku), průchod `grid` a `hookCounts` (kolik položek přišlo z háčku, zbytek
po 16 snímcích během průchodu), háček titulky `tunePage` (`$4400`) a titulka
se po hře zaznamenává `TITLE_FRAMES` snímků (`titleFrames`, logy `pokey`,
`randoms`, `frames`). Plán `magicwall` / `amoebabox` = záplata z
`tracescan.SCENARIOS` (hlavička v `scenario.header`)."""
import os, sys, json, re, gzip, argparse, time
sys.path.insert(0, os.path.dirname(__file__))
import bdrun, tracescan
from a8emu import STICK_NONE, STICK_UP, STICK_DOWN, STICK_LEFT, STICK_RIGHT

ROOT = bdrun.ROOT
OUT_DIR = os.path.join(ROOT, 'build', 'ref', 'rules')

# ★ log snímku: 34 polí tracescan + 14 pro pravidla (48 ≤ 64 B záznamu)
EXTRA_FIELDS = ['score0', 'score1', 'score2', 'score3', 'score4', 'score5', 'lives', 'paused',
                'bonusCount', 'outOfTimeCount', 'caveOver', 'exitReached', 'trig', 'player']
EXTRA_ADDRS = [0x07B9, 0x07BA, 0x07BB, 0x07BC, 0x07BD, 0x07BE, 0x07B6, 0x07A4,
               0x0879, 0x0866, 0x0795, 0x07A8, 0x0843, 0x07A6]
FRAME_LOG_FIELDS = tracescan.FRAME_LOG_FIELDS + EXTRA_FIELDS
FRAME_LOG_ADDRS = tracescan.FRAME_LOG_ADDRS + EXTRA_ADDRS

BLOCK_BASE, BLOCK_SIZE = 0x0780, 0x0100   # ★ stav hry: $0780–$087F

# ★ háčky BRK: (adresa háčku, patch na místě, původní bajty, kód háčku); id = index
HOOK_PASS, HOOK_END, HOOK_DEMO_END, HOOK_CAVE_END, HOOK_AFTER, HOOK_SETUP, HOOK_TITLE = range(7)
HOOK_NAMES = ['pass', 'end', 'demoEnd', 'caveEnd', 'after', 'setup', 'title']
FLAGS = 0x06C0   # čítače háčků $06C0–$06C6

def hook_code(i, tail):
    """INC $06C0+i; BRK; NOP; tail — BRK s `BBRK ON` zastaví monitor, CONT pokračuje za ním."""
    return bytes([0xEE, (FLAGS + i) & 0xFF, FLAGS >> 8, 0x00, 0xEA]) + tail

HOOKS = [
    # (adresa kódu háčku, [(místo patche, očekávané bajty, nové bajty)], kód)
    (0x6EB0, [(0x2884, b'\x20\x8f\x1d', None), (0x28D9, b'\x20\x8f\x1d', None)], hook_code(HOOK_PASS, bytes([0x4C, 0x8F, 0x1D]))),
    (0x6EC0, [(0x288C, b'\x20\x3d\x1c', None)], hook_code(HOOK_END, bytes([0x4C, 0x3D, 0x1C]))),
    (0x6ED0, [(0x28E2, b'\x20\x3d\x1c', None)], hook_code(HOOK_DEMO_END, bytes([0x4C, 0x3D, 0x1C]))),
    (0x6EE0, [(0x2915, b'\x20\x12\x20', None)], hook_code(HOOK_CAVE_END, bytes([0x4C, 0x12, 0x20]))),
    (0x6EF0, [(0x2918, b'\xa2\x00\xa9\x00', 'jsr+nop')], hook_code(HOOK_AFTER, bytes([0xA2, 0x00, 0xA9, 0x00, 0x60]))),
    (0x6F80, [(0x2904, b'\x20\x45\x26', None)], hook_code(HOOK_SETUP, bytes([0x4C, 0x45, 0x26]))),
    (0x6F90, [(0x28F8, b'\x20\xc3\x25', None)], hook_code(HOOK_TITLE, bytes([0x4C, 0xC3, 0x25]))),
]
HOOK_PC = {addr + 4: i for i, (addr, _, _) in enumerate(HOOKS)}   # PC po zastavení = adresa NOP za BRK

# kolik snímků titulky po konci hry se ještě zaznamená (tracesound.py zvedá kvůli hudbě $23A0)
TITLE_FRAMES = 3

def install(e):
    """Harness tracescan (spin-hooky $2884/$28D9/$288C se hned přepíší) + háčky BRK."""
    tracescan.install(e, FRAME_LOG_ADDRS)
    for addr, sites, code in HOOKS:
        e.write(addr, code)
        for site, expected, kind in sites:
            old = e.read(site, len(expected))
            if site in (0x2884, 0x28D9, 0x288C):
                assert old[0] == 0x20 and old[2] == 0x6E, f'${site:04X}: {old.hex()}'   # spin-hook tracescan
            else:
                assert old == expected, f'${site:04X}: {old.hex()} ≠ {expected.hex()}'
            patch = bytes([0x20, addr & 0xFF, addr >> 8]) + (b'\xea' if kind == 'jsr+nop' else b'')
            e.write(site, patch)
    e.cmd('BBRK ON')

def parse_pc(out):
    m = re.search(r'PC=([0-9A-F]{4})', out)
    return int(m.group(1), 16) if m else -1

def clock(e):
    return tracescan.clock(e)

def read_block(e):
    return e.read(BLOCK_BASE, BLOCK_SIZE).hex()

def full_state(e):
    """Mřížka, obraz, sada B, stavové řádky, display list — jako záznam průchodu tracescan."""
    return {'grid': e.read(0x4C00, 960).hex(), 'screen': e.read(0x5000, 0x0DC0).hex(),
            'charsetB': e.read(0x4400, 0x0400).hex(), 'status': e.read(0x080B, 40).hex(), 'dlist': e.read(0x5EA0, 0x51).hex()}

TILE_BASE = None

def write_cell(e, x, y, code):
    """Buňka mřížky `$4C00` + její dlaždice v obraze (tabulka `$3C40`)."""
    global TILE_BASE
    if TILE_BASE is None:
        TILE_BASE = json.load(open(os.path.join(ROOT, 'data', 'charset.json')))['tiles']['base']
    e.write(0x4C00 + y * 40 + x, [code])
    a = 0x5003 + 160 * (y - 2) + 2 * x
    base = TILE_BASE[code]
    e.write(a, [base, base + 1]); e.write(a + 80, [base + 16, base + 17])

def parse_plan(text):
    """'exit:t20:s490,die,timeout:t5:f300' → [{'kind': 'exit', 'time': 20, 'score': 490}, …]"""
    plan = []
    for item in text.split(','):
        parts = item.split(':')
        d = {'kind': parts[0]}
        for p in parts[1:]:
            d[{'t': 'time', 's': 'score', 'f': 'fire'}[p[0]]] = int(p[1:])
        plan.append(d)
    return plan

def digits(n, count):
    return [int(c) for c in str(n).zfill(count)[-count:]]

def apply_scenario(e, scen):
    """Záplata na prvním breakpointu průchodu (po plném nakreslení, před
    prvním průchodem): vrátí, co se změnilo, aby to matchrules provedl stejně."""
    grid = e.read(0x4C00, 960)
    rx, ry = e.peek(0x079E), e.peek(0x079F)
    patch, vars_ = [], {}
    kind = scen['kind']
    if kind in tracescan.SCENARIOS:
        # záplata mřížky a hlavičky z tracescan (kouzelná zeď, uzavřená améba), páčka v klidu
        sc = tracescan.SCENARIOS[kind]
        for x, y, code in sc['patch']:
            write_cell(e, x, y, code)
        for off, value in sc['header'].items():
            e.write(0x5F00 + off, [value])                                  # ★ hlavička jeskyně v RAM
        scen['header'] = {str(k): v for k, v in sc['header'].items()}
        return [list(p) for p in sc['patch']], {}
    if kind in ('exit', 'die'):
        # směr, kde je vedle vchodu místo (ne ocel 07): vpravo, vlevo, dolů, nahoru
        inside = lambda x, y: 1 <= x <= 38 and 3 <= y <= 22 and grid[y * 40 + x] != 0x07
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if inside(rx + dx, ry + dy):
                break
        else:
            raise RuntimeError('scénář %s: vedle vchodu (%d,%d) není místo' % (kind, rx, ry))
        if kind == 'exit':
            patch.append((rx + dx, ry + dy, 0x04))
            vars_[0x078D] = 1
        else:
            # kapsa: muška (směr 0) a kolem ní zdi tam, kde není ocel — nemá kam jít, otáčí se na místě
            patch.append((rx + dx, ry + dy, 0x08))
            for x, y in ((rx + 2 * dx, ry + 2 * dy), (rx + dx + dy, ry + dy + dx), (rx + dx - dy, ry + dy - dx)):
                if inside(x, y):
                    patch.append((x, y, 0x02))
        scen['dir'] = {(1, 0): STICK_RIGHT, (-1, 0): STICK_LEFT, (0, 1): STICK_DOWN, (0, -1): STICK_UP}[(dx, dy)]
    if 'time' in scen:
        t = digits(scen['time'], 3)
        vars_[0x0836], vars_[0x0837], vars_[0x0838] = t
        vars_[0x0815], vars_[0x0816], vars_[0x0817] = [d + 0x90 for d in t]   # ★ $10E7: stavový řádek
        if kind == 'timeout':
            vars_[0x0865] = scen['time']                                       # ★ $2015: OUT OF TIME jen při seconds_gone == čas hlavičky
    if 'score' in scen:
        sc = digits(scen['score'], 6)
        for i, d in enumerate(sc):
            vars_[0x07B9 + i] = d
            vars_[0x0819 + i] = d + 0x90                                       # ★ $107C
    for x, y, code in patch:
        write_cell(e, x, y, code)
    for a, v in vars_.items():
        e.write(a, [v])
    return [list(p) for p in patch], {'%04X' % a: v for a, v in vars_.items()}

def scenario_input(scen, k):
    """Vstup (páčka, tlačítko) pro průchod k podle scénáře."""
    kind = scen['kind']
    if kind == 'exit':
        return scen['dir'], 1
    if kind == 'die':
        return STICK_NONE, 0
    return STICK_NONE, 1

def wait_for_demo(e, max_frames=4000):
    """Titulka bez vstupu, dokud hra sama nespustí demo ($2645 s $07AB = 1)."""
    e.cmd('BPC 2645')
    for i in range(max_frames):
        e.write(0x0278, [STICK_NONE]); e.write(0x0284, [1])
        out = e.cmd('CONT')
        if parse_pc(out) == 0x2645:
            return i
    raise RuntimeError('demo nezačalo')

def one_game(a):
    e = bdrun.start()
    try:
        return one_game_inner(e, a)
    finally:
        e.close()

def one_game_inner(e, a):
    rec = {'name': a.name, 'players': a.players, 'joysticks': a.joysticks, 'demo': a.demo, 'plan': a.plan, 'caves': []}
    if a.demo:
        # ★ titulka → (bez START a bez fire) demo: hudba $23A0 dvakrát dokola ($0874 == 2) → $0875 → menu_start s $07AB = 1
        rec['menuFrames'] = clock(e)['rtclok']
        rec['demoFrames'] = wait_for_demo(e)
        assert e.peek(bdrun.DEMO_FLAG) == 1, 'demo bez $07AB'
    else:
        bdrun.to_menu(e)
        if not bdrun.cave_setup(e, a.cave, a.level - 1):
            raise RuntimeError('breakpoint $2645 nechycen')
        if e.peek(bdrun.DEMO_FLAG):
            raise RuntimeError('jeskyně startuje v demu ($07AB = 1) — pozdní START')
        if a.players == 2:
            # ★ menu $244A (OPTION): $07A7 = 2 hráči, $07AD = 2 joysticky; new_game $2680 už zkopírovalo
            # bloky obou hráčů ($07C5, $07D4) — jeskyně a úroveň v nich musí být ty podstrčené
            e.write(0x07A7, [1]); e.write(0x07AD, [a.joysticks - 1])
            e.write(0x07C6, [a.cave, a.level - 1]); e.write(0x07D5, [a.cave, a.level - 1])
    install(e)
    rec['setupBlock'] = read_block(e)
    plan = parse_plan(a.plan) if a.plan else []
    xitvbv = int.from_bytes(e.read(0x0224, 2), 'little')
    e.cmd('BPC %04X' % xitvbv)
    cave = None
    phase = 'uncover'
    frame_in_phase = 0
    last_screen = None
    scen = None
    t0 = time.time()

    def new_cave():
        nonlocal cave, phase, frame_in_phase, last_screen, scen
        cave = {'setup': clock(e), 'setupBlock': read_block(e), 'uncover': [], 'passes': [], 'end': None, 'endFrames': [], 'hooks': []}
        rec['caves'].append(cave)
        index = len(rec['caves']) - 1
        scen = dict(plan[index]) if index < len(plan) else {'kind': 'die'}
        if a.demo:
            scen = {'kind': 'demo'}
        cave['scenario'] = scen
        phase = 'uncover'; frame_in_phase = 0; last_screen = None
        tracescan.reset_logs(e)

    new_cave()
    passes_total = 0
    while True:
        out = e.cmd('CONT')
        if e.timed_out:
            raise RuntimeError('timeout: PC=%04X' % parse_pc(out))
        pc = parse_pc(out)
        if pc == xitvbv:
            frame_in_phase += 1
            if phase == 'uncover':
                randoms, vrandoms, frames = tracescan.read_logs(e)
                pokey, vpokey = tracescan.read_pokey(e)
                cave['uncover'].append({'clock': clock(e), 'screen': e.read(0x5000, 0x0DC0).hex(), 'randoms': randoms, 'vbiRandoms': vrandoms, 'frames': frames,
                                        'pokey': pokey, 'vbiPokey': vpokey, 'hscrol': e.peek(0x0674), 'vscrol': e.peek(0x0675)})
                if len(cave['uncover']) > 600:
                    raise RuntimeError('odkrývání nekončí')
            elif phase == 'end':
                randoms, vrandoms, frames = tracescan.read_logs(e)
                pokey, vpokey = tracescan.read_pokey(e)
                screen = e.read(0x5000, 0x0DC0).hex()
                entry = {'clock': clock(e), 'randoms': randoms, 'vbiRandoms': vrandoms, 'frames': frames, 'pokey': pokey, 'vbiPokey': vpokey, 'lms': e.read(0x5EA4, 2).hex()}
                if screen != last_screen:
                    entry['screen'] = screen; last_screen = screen
                cave['endFrames'].append(entry)
                if 'fire' in scen and frame_in_phase == scen['fire']:
                    e.write(0x0672, [0, 0])                       # ★ STRIG0/1 stisknuté (wait_trig $1F75)
                    entry['fire'] = True
                if len(cave['endFrames']) > 12000:
                    raise RuntimeError('konec jeskyně nekončí')
            elif phase == 'title':
                # ★ titulka: hudba $23A0 ve VBI — zápisy do POKEY s razítkem snímku (tracesound.py)
                if frame_in_phase % 16 == 0 or frame_in_phase >= TITLE_FRAMES:
                    pokey, vpokey = tracescan.read_pokey(e)
                    randoms, vrandoms, frames = tracescan.read_logs(e)
                    rec['title']['pokey'] += pokey; rec['title']['vbiPokey'] += vpokey
                    rec['title']['randoms'] += randoms; rec['title']['vbiRandoms'] += vrandoms; rec['title']['frames'] += frames
                if frame_in_phase >= TITLE_FRAMES:
                    rec['title']['titleFrames'] = frame_in_phase
                    break
            elif frame_in_phase % 16 == 0:
                randoms, vrandoms, frames = tracescan.read_logs(e)
                pokey, vpokey = tracescan.read_pokey(e)
                cave['passes'][-1]['randoms'] += randoms; cave['passes'][-1]['vbiRandoms'] += vrandoms; cave['passes'][-1]['frames'] += frames
                cave['passes'][-1]['pokey'] += pokey; cave['passes'][-1]['vbiPokey'] += vpokey
            continue
        hook = HOOK_PC.get(pc)
        if hook is None:
            raise RuntimeError('zastaveno mimo háček: PC=%04X (%s)' % (pc, out.strip()))
        if hook == HOOK_PASS:
            k = len(cave['passes'])
            randoms, vrandoms, frames = tracescan.read_logs(e)
            pokey, vpokey = tracescan.read_pokey(e)
            p = {'clock': clock(e), 'block': read_block(e), 'randoms': randoms, 'vbiRandoms': vrandoms, 'frames': frames, 'pokey': pokey, 'vbiPokey': vpokey,
                 'grid': e.read(0x4C00, 960).hex(),
                 # kolik položek přišlo z tohoto háčku (= konec průchodu k−1); zbytek přibude po 16 snímcích během průchodu k (matchsound)
                 'hookCounts': {'randoms': len(randoms), 'vbiRandoms': len(vrandoms), 'frames': len(frames), 'pokey': len(pokey), 'vbiPokey': len(vpokey)}}
            if k == 0:
                p.update(full_state(e))
                patch, vars_ = apply_scenario(e, scen)
                cave['patch'] = patch; cave['patchVars'] = vars_
            stick, trig = scenario_input(scen, k)
            p['input'] = [stick, trig]
            cave['passes'].append(p)
            if not a.demo:
                e.write(0x0670, [stick, stick, trig, trig])
            else:
                # ★ $28CA: STRIG0 ukončí demo (--demo-fire N = od průchodu N stisknuté)
                e.write(0x0672, [0, 0] if (a.demo_fire and k >= a.demo_fire) else [1, 1])
            phase = 'pass'; frame_in_phase = 0
            passes_total += 1
            if k > 6000:
                raise RuntimeError('jeskyně nekončí')
            continue
        randoms, vrandoms, frames = tracescan.read_logs(e)
        pokey, vpokey = tracescan.read_pokey(e)
        snap = {'hook': HOOK_NAMES[hook], 'clock': clock(e), 'block': read_block(e), 'randoms': randoms, 'vbiRandoms': vrandoms, 'frames': frames,
                'pokey': pokey, 'vbiPokey': vpokey, 'lms': e.read(0x5EA4, 2).hex(), 'flags': list(e.read(FLAGS, 8))}
        if hook in (HOOK_END, HOOK_DEMO_END):
            snap.update(full_state(e))
            cave['end'] = snap
            phase = 'end'; frame_in_phase = 0; last_screen = snap['screen']
            e.write(0x0672, [1, 1])
        elif hook == HOOK_CAVE_END:
            snap['status'] = e.read(0x080B, 40).hex()
            cave['hooks'].append(snap)
        elif hook == HOOK_AFTER:
            snap['screen'] = e.read(0x5000, 0x0DC0).hex()
            snap['titleRows'] = e.read(0x07E3, 40).hex()
            cave['hooks'].append(snap)
        elif hook == HOOK_SETUP:
            cave['hooks'].append(snap)
            new_cave()
            cave['setup'] = snap['clock']
        elif hook == HOOK_TITLE:
            snap['titleRows'] = e.read(0x07E3, 40).hex()
            snap['tunePage'] = e.read(0x4400, 0x100).hex()   # ★ $23A0: noty titulky jsou bajty $4400–$44FF (sada B, jak ji hra nechala)
            cave['hooks'].append(snap)
            rec['title'] = snap
            phase = 'title'; frame_in_phase = 0
        print('  %s: jeskyně %d %s %s, průchodů %d, %.0f s' % (a.name, len(rec['caves']), scen['kind'], HOOK_NAMES[hook], len(cave['passes']), time.time() - t0), flush=True)
        if len(rec['caves']) > 40:
            raise RuntimeError('hra nekončí')
    rec['passes'] = passes_total
    return rec

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cave', type=int, default=1); ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--players', type=int, default=1); ap.add_argument('--joysticks', type=int, default=1)
    ap.add_argument('--plan', default='die,die,die'); ap.add_argument('--demo', action='store_true')
    ap.add_argument('--demo-fire', type=int, default=0, help='v demu stisknout fire od N-tého průchodu (konec dema bez východu)')
    ap.add_argument('--name', default='')
    a = ap.parse_args()
    if not a.name:
        a.name = ('demo-fire%d' % a.demo_fire if a.demo_fire else 'demo') if a.demo else '%s%d-%s%s' % (tracescan.cave_name(a.cave), a.level, a.plan.replace(':', '').replace(',', '-'), '-p%dj%d' % (a.players, a.joysticks) if a.players == 2 else '')
    os.makedirs(OUT_DIR, exist_ok=True)
    t = time.time()
    rec = None
    for attempt in range(3):
        try:
            rec = one_game(a)
            break
        except (RuntimeError, AssertionError, OSError) as err:
            print('  pokus %d: %s' % (attempt + 1, err), flush=True)
    if rec is None:
        sys.exit(1)
    path = os.path.join(OUT_DIR, a.name + '.json.gz')
    with gzip.open(path, 'wt') as f:
        json.dump(rec, f)
    print('%s: %d jeskyní, %d průchodů, %.0f s → %s' % (a.name, len(rec['caves']), rec['passes'], time.time() - t, path))

if __name__ == '__main__':
    main()
