#!/usr/bin/env python3
"""mkscreen — statická obrazovka jeskyně A/1 z běžícího originálu:
64 KB paměti + registry ANTIC/GTIA + DLI (jako data) → data/screen.json.

Provizorium M1: jeskyně se kreslí z paměti originálu přes jeho vlastní
display list, ne z tabulek (ty jsou M2). Jsou to jeho bajty, nic se
nedokresluje. ★ DLI hry (`$09E0`) jen nastaví CHBASE $44 — proto je tady
`dli: [{"chbase": 68}]`, odečteno z disassembly, ne odhadnuto.

    ./tools/mkscreen.py [--state build/caveA.a8s] [--frames N]
    ./tools/mkscreen.py --title [--after-demo] [--frames N]   # titulka: fotka + log animace sady A (M7)

Vedle toho uloží build/ref/caveA.regs.json a build/ref/caveA.mem.bin pro
`renderref.py` (nezávislý renderer) a `matchscreen.mjs`."""
import sys, os, json, base64, re, argparse
sys.path.insert(0, os.path.dirname(__file__))
from a8emu import *
import bdrun

ROOT = bdrun.ROOT
DLI_EFFECT = [{'chbase': 0x44}]   # ★ $09E0: LDA #$44; STA WSYNC; STA CHBASE; RTI

def registers(e):
    antic = e.regs('ANTIC'); gtia = e.regs('GTIA')
    def rv(name, text): return int(re.search(name+r'=\s*([0-9A-F]{2})', text).group(1), 16)
    return {
        'dlist': int.from_bytes(e.read(0x230, 2), 'little'),   # SDLSTL/H — stín, hodnota po VBI
        'dmactl': rv('DMACTL', antic), 'chactl': rv('CHACTL', antic), 'chbase': e.peek(0x2F4),   # CHBAS stín
        'hscrol': rv('HSCROL', antic), 'vscrol': rv('VSCROL', antic), 'pmbase': rv('PMBASE', antic),
        'colbk': rv('COLBK', gtia), 'colpf': [rv('COLPF%d' % i, gtia) for i in range(4)],
        'colpm': [rv('COLPM%d' % i, gtia) for i in range(4)], 'prior': rv('PRIOR', gtia), 'gractl': rv('GRACTL', gtia),
    }

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--frames', type=int, default=30)
    # ★ M3: druhá reference s posunutým oknem — jeskyně, ve které Rockford
    # nezačíná vlevo nahoře, takže scroll ve VBI okno posune (LMS řádků,
    # HSCROL i VSCROL mimo šablonu). `--name` odliší výstupy
    ap.add_argument('--cave', type=int, default=0, help='číslo jeskyně 1–20 přes bdrun.cave_setup (0 = fire v menu = A)')
    ap.add_argument('--level', type=int, default=1); ap.add_argument('--name', default='caveA')
    # ★ M7: titulka — po zapnutí (--title) nebo po demu (--title --after-demo: titulka → demo
    # → cave_end → titulka, $2918 vynuloval znak 0 sady A); vedle fotky i `titleFrames`:
    # `--frames` snímků hodnot $085E a znaků 0, 9, 10 sady A pro tools/matchtitle.mjs
    ap.add_argument('--title', action='store_true'); ap.add_argument('--after-demo', action='store_true')
    a = ap.parse_args()
    if a.title:
        return title(a)
    e = bdrun.start(); bdrun.to_menu(e)
    if a.cave:
        assert bdrun.cave_setup(e, a.cave, a.level - 1), 'breakpoint $2645 nechycen'
        e.set_breakpoint('xitvbv'); e.frames(a.frames)
    else:
        bdrun.to_cave(e); bdrun.wait_uncover(e); bdrun.birth(e); e.frames(a.frames)
    regs = registers(e); mem = e.read(0, 65536); frame = e.frame
    status = bdrun.decode(e.read(0x080B, 20)); e.close()
    os.makedirs(os.path.join(ROOT, 'build', 'ref'), exist_ok=True)
    open(os.path.join(ROOT, 'build', 'ref', a.name + '.mem.bin'), 'wb').write(mem)
    json.dump({'registers': regs, 'dli': DLI_EFFECT, 'frame': frame}, open(os.path.join(ROOT, 'build', 'ref', a.name + '.regs.json'), 'w'), indent=1)
    what = 'jeskyně A/1 po narození Rockforda' if not a.cave else 'jeskyně %d/%d %d snímků po startu ($2645), okno posunuté scrollem ve VBI' % (a.cave, a.level, a.frames)
    out = {
        '_comment': '%s, %d snímků po zapnutí: 64 KB paměti originálu (base64), registry ANTIC/GTIA po VBI a DLI jako data. tools/mkscreen.py, doloženo tools/matchscreen.mjs. Reference pro renderer knihovny (M1; M3 přidala posunuté okno).' % (what, frame),
        'memory': base64.b64encode(mem).decode('ascii'),
        'registers': regs, 'dli': DLI_EFFECT, 'frame': frame, 'status': status.strip()
    }
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    target = 'screen.json' if a.name == 'caveA' else 'screen_%s.json' % a.name
    json.dump(out, open(os.path.join(ROOT, 'data', target), 'w'))
    print('data/%s: snímek' % target, frame, 'DL $%04X CHBAS $%02X HSCROL %d VSCROL %d COLPF %s COLBK $%02X stav %r' % (regs['dlist'], regs['chbase'], regs['hscrol'], regs['vscrol'], ' '.join('$%02X' % c for c in regs['colpf']), regs['colbk'], status))

def title(a):
    e = bdrun.start()
    name = 'title_after' if a.after_demo else 'title'
    if a.after_demo:
        for i in range(400):                       # ★ hudba 2× dokola ($0874 == 2) → demo, režim $0876 = 0
            e.frames(8)
            if e.peek(bdrun.MODE) == 0: break
        assert e.peek(bdrun.MODE) == 0, 'demo nezačalo'
        for i in range(2000):                      # demo dohraje samo (skript $3BC0), pak titulka
            e.frames(25)
            if e.peek(bdrun.MODE) == 1: break
        assert e.peek(bdrun.MODE) == 1, 'titulka po demu nepřišla'
    regs = registers(e); mem = e.read(0, 65536); frame = e.frame
    rtclok = int.from_bytes(e.read(0x12, 3), 'big')
    frames = []
    for i in range(max(a.frames, 2)):
        a8 = e.read(0x4000, 0x60)
        frames.append({'frame': e.frame, 'toggle': e.peek(0x085E), 'char0': a8[0:8].hex(), 'char9': a8[0x48:0x50].hex(), 'char10': a8[0x50:0x58].hex()})
        e.frames(1)
    e.close()
    os.makedirs(os.path.join(ROOT, 'build', 'ref'), exist_ok=True)
    open(os.path.join(ROOT, 'build', 'ref', name + '.mem.bin'), 'wb').write(mem)
    json.dump({'registers': regs, 'dli': [], 'frame': frame}, open(os.path.join(ROOT, 'build', 'ref', name + '.regs.json'), 'w'), indent=1)
    what = 'titulka po demu (titulka → demo → cave_end $2918 → titulka)' if a.after_demo else 'titulka po zapnutí'
    out = {
        '_comment': '%s, snímek %d (RTCLOK %d): 64 KB paměti originálu (base64), registry ANTIC/GTIA po VBI, bez DLI; `titleFrames` = $085E a znaky 0/9/10 sady A po snímcích. tools/mkscreen.py --title%s, doloženo tools/matchscreen.mjs (renderer) a tools/matchtitle.mjs (stavba z data/title.json, animace). Reference M7.' % (what, frame, rtclok, ' --after-demo' if a.after_demo else ''),
        'memory': base64.b64encode(mem).decode('ascii'),
        'registers': regs, 'dli': [], 'frame': frame, 'rtclok': rtclok, 'titleFrames': frames
    }
    json.dump(out, open(os.path.join(ROOT, 'data', 'screen_%s.json' % name), 'w'))
    print('data/screen_%s.json: snímek %d RTCLOK %d DL $%04X CHBAS $%02X COLPF %s, %d snímků animace' % (name, frame, rtclok, regs['dlist'], regs['chbase'], ' '.join('$%02X' % c for c in regs['colpf']), len(frames)))

if __name__ == '__main__':
    main()
