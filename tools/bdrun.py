#!/usr/bin/env python3
"""bdrun — co je v obálce a8emu specifické pro Boulder Dash: cesta k referenci,
místa čtení CONSOL (pro START), průchod titulka → menu → jeskyně → narození.
Adresy jsou **za běhu** (soubor − $2000, ★ kopírovací stub $6C80)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from a8emu import A8Emu, STICK_NONE

ROOT = os.path.join(os.path.dirname(__file__), '..')
REF = os.path.join(ROOT, 'sources', 'diskette', 'Boulder Dash (1984)(First Star Software)(US)[cart version].xex')
CONSOL_SITES = [0x1D04, 0x244A, 0x2532]   # ★ LDA $D01F (soubor $3D04, $444A, $4532)
CONSOL_START = 6
MODE = 0x0876        # ★ 1 = titulka/menu (JSR $2425 z VBI), 0 = jeskyně (JSR $1BB0)
STICK_VAR = 0x0788   # ★ kam si hra opíše STICK0 ($1374)
CAVE_SCREEN = 0x5000 # ★ obraz jeskyně 44 řádků × 80 B (LMS v DL $5EA0)
STATUS = 0x081F      # ★ stavový řádek, režim 6, 20 znaků — dva buffery $080B / $081F, který platí, říká LMS v DL

def decode(b):
    """Interní kód → text (jen pro čtení textů, ne pro dlaždice)."""
    out = ''
    for x in b:
        c = x & 0x7f; out += chr(c + 32) if c < 64 else (chr(c) if c < 96 else '~')
    return out

DEMO_FLAG = 0x07AB   # ★ 1 = demo (titulka/menu bez vstupu ~1200 snímků, $2546/$2566; init $296C), 0 = fire v menu
TITLE_LIMIT = 1050   # ★ demo startuje ~1175 snímků od zapnutí (M0); START musí přijít dřív

def start(image=REF, **kw):
    """Zapnutí → titulka. Start atari800 není na snímek deterministický:
    SIGINT přijde po `startup` sekundách, což je v turbu podle zátěže stroje
    1000–4000 snímků, a titulka bez vstupu po ~1175 snímcích spustí demo —
    pak by nástroj nahrával demo originálu místo svých vstupů (M3,
    `disasm_notes.md` §16). Zkouší se proto kratší a kratší `startup`,
    dokud SIGINT nepřijde včas; když se to nepovede, je to chyba a volající
    (`tracescan.one`) to zopakuje."""
    for startup in (kw.pop('startup', 0.4), 0.25, 0.15, 0.1, 0.07):
        try:
            e = A8Emu(image, startup=startup, **kw)
        except RuntimeError:
            continue
        e.frames(30)
        rt = int.from_bytes(e.read(0x12, 3), 'big')
        if rt <= TITLE_LIMIT:
            return e
        e.close()
    raise RuntimeError('pozdní start emulátoru (RTCLOK %d > %d), titulka by přešla do dema' % (rt, TITLE_LIMIT))

def to_menu(e):     e.press_consol(CONSOL_SITES, CONSOL_START, 10); e.frames(20)
def to_cave(e):     e.frames(10, trig=0); e.frames(1, trig=1)          # ★ PRESS BUTTON TO PLAY
def wait_uncover(e, n=200): e.frames(n)                                 # ★ odkrývání ~100 snímků, pak bliká vchod
def birth(e):       e.frames(10, trig=0); e.frames(1, trig=1)          # ★ po odkrytí čeká hra na fire

def cave_a_state(e=None, path=os.path.join(ROOT, 'build', 'caveA.a8s')):
    """Titulka → jeskyně A, úroveň 1, po narození; uloží stav a vrátí emulátor."""
    e = e or start(); to_menu(e); to_cave(e); wait_uncover(e); birth(e); e.frames(5)
    e.savestate(path); return e

CAVE_SETUP = 0x2645  # ★ JSR $1E33 (načtení jeskyně) … JSR $1C02 (výplň) … JSR $21A8 (instrukce) — volá $2904 po fire v menu
CAVE_NUMBER = 0x07B7 # ★ číslo jeskyně 1–20 (index do $3500, tabulky $1E0B); 0 = titulka
LEVEL_INDEX = 0x07B8 # ★ obtížnost 0–4 (index semínka $5F04+X, počtu $5F09+X, času $5F0E+X)
CAVE_LOADED = 0x07A0 # ★ číslo naposledy zkopírované jeskyně ($1E33 kopíruje jen při změně); init $FF

CAVE_DRAWN = 0x2674  # ★ za JSR $1954 (obraz jeskyně nakreslený z mřížky), před $2012 (zakrytí a odkrývání)

def run_to(e, addr, max_steps=5, trig=1):
    """Běží (bez vstupů) až na adresu; vrátí True, když se chytila."""
    e.cmd(f'BPC {addr:04X}')
    for _ in range(max_steps):
        e.write(0x0278, [STICK_NONE]); e.write(0x0284, [trig]); e.cmd('CONT')
        if f'PC={addr:04X}' in e.show().replace(' ', ''):
            return True
    return False

def cave_setup(e, cave, level, max_frames=15):
    """V menu podstrčit číslo jeskyně 1–20 a obtížnost 0–4 (menu samo nabízí
    jen A/E/I/M; ★ menu je zapisuje jen při pohybu páčky, po fire je `$258D`
    opíše do stavového řádku a `$2645` podle nich načte jeskyni), stisknout
    fire a zastavit na $2645 — před načtením jeskyně. Vrátí True, když se
    breakpoint chytil a hodnoty přežily."""
    e.write(CAVE_NUMBER, [cave]); e.write(LEVEL_INDEX, [level]); e.write(CAVE_LOADED, [0xFF])
    e.cmd(f'BPC {CAVE_SETUP:04X}')
    hit = False
    for _ in range(max_frames):
        e.write(0x0278, [STICK_NONE]); e.write(0x0284, [0]); e.cmd('CONT')
        if f'PC={CAVE_SETUP:04X}' in e.show().replace(' ', ''):
            hit = True; break
    if hit and (e.peek(CAVE_NUMBER) != cave or e.peek(LEVEL_INDEX) != level):
        # menu hodnoty prepsalo (start emulatoru neni na snimek deterministicky -
        # SIGINT po time.sleep): podstrcit znovu i s tim, co z nich $258D opsalo
        # do stavoveho radku ($082F = $07B7 + $A0, $0831 = $07B8 + $91)
        e.write(CAVE_NUMBER, [cave]); e.write(LEVEL_INDEX, [level]); e.write(CAVE_LOADED, [0xFF])
        e.write(0x082F, [(cave + 0xA0) & 0xFF]); e.write(0x0831, [(level + 0x91) & 0xFF])
    return hit
