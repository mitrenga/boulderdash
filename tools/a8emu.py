#!/usr/bin/env python3
"""a8emu — obálka nad atari800 (5.0, apt) bez displeje: SDL dummy, monitor
přes stdin/stdout, vstup do monitoru SIGINTem, krok po snímcích přes BLINE.

    from a8emu import A8Emu
    e = A8Emu(image)                 # 800XL PAL, OS ROM z sources/rom/, turbo
    e.frames(100)                    # 100 snímků, joystick v klidu
    e.frames(10, stick=STICK_RIGHT, trig=0)
    e.read(0x2900, 0x4400)           # bajty paměti
    e.dlist(); e.regs('GTIA')        # výpisy monitoru
    e.dump('build/mem.bin')          # 64 KB
    e.close()

Vstupy se zapisují do stínů OS (STICK0 $0278, STRIG0 $0284, CH $02FC) po
každém VBI — hra je odtamtud čte (★ statický průzkum, žádné čtení PORTA/
TRIG0/KBCODE). CONSOL ($D01F) je hardware a stín nemá; START se řeší
zvlášť (`consol`), pokud hra klávesy konzole vůbec potřebuje.

CLI:  ./a8emu.py IMAGE --frames N [--dump FILE] [--dlist] [--regs] [--script "f0:f1:stick[:trig],…"]
"""
import subprocess, signal, os, sys, time, tempfile, re, select

# OS ROM stroje je podklad projektu, ne součást knihovny (R-041): leží
# v sources/rom/ (mimo git), stáhne/naimportuje ji
# `svision/tools/retro/fetchroms.py atari8 --import PATH`.
ROM = os.environ.get('ATARI_OS_ROM') or os.path.join(os.path.dirname(__file__), '..', 'sources', 'rom', 'atari-xl-os.rom')
STICK_NONE, STICK_UP, STICK_DOWN, STICK_LEFT, STICK_RIGHT = 0x0F, 0x0E, 0x0D, 0x0B, 0x07
STICK_UL, STICK_UR, STICK_DL, STICK_DR = 0x0A, 0x06, 0x09, 0x05
SENTINEL = 'SUM: '   # monitor bez terminálu netiskne prompt; každý příkaz zakončí `SUM FFFF FFFF`

class A8Emu:
    def __init__(self, image, pal=True, turbo=True, rom=ROM, verbose=False, timeout=3.0, breakpoint='xitvbv', startup=0.4):
        if not os.path.exists(rom):
            raise SystemExit('chybí OS ROM %s\n  ../svision/tools/retro/fetchroms.py atari8 --import PATH   (R-041)' % rom)
        env = dict(os.environ, SDL_VIDEODRIVER='dummy', SDL_AUDIODRIVER='dummy')
        args = ['stdbuf', '-o0', '-i0', 'atari800', '-xl', '-pal' if pal else '-ntsc', '-nosound', '-nobasic',
                '-xlxe_rom', rom, '-nojoystick']
        if turbo: args.append('-turbo')
        low = image.lower()
        if low.endswith('.xex') or low.endswith('.com'): args += ['-run', image]
        elif low.endswith('.car') or low.endswith('.rom'): args += ['-cart', image]
        elif low.endswith('.cas'): args += ['-boottape', image]
        else: args.append(image)          # .atr → D1:
        self.verbose = verbose; self.timeout = timeout; self.max_timeouts = 5
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  env=env, bufsize=0)   # binárně, bez bufferu — kvůli select()
        self.frame = 0
        # start SDL a nahrání obrazu; v turbu za tu dobu uběhnou tisíce snímků
        # (podle zátěže stroje), takže kdo potřebuje chytit titulku včas, dá
        # kratší `startup` a zkontroluje RTCLOK (bdrun.start)
        time.sleep(startup)
        self.p.send_signal(signal.SIGINT)
        time.sleep(0.3); self._read_prompt()
        # Krok = snímek: breakpoint na výstupu z VBI (vektor VVBLKD $0224 →
        # XITVBV), tj. po tom, co OS opsal PORTA→STICK0 a TRIG→STRIG. BLINE
        # se nehodí: zastavuje na každé instrukci daného řádku.
        self.set_breakpoint(breakpoint)
        self.stick, self.trig, self.key = STICK_NONE, 1, 0xFF

    NOISE = ('Cannot use OpenGL', 'Video Mode:')

    def _read_prompt(self):
        """Čte, dokud nepřijde řádek `SUM: xx` od oddělovače; vrací výstup
        příkazu bez šumu SDL."""
        self._send('SUM FFFF FFFF')
        buf = ''; self.timed_out = False; timeouts = 0
        while True:
            if not select.select([self.p.stdout], [], [], self.timeout)[0]:
                # emulátor běží a breakpoint nepřišel: zpátky do monitoru;
                # když se monitor neozve ani po několika pokusech, je to chyba,
                # ne čekání (jinak by nástroj visel navěky)
                timeouts += 1
                if timeouts > self.max_timeouts:
                    raise RuntimeError('atari800: monitor neodpovídá (%d× timeout %.1f s)' % (timeouts, self.timeout))
                # sentinel uz ve vstupu ceka (cmd ho poslal hned za prikazem) -
                # druhy by monitor vratil navic a dalsi prikaz by dostal cizi odpoved
                self.timed_out = True; self.p.send_signal(signal.SIGINT); time.sleep(0.2)
                continue
            line = self.p.stdout.readline().decode('latin1')
            if not line: raise RuntimeError('atari800 skončil:\n' + buf[-2000:])
            if line.startswith(SENTINEL): break
            if line.strip() and not line.startswith(self.NOISE): buf += line
        return buf

    def _send(self, s):
        self.p.stdin.write((s + '\n').encode('latin1')); self.p.stdin.flush()

    def cmd(self, s):
        self._send(s)
        out = self._read_prompt()
        if self.verbose: print('>', s); print(out, end='')
        return out

    # --- paměť -------------------------------------------------------
    def read(self, addr, n):
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f: path = f.name
        self.cmd(f'WRITE {addr:04X} {addr+n-1:04X} {path}')
        data = open(path, 'rb').read(); os.unlink(path); return data

    def dump(self, path):
        self.cmd(f'WRITE 0000 FFFF {os.path.abspath(path)}')

    def write(self, addr, data):
        self.cmd(f'C {addr:04X} ' + ' '.join(f'{b:02X}' for b in data))

    def peek(self, addr): return self.read(addr, 1)[0]

    # --- běh ---------------------------------------------------------
    def frames(self, n=1, stick=None, trig=None, key=None):
        if stick is not None: self.stick = stick
        if trig is not None: self.trig = trig
        for _ in range(n):
            self.write(0x0278, [self.stick]); self.write(0x0284, [self.trig])
            if key is not None: self.write(0x02FC, [key])
            self.cmd('CONT'); self.frame += 1

    def set_breakpoint(self, where):
        """'xitvbv' = výstup z 2. fáze VBI (vektor VVBLKD $0224) — po opsání
        joysticku do stínů; 'vbi' = vstup do VBI (VVBLKI $0222) — přijde vždy,
        i když hra 2. fázi přeskočí (CRITIC / SEI)."""
        vec = 0x0224 if where == 'xitvbv' else 0x0222
        self.bp = int.from_bytes(self.read(vec, 2), 'little'); self.bpmode = where
        self.cmd(f'BPC {self.bp:04X}')

    def press_consol(self, sites, value, n, stick=None, trig=None):
        """START/SELECT/OPTION: CONSOL ($D01F) je hardware bez stínu a monitor
        ho nastavit neumí. Na `sites` (adresy instrukcí `LDA $D01F`, AD 1F D0)
        se na `n` snímků podstrčí `LDA #value` + NOP (A9 vv EA) a pak se
        původní bajty vrátí. START = 6, SELECT = 5, OPTION = 3, nic = 7."""
        saved = {a: self.read(a, 3) for a in sites}
        for a, b in saved.items():
            assert b == b'\xad\x1f\xd0', f'na ${a:04X} není LDA $D01F: {b.hex()}'
            self.write(a, [0xA9, value, 0xEA])
        self.frames(n, stick, trig)
        for a, b in saved.items(): self.write(a, b)

    def savestate(self, path): self.cmd(f'SAVESTATE {os.path.abspath(path)}')
    def dlist(self): return self.cmd('DLIST')
    def regs(self, chip='GTIA'): return self.cmd(chip)
    def show(self): return self.cmd('SHOW')
    def disasm(self, addr, lines=20): return self.cmd(f'D {addr:04X}')

    def close(self):
        try: self._send('QUIT'); self.p.wait(timeout=3)
        except Exception: self.p.kill()

def parse_script(s):
    """'f0:f1:stick[:trig],…' → seznam (od, do, stick, trig)."""
    out = []
    for part in s.split(','):
        f = part.split(':'); out.append((int(f[0]), int(f[1]), int(f[2], 0), int(f[3]) if len(f) > 3 else 1))
    return out

def main():
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument('image'); ap.add_argument('--frames', type=int, default=100)
    ap.add_argument('--dump'); ap.add_argument('--dlist', action='store_true'); ap.add_argument('--regs', action='store_true')
    ap.add_argument('--script', default=''); ap.add_argument('--state'); ap.add_argument('-v', action='store_true')
    a = ap.parse_args()
    e = A8Emu(a.image, verbose=a.v); script = parse_script(a.script) if a.script else []
    for fr in range(a.frames):
        st, tr = STICK_NONE, 1
        for f0, f1, s, t in script:
            if f0 <= fr < f1: st, tr = s, t
        e.frames(1, st, tr)
    print(f'snímek {e.frame}, RTCLOK {int.from_bytes(e.read(0x12, 3), "big")}')
    if a.dlist: print(e.dlist())
    if a.regs: print(e.regs('ANTIC')); print(e.regs('GTIA')); print(e.regs('POKEY'))
    if a.dump: e.dump(a.dump); print('paměť →', a.dump)
    if a.state: e.savestate(a.state)
    e.close()

if __name__ == '__main__':
    main()
