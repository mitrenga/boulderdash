#!/usr/bin/env python3
"""renderref — nezávislý renderer ANTIC/GTIA v Pythonu: z 64 KB paměti,
registrů a DLI dat nakreslí 320×240 obraz **indexů barev** (bajt = hodnota
registru barvy), jak by ho zobrazil stroj. Je to druhá, na svision nezávislá
implementace téhož; `matchscreen.mjs` porovnává výstup `Atari8Screen.paint32`
s tímhle pixel po pixelu.

Co umí: prázdné řádky, JVB/JMP, LMS, režimy 2, 4, 6, 7, D, E, F, HSCROL
(široký fetch, posun vpravo o HSCROL clocků), VSCROL (první řádek běhu od
VSCROL, řádek za během VSCROL+1 řádků), DLI jako data. PMG ne (hra je
nepoužívá).

    ./tools/renderref.py [build/ref/caveA.mem.bin build/ref/caveA.regs.json] → build/ref/caveA.idx (+ .png)"""
import sys, os, json, struct, zlib

W, H = 320, 240
MODES = {2: (8, 40), 3: (10, 40), 4: (8, 40), 5: (16, 40), 6: (8, 20), 7: (16, 20), 8: (8, 10), 9: (4, 10),
         10: (4, 20), 11: (2, 20), 12: (1, 20), 13: (2, 40), 14: (1, 40), 15: (1, 40)}
WIDE = {40: 48, 20: 24, 10: 12}

def render(mem, r, dli):
    img = bytearray([r['colbk']]) * (W * H)
    colpf = list(r['colpf']); colbk = r['colbk']; chbase = r['chbase']; hscrol = r['hscrol']; vscrol = r['vscrol']
    chactl = r['chactl']
    if not (r['dmactl'] & 0x20): return bytes(img)
    pc = r['dlist']; y = 0; scan = 0; n_dli = 0; in_vs = False; guard = 0
    def put(row, x, count, c):
        for px in range(max(0, x), min(W, x + count)): img[row * W + px] = c
    while y < H and guard < 1024:
        guard += 1
        op = mem[pc]; pc = (pc + 1) & 0xFFFF; low = op & 15; has_dli = bool(op & 0x80)
        if low == 1:
            target = mem[pc] | mem[(pc + 1) & 0xFFFF] << 8
            if op & 0x40: break
            pc = target; continue
        if low == 0:
            y += ((op >> 4) & 7) + 1
            if has_dli:
                for k, v in (dli[n_dli] if n_dli < len(dli) else {}).items():
                    if k == 'chbase': chbase = v & 0xFC
                    elif k == 'colbk': colbk = v
                    elif k.startswith('colpf'): colpf[int(k[5])] = v
                    elif k == 'hscrol': hscrol = v
                    elif k == 'vscrol': vscrol = v
                n_dli += 1
            continue
        lines_all, nbytes = MODES[low]
        if op & 0x40:
            scan = mem[pc] | mem[(pc + 1) & 0xFFFF] << 8; pc = (pc + 2) & 0xFFFF
        vs = bool(op & 0x20); hs = bool(op & 0x10)
        first, count = 0, lines_all
        if vs and not in_vs: first = min(vscrol & 15, lines_all - 1); count = lines_all - first
        elif not vs and in_vs: count = min((vscrol & 15) + 1, lines_all)
        in_vs = vs
        lines = min(count, H - y)
        shift = (16 - (hscrol & 15)) if hs else 0
        bytes_line = WIDE.get(nbytes, nbytes) if hs else nbytes
        cpb = 4 if nbytes == 40 else 8 if nbytes == 20 else 16   # clocků na bajt
        base = chbase << 8
        for col in range(bytes_line):
            x0 = (col * cpb - shift) * 2
            if x0 <= -cpb * 2 or x0 >= W: continue
            code = mem[(scan + col) & 0xFFFF]
            for line in range(lines):
                row = y + line
                if low in (2, 15):
                    if low == 2:
                        g = base + (code & 0x7F) * 8
                        mask = 0 if (code & 0x80 and chactl & 1) else mem[(g + first + line) & 0xFFFF]
                        if code & 0x80 and chactl & 2: mask ^= 0xFF
                    else:
                        mask = code
                    fg = (colpf[2] & 0xF0) | (colpf[1] & 0x0F); bg = colpf[2]
                    for bit in range(8): put(row, x0 + bit, 1, fg if mask & (0x80 >> bit) else bg)
                elif low == 4:
                    g = base + (code & 0x7F) * 8; byte = mem[(g + first + line) & 0xFFFF]
                    pal = [colbk, colpf[0], colpf[1], colpf[3] if code & 0x80 else colpf[2]]
                    for pair in range(4): put(row, x0 + pair * 2, 2, pal[(byte >> (6 - pair * 2)) & 3])
                elif low in (6, 7):
                    g = base + (code & 0x3F) * 8; cl = first + line
                    mask = mem[(g + (cl >> 1 if low == 7 else cl)) & 0xFFFF]; fg = colpf[code >> 6]
                    for bit in range(8): put(row, x0 + bit * 2, 2, fg if mask & (0x80 >> bit) else colbk)
                elif low in (13, 14):
                    pal = [colbk, colpf[0], colpf[1], colpf[2]]
                    for pair in range(4): put(row, x0 + pair * 2, 2, pal[(code >> (6 - pair * 2)) & 3])
                else:
                    pass   # nepodporovaný režim: pozadí
        scan = (scan + bytes_line) & 0xFFFF; y += lines
        if has_dli:
            for k, v in (dli[n_dli] if n_dli < len(dli) else {}).items():
                if k == 'chbase': chbase = v & 0xFC
                elif k == 'colbk': colbk = v
                elif k.startswith('colpf'): colpf[int(k[5])] = v
                elif k == 'hscrol': hscrol = v
                elif k == 'vscrol': vscrol = v
            n_dli += 1
    return bytes(img)

# --- PAL paleta jen pro PNG na koukání (výpočet jako Atari8Color — ale porovnává se index, ne RGB)
def palette():
    import math
    out = []
    for v in range(256):
        hue, lum = v >> 4, v & 15
        yv = lum / 15
        if hue == 0: r = g = b = yv
        else:
            ang = math.radians(((hue - 1) % 14) * (360 / 14) + 135 + 18.5)   # jen přibližně; na PNG stačí
            u, vv = 0.3 * math.cos(ang), 0.3 * math.sin(ang)
            r = yv + 1.14 * vv; g = yv - 0.395 * u - 0.581 * vv; b = yv + 2.033 * u
        out.append(tuple(max(0, min(255, int(c * 255 + 0.5))) for c in (r, g, b)))
    return out

def png(path, idx):
    pal = palette(); raw = b''
    for y in range(H):
        raw += b'\x00' + b''.join(bytes(pal[idx[y * W + x]]) for x in range(W))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def main():
    root = os.path.join(os.path.dirname(__file__), '..')
    memp = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'build', 'ref', 'caveA.mem.bin')
    regp = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, 'build', 'ref', 'caveA.regs.json')
    mem = open(memp, 'rb').read(); j = json.load(open(regp))
    idx = render(mem, j['registers'], j.get('dli', []))
    out = memp.replace('.mem.bin', '.idx'); open(out, 'wb').write(idx); png(out.replace('.idx', '.png'), idx)
    print('→', out, 'a .png;', len(idx), 'pixelů, barev', len(set(idx)))

if __name__ == '__main__':
    main()
