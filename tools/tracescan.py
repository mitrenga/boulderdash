#!/usr/bin/env python3
"""tracescan — zlatý záznam průchodu jeskyní z běžícího originálu, průchod po
průchodu (M3).

    ./tools/tracescan.py [--caves 1,2,3,4] [--levels 1] [--passes 1500] [--jobs 4] [--seed 1]
    ./tools/tracescan.py --caves 1 --levels 1 --script demo      # vstupy z dema $3BC0
    ./tools/tracescan.py --caves 5,7 --levels 1,5 --script idle   # páčka v klidu, bez fire: až do vypršení času (M4)
    ./tools/tracescan.py --scenario magicwall,amoebabox           # záplaty mřížky před prvním průchodem (M4)

★ Průchod mřížkou `$1D8F` běží v **hlavní smyčce** (ne ve VBI) a trvá několik
snímků (CPU brzdí DMA ANTICu + zpožďovací smyčka `$1C2F` podle obtížnosti),
takže se nedá zastavit „na snímek". Nástroj proto do paměti originálu
nasadí malý **harness v 6502** (page 6 + `$6D00`–`$6EFF`, volná RAM):

- každé `LDA RANDOM` (14 míst) → `JSR` stub, který zapíše (místo, hodnotu)
  do logu a vrátí hodnotu s týmiž příznaky; **dva logy** — místa čtená
  z hlavní smyčky (`$8000`–`$9FFF`) a z VBI (`$A000`–`$AFFF`), protože VBI
  je NMI a háček hlavní smyčky přeruší uprostřed; záznam = (místo, hodnota,
  RTCLOK, 0), logy jsou kruhové a nástroj je jen čte (`read_ring`)
- odložená VBI (`JSR $1BB0` v `$263F`) → háček, který po kroku hry zapíše
  34 B stavu (`FRAME_LOG_FIELDS`) (RTCLOK, scroll `$0845`–`$084A`,
  HSCROL/VSCROL, Rockford, fáze animace, páčka, odpočet narození, blikání
  pozadí, LMS prvního řádku, **poloha skenu `$0790`/`$0791`** — u které
  buňky průchodu VBI přišla, M4) do kruhového logu snímků na `$7000`–`$7FFF`
- `STA HSCROL/VSCROL` → stub, který hodnotu i uloží (registry nejdou číst)
- čtení `STICK0/1`, `STRIG0/1` (jen stíny OS) → čtení z `$0670`–`$0673`,
  které OS nepřepisuje — vstupy tak platí přesně po průchodech
- `JSR cave_scan` (`$2884`, `$28D9`) → spin-hook: hlavní smyčka čeká,
  dokud nástroj neuvolní `$0676`; VBI běží dál. Tím se přejde z krokování
  po snímcích (fáze 0: odkrývání `$18D8`, 77 snímků) na breakpoint `$1D8F`
- `$288C` (za smyčkou průchodů, jeskyně skončila) → spin-hook s `$0679`

Konec jeskyně a to, co následuje (bonus, životy, další jeskyně, dva hráči,
demo), zaznamenává **`tools/tracerules.py`** (M5) týmž harnessem, ale
s háčky `BRK` místo spin-hooků — monitor zastaví přesně v háčku.

Průchod: titulka → menu → `bdrun.cave_setup` (jeskyně, obtížnost) →
breakpoint `$2645` → harness → fáze 0 po snímcích (obraz `$5000` každý
snímek) → od prvního `$1D8F` po průchodech: mřížka `$4C00`, obraz, sada B
`$4400`, proměnné, stavové řádky, log snímků a náhody od minulého
breakpointu, RTCLOK + ypos (řádek paprsku) při vstupu.

Výstup `build/ref/scan/<jeskyně><úroveň>[-skript].json.gz` (jeskyně A–P,
mezihry X1–X4) čte `tools/matchscan.mjs`."""
import os, sys, json, re, gzip, argparse, time, random
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
import bdrun
from a8emu import STICK_NONE, STICK_UP, STICK_DOWN, STICK_LEFT, STICK_RIGHT

ROOT = bdrun.ROOT
OUT_DIR = os.path.join(ROOT, 'build', 'ref', 'scan')

# ★ všech 14 čtení RANDOM (AD 0A D2) v programu za běhu
RANDOM_SITES = [0x0D88, 0x0FB7, 0x1018, 0x124A, 0x15AD, 0x15B3, 0x15B9, 0x15BF,
                0x1886, 0x18E5, 0x1936, 0x19D9, 0x19E5, 0x1B17]
# ★ čtení stínů OS: STICK0 $1374 (Rockford), $1D80 (ATRACT); STICK1 $136E; STRIG0 $1243, $1F94, $28CA; STRIG1 $123D, $1F8E
INPUT_SITES = {0x1374: 0x0670, 0x1D80: 0x0670, 0x136E: 0x0671, 0x1243: 0x0672, 0x1F94: 0x0672, 0x28CA: 0x0672, 0x123D: 0x0673, 0x1F8E: 0x0673}
FRAME_LOG_FIELDS = ['rtclok', 'tick', 'scrollXLo', 'scrollX', 'scrollYLo', 'scrollY', 'hscrol', 'vscrol',
                    'rockfordX', 'rockfordY', 'animPhase', 'stick', 'birth', 'flash', 'lms0Lo', 'lms0Hi',
                    'facing', 'magicWall', 'flicker', 'cover', 'animBlink', 'animTap', 'statusLmsLo', 'color4',
                    'beforeBirth', 'time0', 'time1', 'time2', 'magicWallSec', 'magicWallTime', 'animToggle', 'amoebaMask',
                    'scanX', 'scanY']   # ★ $0790 / $0791: u které buňky průchodu VBI přišla (M4)
FRAME_LOG_ADDRS = [0x0014, 0x0839, 0x0845, 0x0846, 0x0849, 0x084A, 0x0674, 0x0675,
                   0x079E, 0x079F, 0x085C, 0x0788, 0x0793, 0x07AE, 0x5EA7, 0x5EA8,
                   0x079D, 0x078A, 0x0833, 0x0859, 0x085B, 0x085A, 0x5EA4, 0x02C8,
                   0x0792, 0x0836, 0x0837, 0x0838, 0x078B, 0x078C, 0x085E, 0x07A1,
                   0x0790, 0x0791]
FRAME_ENTRY = 64   # záznam snímku: 34 B použito, krok 64 (4096 / 64 záznamů v kruhu $7000–$7FFF)
VARS = {'birth': 0x0793, 'beforeBirth': 0x0792, 'noRockford': 0x0794, 'caveOver': 0x0795,
        'magicWall': 0x078A, 'magicWallSec': 0x078B, 'magicWallTime': 0x078C, 'diamondsEnough': 0x078D,
        'amoebaGrow': 0x078E, 'amoebaGrewLast': 0x078F, 'amoebaEnclosed': 0x0789, 'amoebaMask': 0x07A1, 'amoebaCount': 0x07A2, 'amoebaCountLast': 0x07A3,
        'moved': 0x0842, 'trig': 0x0843, 'blink': 0x0844, 'stick': 0x0788, 'facing': 0x079D,
        'rockfordX': 0x079E, 'rockfordY': 0x079F, 'exitReached': 0x07A8, 'paused': 0x07A4,
        'secondsGone': 0x083A, 'tick': 0x0839, 'flash': 0x07AE, 'sound2': 0x0799,
        'scrollXLo': 0x0845, 'scrollX': 0x0846, 'scrollYLo': 0x0849, 'scrollY': 0x084A,
        'scrollVxLo': 0x0847, 'scrollVx': 0x0848, 'scrollVyLo': 0x084B, 'scrollVy': 0x084C,
        'hscrol': 0x0674, 'vscrol': 0x0675, 'lives': 0x07B6, 'animPhase': 0x085C, 'animBlink': 0x085B, 'animTap': 0x085A,
        'statusLmsLo': 0x5EA4, 'statusLmsHi': 0x5EA5}
VAR_RANGES = {'time': (0x0836, 3), 'collected': (0x083B, 2), 'needed': (0x083D, 2), 'diamondValue': (0x07B3, 3), 'extraValue': (0x083F, 3), 'score': (0x07B9, 6)}

MAIN_SITES = [0x0D88, 0x0FB7, 0x1018, 0x124A, 0x1886, 0x18E5]   # ★ čtená z hlavní smyčky (průchod, draw_cave)
VBI_SITES = [0x15AD, 0x15B3, 0x15B9, 0x15BF, 0x1936, 0x19D9, 0x19E5, 0x1B17]   # ★ čtená z odložené VBI

def random_core(pointer, save):
    """Jádro háčku RANDOM: A = id místa; záznam (id, hodnota, RTCLOK, 0) na
    (pointer), ukazatel +4 (dolní bajt jedním STA), stránka se otáčí v kruhu
    RING_PAGES; vrátí hodnotu s příznaky N/Z jako LDA. Dvě jádra (hlavní
    smyčka / VBI), protože VBI je NMI a jádro hlavní smyčky přeruší uprostřed."""
    first, last = RINGS[pointer]
    return bytes([0x8C, save & 0xFF, save >> 8,          # STY save
                  0xA0, 0x00,                            # LDY #0
                  0x91, pointer,                         # STA (ptr),Y   id
                  0xAD, 0x0A, 0xD2,                      # LDA RANDOM
                  0xC8,                                  # INY
                  0x91, pointer,                         # STA (ptr),Y   hodnota
                  0x8D, (save + 1) & 0xFF, save >> 8,    # STA save+1
                  0xA5, 0x14, 0xC8, 0x91, pointer,       # LDA RTCLOK+2; INY; STA (ptr),Y
                  0xA9, 0x00, 0xC8, 0x91, pointer,       # LDA #0; INY; STA (ptr),Y
                  0xA5, pointer, 0x18, 0x69, 0x04, 0x85, pointer,   # LDA ptr; CLC; ADC #4; STA ptr
                  0x90, 0x0C,                            # BCC +12
                  0xE6, pointer + 1,                     # INC ptr+1
                  0xA5, pointer + 1, 0xC9, last + 1,     # LDA ptr+1; CMP #last+1
                  0xD0, 0x02, 0xA9, first,               # BNE +2; LDA #first
                  0x85, pointer + 1,                     # STA ptr+1
                  0xAC, save & 0xFF, save >> 8,          # LDY save
                  0xAD, (save + 1) & 0xFF, save >> 8,    # LDA save+1
                  0x60])                                 # RTS

STUB_BASE = 0x6F00   # ★ stuby 14 čtení RANDOM (5 B každý); $6D00–$6E7F háček VBI, $6E80–$6EFF stuby HSCROL/VSCROL a spin-hooky

# kruhové logy: ukazatel v nulté stránce → (první stránka, poslední stránka); ★ $CB–$D1 hra ani OS nepoužívá
RINGS = {0xCB: (0x80, 0x9F), 0xCF: (0xA0, 0xAF), 0xCD: (0x70, 0x7F)}

def asm_bytes(frame_addrs=None):
    """Harness: (adresa, bajty) k zápisu + patche. `frame_addrs` = pole logu
    snímku (tracerules.py ho rozšiřuje; záznam má krok FRAME_ENTRY = 64 B)."""
    frame_addrs = frame_addrs or FRAME_LOG_ADDRS
    assert len(frame_addrs) <= FRAME_ENTRY
    blocks = []
    blocks.append((0x0600, random_core(0xCB, 0x0640)))   # hlavní smyčka → log $8000
    blocks.append((0x0680, random_core(0xCF, 0x0642)))   # VBI → log $9000
    stubs = b''
    for i, site in enumerate(RANDOM_SITES):
        core = 0x0600 if site in MAIN_SITES else 0x0680
        stubs += bytes([0xA9, i, 0x4C, core & 0xFF, core >> 8])          # LDA #i; JMP jádro
    blocks.append((STUB_BASE, stubs))
    # proměnné $0670–$067F: stick0, stick1, trig0, trig1, hscrol, vscrol, spin, scanEntered, -, caveOver, spinEnd
    blocks.append((0x0670, bytes([STICK_NONE, STICK_NONE, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0])))
    # háček VBI ($6D00): JSR $1BB0; značka snímku do logu náhody VBI; 16 B do logu snímků na ($CD)
    vbi = bytes([0x20, 0xB0, 0x1B,                         # JSR cave_step
                 0x8C, 0x44, 0x06, 0xA0, 0x00])            # STY $0644; LDY #0
    for a in frame_addrs:
        vbi += bytes([0xAD, a & 0xFF, a >> 8, 0x91, 0xCD, 0xC8])   # LDA abs; STA ($CD),Y; INY
    vbi += bytes([0x18, 0xA5, 0xCD, 0x69, FRAME_ENTRY, 0x85, 0xCD, 0x90, 0x0C,   # ($CD) += FRAME_ENTRY
                  0xE6, 0xCE, 0xA5, 0xCE, 0xC9, 0x80, 0xD0, 0x02, 0xA9, 0x70, 0x85, 0xCE,   # kruh $70–$7F
                  0xAC, 0x44, 0x06, 0x60])                                            # LDY $0644; RTS
    assert len(vbi) <= 0x180, len(vbi)   # $6D00–$6E7F; stuby čtení RANDOM jsou na STUB_BASE (M5: delší log snímku)
    blocks.append((0x6D00, vbi))
    blocks.append((0x6E80, bytes([0x8D, 0x04, 0xD4, 0x8D, 0x74, 0x06, 0x60])))   # STA HSCROL; STA $0674; RTS
    blocks.append((0x6E88, bytes([0x8D, 0x05, 0xD4, 0x8D, 0x75, 0x06, 0x60])))   # STA VSCROL; STA $0675; RTS
    # spin před průchodem ($6E90): INC $0677; čekej, dokud $0676; JMP cave_scan
    blocks.append((0x6E90, bytes([0xEE, 0x77, 0x06, 0xAD, 0x76, 0x06, 0xD0, 0xFB, 0x4C, 0x8F, 0x1D])))
    # spin po konci jeskyně ($6EA0): INC $0679; čekej, dokud $067A; JMP $1C3D
    blocks.append((0x6EA0, bytes([0xEE, 0x79, 0x06, 0xAD, 0x7A, 0x06, 0xD0, 0xFB, 0x4C, 0x3D, 0x1C])))
    patches = {}
    for i, site in enumerate(RANDOM_SITES):
        stub = STUB_BASE + 5 * i
        patches[site] = bytes([0x20, stub & 0xFF, stub >> 8])
    for site, var in INPUT_SITES.items():
        patches[site] = bytes([0xAD, var & 0xFF, var >> 8])
    patches[0x16C6] = bytes([0x20, 0x80, 0x6E])
    patches[0x169A] = bytes([0x20, 0x88, 0x6E])
    patches[0x263F] = bytes([0x20, 0x00, 0x6D])
    patches[0x2884] = bytes([0x20, 0x90, 0x6E])
    patches[0x28D9] = bytes([0x20, 0x90, 0x6E])
    patches[0x288C] = bytes([0x20, 0xA0, 0x6E])
    return blocks, patches

EXPECTED = {0x16C6: b'\x8d\x04\xd4', 0x169A: b'\x8d\x05\xd4', 0x263F: b'\x20\xb0\x1b', 0x2884: b'\x20\x8f\x1d', 0x28D9: b'\x20\x8f\x1d', 0x288C: b'\x20\x3d\x1c'}

def install(e, frame_addrs=None):
    blocks, patches = asm_bytes(frame_addrs)
    for addr, data in blocks:
        for i in range(0, len(data), 32):
            e.write(addr + i, data[i:i+32])
    for site, data in patches.items():
        old = e.read(site, 3)
        if site in RANDOM_SITES:
            assert old == b'\xad\x0a\xd2', f'${site:04X}: {old.hex()}'
        elif site in INPUT_SITES:
            assert old[0] == 0xAD and old[1] in (0x78, 0x79, 0x84, 0x85) and old[2] == 0x02, f'${site:04X}: {old.hex()}'
        else:
            assert old == EXPECTED[site], f'${site:04X}: {old.hex()} ≠ {EXPECTED[site].hex()}'
        e.write(site, data)
    reset_logs(e)

def reset_logs(e):
    e.write(0xCB, [0x00, 0x80, 0x00, 0x70, 0x00, 0xA0])
    e.logPos = {0xCB: 0x8000, 0xCD: 0x7000, 0xCF: 0xA000}

def read_ring(e, zp, entry):
    """Nové záznamy kruhového logu od minulého čtení. Ukazatel čte monitor
    v okamžiku breakpointu, který mohl hlavní smyčku přerušit mezi zápisem
    dolního a horního bajtu — pak ukazatel ukazuje o stránku zpět a rozdíl
    vyjde skoro na celý kruh: takový stav se přeskočí a záznamy se přečtou
    příště (nic se neztratí, jen se přiřadí k dalšímu čtení; razítko
    snímku v záznamu tím netrpí)."""
    first, last = RINGS[zp]
    start, size = first << 8, (last - first + 1) << 8
    p = int.from_bytes(e.read(zp, 2), 'little')
    pos = e.logPos[zp]
    avail = (p - pos) % size
    if avail == 0 or avail > size // 2 or avail % entry:
        return []
    if p > pos:
        raw = e.read(pos, avail)
    else:
        raw = e.read(pos, start + size - pos) + e.read(start, p - start)
    e.logPos[zp] = p
    return [list(raw[i:i+entry]) for i in range(0, len(raw), entry)]

def read_logs(e):
    """Log náhody hlavní smyčky, log náhody VBI (id, hodnota, snímek, 0)
    a log snímků (16 B) od minulého čtení."""
    return read_ring(e, 0xCB, 4), read_ring(e, 0xCF, 4), read_ring(e, 0xCD, FRAME_ENTRY)

def read_pokey(e):
    """Logy zápisů do POKEY (registr, hodnota, snímek, VCOUNT) hlavní smyčky
    a VBI od minulého čtení — jen když je nasazený harness `tracesound.py`
    (`e.soundRings`), jinak dva prázdné seznamy."""
    rings = getattr(e, 'soundRings', None)
    if not rings:
        return [], []
    return read_ring(e, rings[0], 4), read_ring(e, rings[1], 4)

def clock(e):
    rt = int.from_bytes(e.read(0x12, 3), 'big')
    ypos = int(re.search(r'ypos=\s*(\d+)', e.regs('ANTIC')).group(1))
    return {'rtclok': rt, 'ypos': ypos}

def read_vars(e):
    out = {k: e.peek(a) for k, a in VARS.items()}
    for k, (a, n) in VAR_RANGES.items():
        out[k] = list(e.read(a, n))
    return out

def cave_name(cave):
    """1–16 → A–P, 17–20 → X1–X4 (mezihry)."""
    return chr(64 + cave) if cave <= 16 else 'X%d' % (cave - 16)

def demo_script():
    """★ Demo $3BC0: bajt = (počet << 4) | páčka, jednotka = průchod; konec páčkou 0."""
    demo = json.load(open(os.path.join(ROOT, 'data', 'demo.json')))
    out = []
    for step in demo['steps']:
        for _ in range(step['count']):
            out.append((step['stick'], 1))
    return out

def random_script(seed, passes):
    """Seedovaná procházka: držení směru 2–14 průchodů, občas fire (sáhnutí)
    nebo klid; deterministická, takže se dá záznam zopakovat."""
    rng = random.Random(seed)
    out = []
    while len(out) < passes:
        stick = rng.choice([STICK_NONE, STICK_UP, STICK_DOWN, STICK_LEFT, STICK_RIGHT, STICK_LEFT, STICK_RIGHT, STICK_DOWN])
        trig = 0 if rng.random() < 0.12 else 1
        for _ in range(rng.randint(2, 14)):
            out.append((stick, trig))
    return out[:passes]

# ★ Scénáře (M4): větve, ke kterým se náhodná procházka ani klid nedostanou,
# se vyrobí záplatou mřížky `$4C00` (+ obrazu `$5000`, dlaždice z tabulky
# `$3C40`) a hlavičky `$5F00` v okamžiku prvního breakpointu `$1D8F` — tedy po
# plném nakreslení, před prvním průchodem. Záznam záplaty nese (`patch`,
# `header`) a `matchscan.mjs` je provede na své mřížce stejně.
SCENARIOS = {
    # kouzelná zeď v H (řádek 17, x 14–21): kámen (15,15) padá do zdi, produkt
    # diamant do prázdna (15,18); diamant (18,15) padá do zdi, pod zdí hlína →
    # zmizí bez produktu; zeď vyhasne po 1 s (hlavička[1] = 1 místo 20) a kámen
    # (19,3) padající sloupem prázdna x = 19 do ní dorazí až vyhaslou → zmizí
    # (vchod je na (20,3), toho se záplata nedotkne)
    'magicwall': {'cave': 8, 'level': 0, 'script': 'idle',
                  'patch': [(15, 15, 0x10), (15, 16, 0x00), (15, 18, 0x00), (18, 15, 0x14), (18, 16, 0x00)]
                           + [(19, y, 0x00) for y in range(4, 17)] + [(19, 3, 0x10)],
                  'header': {1: 1}},
    # améba v A zavřená do krabice ze zdí (x 8–14, y 10–14): roste do hlíny,
    # a když už nemá kam ($078E = 0 po průchodu, ve kterém rostla), ztuhne v diamanty
    'amoebabox': {'cave': 1, 'level': 0, 'script': 'idle',
                  'patch': [(x, y, 0x02) for x in range(8, 15) for y in (10, 14)] + [(x, y, 0x02) for x in (8, 14) for y in range(11, 14)]
                           + [(x, y, 0x01) for x in range(9, 14) for y in range(11, 14)] + [(9, 11, 0x3A), (10, 11, 0x3A)],
                  'header': {}},
}
TILE_BASE = None   # ★ $3C40: objekt → základní znak dlaždice (data/charset.json)

def apply_patch(e, scenario):
    """Záplata mřížky, obrazu a hlavičky v emulátoru (na breakpointu $1D8F)."""
    global TILE_BASE
    if TILE_BASE is None:
        TILE_BASE = json.load(open(os.path.join(ROOT, 'data', 'charset.json')))['tiles']['base']
    for x, y, code in scenario['patch']:
        e.write(0x4C00 + y * 40 + x, [code])
        a = 0x5003 + 160 * (y - 2) + 2 * x
        base = TILE_BASE[code]
        e.write(a, [base, base + 1]); e.write(a + 80, [base + 16, base + 17])
    for off, value in scenario['header'].items():
        e.write(0x5F00 + off, [value])

def idle_script(passes):
    """Páčka v klidu a tlačítko nikdy (M4): Rockford stojí, tvorové chodí,
    améba roste, kameny padají; po smrti Rockforda jeskyně běží dál (`$1D73`
    končí jen s fire), takže záznam trvá až do OUT OF TIME."""
    return [(STICK_NONE, 1)] * passes

def one(job):
    cave, level, passes, script_name, seed, scenario = job
    for attempt in range(3):
        try:
            return one_run(cave, level, passes, script_name, seed, scenario)
        except (RuntimeError, AssertionError, OSError) as err:   # OSError: emulátor zemřel při startu (BrokenPipe)
            print('  pokus %d %s/%s: %s' % (attempt + 1, cave, level, err), flush=True)
    return None

def one_run(cave, level, passes, script_name, seed, scenario=None):
    """Jeden záznam; emulátor se zavře i při chybě (jinak zůstane osiřelý
    `atari800` v turbu na 100 % CPU a zpomalí další běhy)."""
    e = bdrun.start()
    try:
        return one_run_inner(e, cave, level, passes, script_name, seed, scenario)
    finally:
        e.close()

def one_run_inner(e, cave, level, passes, script_name, seed, scenario=None):
    bdrun.to_menu(e)
    if not bdrun.cave_setup(e, cave, level):
        raise RuntimeError('breakpoint $2645 nechycen')
    if e.peek(bdrun.DEMO_FLAG):
        raise RuntimeError('jeskyně startuje v demu ($07AB = 1) — pozdní START')
    install(e)
    rec = {'cave': cave, 'level': level, 'script': script_name, 'seed': seed, 'setup': clock(e)}
    if scenario:
        rec['scenario'] = scenario
        rec['patch'] = [list(p_) for p_ in SCENARIOS[scenario]['patch']]
        rec['header'] = {str(k): v for k, v in SCENARIOS[scenario]['header'].items()}
    # fáze 0: po snímcích, dokud hlavní smyčka nedojde ke spin-hooku před prvním průchodem
    e.set_breakpoint('xitvbv')
    uncover = []
    for i in range(400):
        e.cmd('CONT')
        randoms, vrandoms, frames = read_logs(e)
        uncover.append({'clock': clock(e), 'screen': e.read(0x5000, 0x0DC0).hex(), 'randoms': randoms, 'vbiRandoms': vrandoms, 'frames': frames,
                        'dlist': e.read(0x5EA0, 0x51).hex(), 'hscrol': e.peek(0x0674), 'vscrol': e.peek(0x0675)})
        if e.peek(0x0677):
            break
    rec['uncover'] = uncover
    rec['uncoverFrames'] = len(uncover)
    # průchody
    script = demo_script() if script_name == 'demo' else idle_script(passes) if script_name == 'idle' else random_script(seed * 100 + cave * 5 + level, passes)
    e.write(0x0676, [0]); e.cmd('BPC 1D8F')
    recs = []
    for k in range(passes):
        # CONT dokončí průchod k−1 a zastaví na začátku průchodu k; vstup
        # pro průchod k se zapíše až po záznamu, takže `input` záznamu k je
        # to, co průchod k opravdu přečte
        e.cmd('CONT')
        if e.timed_out or e.peek(0x0679):
            break
        if k == 0 and scenario:
            apply_patch(e, SCENARIOS[scenario])
        stick, trig = script[k] if k < len(script) else (STICK_NONE, 1)
        randoms, vrandoms, frames = read_logs(e)
        vars_ = read_vars(e)
        # ? fantomový restart emulátoru: po dlouhých bězích se občas objeví
        # klávesa $3F v CH a hra se ocitne v titulce → demo → nová jeskyně
        # (skóre 0, řádek před narozením), aniž prošla hookem konce jeskyně.
        # V žádném z 8 herních záznamů M3 se to nestalo (matchscan 0 rozdílů);
        # u dema ano. Záznam se tady uřízne — dál by to nebyla tatáž hra
        if recs and vars_['statusLmsLo'] == 0x1F and recs[-1]['vars']['statusLmsLo'] == 0x0B:
            rec_restart = k
            print('  %d/%d: průchod %d — originál se restartoval (fantomová klávesa CH=$%02X), záznam uříznut' % (cave, level, k, e.peek(0x02FC)), flush=True)
            break
        recs.append({'clock': clock(e), 'input': [stick, trig],
                     'grid': e.read(0x4C00, 960).hex(), 'screen': e.read(0x5000, 0x0DC0).hex(),
                     'charsetB': e.read(0x4400, 0x0400).hex(),
                     'status': e.read(0x080B, 40).hex(), 'dlist': e.read(0x5EA0, 0x51).hex(),
                     'vars': vars_, 'randoms': randoms, 'vbiRandoms': vrandoms, 'frames': frames})
        e.write(0x0670, [stick, stick, trig, trig])
    rec['passes'] = recs
    rec['caveOver'] = e.peek(0x0679)
    rec['finalVars'] = read_vars(e)
    return rec

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--caves', default='1,2,3,4'); ap.add_argument('--levels', default='1')
    ap.add_argument('--passes', type=int, default=1500); ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--script', default='random'); ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--scenario', default='')
    a = ap.parse_args()
    if a.scenario:
        jobs = [(SCENARIOS[n]['cave'], SCENARIOS[n]['level'], a.passes, SCENARIOS[n]['script'], a.seed, n) for n in a.scenario.split(',')]
    else:
        caves = [int(x) for x in a.caves.split(',')]; levels = [int(x) for x in a.levels.split(',')]
        jobs = [(c, l - 1, a.passes, a.script, a.seed, None) for c in caves for l in levels]
    os.makedirs(OUT_DIR, exist_ok=True)
    t = time.time()
    # výsledky se ukládají hned, jak přijdou — pád jednoho běhu nesmí stát ostatní
    with Pool(a.jobs) as p:
        for rec in p.imap_unordered(one, jobs):
            if rec is None:
                continue
            name = '%s%d%s' % (cave_name(rec['cave']), rec['level'] + 1, '' if rec['script'] == 'random' and rec['seed'] == 1 else '-' + (rec['script'] if rec['script'] != 'random' else 'seed%d' % rec['seed']))
            if rec.get('scenario'):
                name = '%s%d-%s' % (cave_name(rec['cave']), rec['level'] + 1, rec['scenario'])
            path = os.path.join(OUT_DIR, name + '.json.gz')
            with gzip.open(path, 'wt') as f:
                json.dump(rec, f)
            lengths = [(q['clock']['rtclok'] - p_['clock']['rtclok']) for p_, q in zip(rec['passes'], rec['passes'][1:])]
            print('%s: odkrývání %d snímků, %d průchodů, konec jeskyně %d, snímků/průchod %.2f → %s' % (
                name, rec['uncoverFrames'], len(rec['passes']), rec['caveOver'], (sum(lengths) / len(lengths)) if lengths else 0, path), flush=True)
    print('%.0f s' % (time.time() - t))

if __name__ == '__main__':
    main()
