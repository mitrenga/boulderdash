#!/usr/bin/env python3
"""tracesound — záznam **zápisů do POKEY** z běžícího originálu (M6): celá hra
jako `tracerules.py` (odkrývání, průchody, konec jeskyně, titulka, demo)
a k tomu každý zápis do `$D200`–`$D208` s razítkem snímku a řádku.

    ./tools/tracesound.py --cave 1 --level 1 --plan exit:t20,die,die,die --name S-A1
    ./tools/tracesound.py --cave 4 --level 1 --plan idle --name S-D1-idle      # améba, kouzelná zeď
    ./tools/tracesound.py --demo --name S-demo                                 # titulka od zapnutí → demo → titulka
    ./tools/tracesound.py --demo --title-frames 300                            # kratší titulka po hře

Harness je `tracerules.py` (háčky `BRK`, log snímku, náhoda, vstupy) plus
**stub na každém z 31 míst `STA $D2xx`** (★ `sources/asm/main.asm`: 28
zvukových a 3 v initu titulky `$2608`): tříbajtové `STA abs` se přepíše na
`JSR stub`, stub zápis provede a zaloguje (registr, hodnota, `RTCLOK`,
`VCOUNT`) do kruhového logu — jednoho pro hlavní smyčku, druhého pro VBI
(NMI přeruší jádro hlavní smyčky uprostřed, jako u `RANDOM`). Stub vrací
A, X, Y i příznaky beze změny; stojí ~90 cyklů, tj. u průchodu se 40
zápisy 0,1 snímku — kadenci řídí u `matchsound` záznam, ne hodiny.
`SKCTL` (`$1F4B`, `$2620`) se neloguje: 3 = normální běh, zvuk nemění.

Co se navíc zaznamená (`tracerules` pole `pokey` / `vbiPokey` v každé
položce): u `--demo` **titulka od zapnutí** (`bootTitle`: snímky po 16,
stránka not `$4400`), po konci hry **`--title-frames` snímků titulky**
(hudba `$23A0` s `AUDCTL = $78`: spojené 16bit kanály na 1,79 MHz), u
každého průchodu **mřížka** `$4C00` (aby `matchsound` poznal, kde se
rozešel průchod a kde zvuk).

Výstup `build/ref/sound/<name>.json.gz` čte `tools/matchsound.mjs`."""
import os, sys, json, gzip, argparse, time
sys.path.insert(0, os.path.dirname(__file__))
import bdrun, tracescan, tracerules
from a8emu import STICK_NONE

ROOT = bdrun.ROOT
OUT_DIR = os.path.join(ROOT, 'build', 'ref', 'sound')

# ★ místa STA $D2xx: (adresa, registr 0–8 nebo 'x' pro STA AUDF1,X, 'main' / 'vbi')
SITES = [
    (0x0FB4, 5, 'main'), (0x0FBA, 4, 'main'),                    # amoeba_sound $0FAD: AUDC3 = $A6, AUDF3 = RANDOM
    (0x121D, 2, 'main'), (0x122D, 2, 'main'),                    # dig_sound / walk_sound: AUDF2 = $4B / $CC
    (0x1391, 3, 'main'),                                         # sound_env2 $1385: AUDC2 = obálka $0799
    (0x1C41, 'x', 'main'),                                       # silence $1C3D: AUDF1..AUDCTL = 0
    (0x1D1E, 5, 'main'),                                         # scan_amoeba_flags $1D0F: AUDC3 = 0
    (0x1F59, 2, 'main'), (0x1F5E, 3, 'main'),                    # L1F57 (cave_setup): AUDF2 = $4B, AUDC2 = 0
    (0x2610, 1, 'main'), (0x2613, 5, 'main'), (0x2625, 8, 'main'),   # titulka $2608: AUDC1 = AUDC3 = 0, AUDCTL = $78
    (0x2748, 7, 'main'), (0x2752, 6, 'main'), (0x275F, 7, 'main'),   # bonus $2746: AUDC4 = $AA, 15× AUDF4, AUDC4 = 0
    (0x1933, 5, 'vbi'), (0x193B, 4, 'vbi'),                      # cover_rotate $192C: AUDC3 = $AA, AUDF3 = RANDOM & $0F
    (0x1ACC, 0, 'vbi'), (0x1ADA, 1, 'vbi'), (0x1AE3, 6, 'vbi'), (0x1AF1, 7, 'vbi'),   # obálky $1ABF každý 8. snímek
    (0x1B14, 5, 'vbi'), (0x1B1F, 4, 'vbi'),                      # magic_wall_glyph $1B12: AUDC3 = $A6, AUDF3 = (RANDOM & 7) + $0A
    (0x1B56, 5, 'vbi'),                                          # magic_wall_step $1B54: AUDC3 = 0 (zeď vyhasla)
    (0x23B8, 0, 'vbi'), (0x23BE, 2, 'vbi'), (0x23C9, 4, 'vbi'), (0x23CF, 6, 'vbi'), (0x23E0, 7, 'vbi'), (0x23EA, 3, 'vbi'),   # hudba titulky $23A0
]
STUB_BASE = 0xB000        # 31 stubů × 13 B po 16 = $B000–$B1EF
CORE_MAIN, CORE_VBI = 0xB200, 0xB280   # 66 B každé
SAVE_MAIN, SAVE_VBI = 0xB2F0, 0xB2F4
PTR_MAIN, PTR_VBI = 0xC9, 0xD2   # ★ nultá stránka, kterou hra ani OS nepoužívá (jako $CB–$D1 tracescan)
RING_MAIN, RING_VBI = (0xB3, 0xB9), (0xBA, 0xBF)   # 448 / 384 záznamů; čte se nejméně každých 16 snímků

def stub(site, reg, core):
    sta = bytes([0x9D, 0x00, 0xD2]) if reg == 'x' else bytes([0x8D, reg, 0xD2])
    return sta + bytes([0x08, 0x48, 0xA9, 0xFF if reg == 'x' else reg, 0x20, core & 0xFF, core >> 8, 0x68, 0x28, 0x60])

def core(ptr, save, ring):
    """Jádro logu: A = registr ($FF = X), hodnota je na zásobníku (PHA stubu);
    záznam (registr, hodnota, RTCLOK, VCOUNT) na (ptr), ukazatel +4 v kruhu."""
    first, last = ring
    lo, hi = save & 0xFF, save >> 8
    return bytes([0x8C, lo, hi,                      # STY save
                  0x8E, lo + 1, hi,                  # STX save+1
                  0x8D, lo + 2, hi,                  # STA save+2   registr
                  0xBA, 0xBD, 0x03, 0x01,            # TSX; LDA $0103,X   hodnota (PHA stubu)
                  0xA0, 0x00, 0x48,                  # LDY #0; PHA
                  0xAD, lo + 2, hi,                  # LDA save+2
                  0xC9, 0xFF, 0xD0, 0x03,            # CMP #$FF; BNE +3
                  0xAD, lo + 1, hi,                  # LDA save+1   (X = registr u STA AUDF1,X)
                  0x91, ptr, 0xC8,                   # STA (ptr),Y; INY
                  0x68, 0x91, ptr, 0xC8,             # PLA; STA (ptr),Y; INY   hodnota
                  0xA5, 0x14, 0x91, ptr, 0xC8,       # LDA RTCLOK+2; STA (ptr),Y; INY
                  0xAD, 0x0B, 0xD4, 0x91, ptr,       # LDA VCOUNT; STA (ptr),Y
                  0xA5, ptr, 0x18, 0x69, 0x04, 0x85, ptr,   # ptr += 4
                  0x90, 0x0C,                        # BCC done
                  0xE6, ptr + 1, 0xA5, ptr + 1, 0xC9, last + 1, 0xD0, 0x02, 0xA9, first, 0x85, ptr + 1,   # kruh
                  0xAC, lo, hi, 0xAE, lo + 1, hi,    # LDY save; LDX save+1
                  0x60])

def write_block(e, addr, data):
    """Monitor bere v `C` jen pár desítek bajtů na řádek — po 32 jako tracescan."""
    for i in range(0, len(data), 32):
        e.write(addr + i, data[i:i+32])

def install_sound(e):
    """Stuby, jádra, kruhy a patche; kontroluje původní bajty na každém místě."""
    write_block(e, CORE_MAIN, core(PTR_MAIN, SAVE_MAIN, RING_MAIN))
    write_block(e, CORE_VBI, core(PTR_VBI, SAVE_VBI, RING_VBI))
    for i, (site, reg, where) in enumerate(SITES):
        expected = bytes([0x9D, 0x00, 0xD2]) if reg == 'x' else bytes([0x8D, reg, 0xD2])
        old = e.read(site, 3)
        assert old == expected, f'${site:04X}: {old.hex()} ≠ {expected.hex()}'
        addr = STUB_BASE + 16 * i
        e.write(addr, stub(site, reg, CORE_MAIN if where == 'main' else CORE_VBI))
        e.write(site, bytes([0x20, addr & 0xFF, addr >> 8]))
    tracescan.RINGS[PTR_MAIN] = RING_MAIN
    tracescan.RINGS[PTR_VBI] = RING_VBI
    e.soundRings = (PTR_MAIN, PTR_VBI)
    reset_sound_logs(e)

def reset_sound_logs(e):
    if getattr(e, 'soundRings', None):
        if not hasattr(e, "logPos"):
            e.logPos = {}
        e.write(PTR_MAIN, [0x00, RING_MAIN[0]]); e.write(PTR_VBI, [0x00, RING_VBI[0]])
        e.logPos[PTR_MAIN] = RING_MAIN[0] << 8; e.logPos[PTR_VBI] = RING_VBI[0] << 8

# ★ log snímku (VBI): k 48 polím tracerules ještě proměnné zvuku, jak je VBI viděla — kanál 1 (a, b, c),
# kanál 4 (d, e, f) a obálka kanálu 2; matchsound podle nich pozná, jestli VBI uvnitř obsluhy buňky
# přišla před zápisem proměnné, nebo za ním (a půlí hlasitost o krok dřív)
SOUND_FIELDS = ['soundA', 'soundB', 'soundC', 'soundD', 'soundE', 'soundF', 'sound2']
SOUND_ADDRS = [0x0796, 0x0797, 0x0798, 0x079A, 0x079B, 0x079C, 0x0799]
if 'soundA' not in tracerules.FRAME_LOG_FIELDS:
    tracerules.FRAME_LOG_FIELDS = tracerules.FRAME_LOG_FIELDS + SOUND_FIELDS
    tracerules.FRAME_LOG_ADDRS = tracerules.FRAME_LOG_ADDRS + SOUND_ADDRS

# --- napojení na tracerules: harness zvuku k jeho harnessu, kruhy zvuku k jeho nulování ---
_reset_logs = tracescan.reset_logs
def reset_logs(e):
    _reset_logs(e)
    reset_sound_logs(e)
tracescan.reset_logs = reset_logs

_install = tracerules.install
def install(e):
    if not getattr(e, 'soundRings', None):
        install_sound(e)
    _install(e)
tracerules.install = install

def wait_for_demo(e, max_frames=4000):
    """★ Titulka od zapnutí bez vstupu, dokud hudba nespustí demo: po snímcích
    s harnessem zvuku, zápisy do POKEY každý snímek do `e.bootTitle` (kruh by
    při jednom dlouhém `CONT` přetekl). Hudba nastaví `$0875` ve VBI a hlavní
    smyčka projde `menu_start` → `$2578` (režim jeskyně) → `new_game` →
    `cave_setup $2645` ještě v témže snímku, takže se čeká na **režim
    jeskyně `$0876` = 0** na zastavení VBI — jeskyně je pak snímek za
    `$2645` (`tracerules` se zastavuje přesně na něm; generování trvá ~11
    snímků, takže první průchod je daleko)."""
    install_sound(e)
    boot = {'rtclok': tracerules.clock(e)['rtclok'], 'tunePage': e.read(0x4400, 0x100).hex(), 'pokey': [], 'vbiPokey': [], 'frames': 0}
    e.bootTitle = boot
    xitvbv = int.from_bytes(e.read(0x0224, 2), 'little')
    e.cmd('BPC %04X' % xitvbv)
    for i in range(1, max_frames + 1):
        e.write(0x0278, [STICK_NONE]); e.write(0x0284, [1])
        out = e.cmd('CONT')
        if tracerules.parse_pc(out) != xitvbv:
            raise RuntimeError('titulka: zastaveno mimo VBI: %s' % out.strip())
        pokey, vpokey = tracescan.read_pokey(e)
        boot['pokey'] += pokey; boot['vbiPokey'] += vpokey
        if e.peek(0x0876) == 0:
            boot['frames'] = i
            return i
    raise RuntimeError('demo nezačalo')
tracerules.wait_for_demo = wait_for_demo

def one_game(a):
    e = bdrun.start()
    try:
        rec = tracerules.one_game_inner(e, a)
        if getattr(e, 'bootTitle', None):
            rec['bootTitle'] = e.bootTitle
        rec['sound'] = True
        return rec
    finally:
        e.close()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cave', type=int, default=1); ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--players', type=int, default=1); ap.add_argument('--joysticks', type=int, default=1)
    ap.add_argument('--plan', default='die,die,die'); ap.add_argument('--demo', action='store_true')
    ap.add_argument('--demo-fire', type=int, default=0)
    ap.add_argument('--title-frames', type=int, default=1100, help='snímky titulky po konci hry (hudba; demo by začalo po ~1224)')
    ap.add_argument('--name', default='')
    a = ap.parse_args()
    if not a.name:
        a.name = 'S-' + (('demo-fire%d' % a.demo_fire if a.demo_fire else 'demo') if a.demo else '%s%d-%s%s' % (tracescan.cave_name(a.cave), a.level, a.plan.replace(':', '').replace(',', '-'), '-p%dj%d' % (a.players, a.joysticks) if a.players == 2 else ''))
    tracerules.TITLE_FRAMES = a.title_frames
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
    writes = sum(len(x['pokey']) + len(x['vbiPokey']) for c in rec['caves'] for x in c['uncover'] + c['passes'] + c['endFrames'] + c['hooks'])
    print('%s: %d jeskyní, %d průchodů, %d zápisů do POKEY, %.0f s → %s' % (a.name, len(rec['caves']), rec['passes'], writes, time.time() - t, path))

if __name__ == '__main__':
    main()
