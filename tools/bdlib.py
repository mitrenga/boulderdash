#!/usr/bin/env python3
"""bdlib — čtení obrazů Atari 8-bit pro Boulder Dash: ATR (DOS 2 adresář,
řetězené sektory) a binární soubory XEX/AUTORUN.SYS (segmenty $FFFF).
Bez závislostí. Import z tools/*.py."""
import struct, os

ATR_MAGIC = 0x0296

def read_atr(path):
    d = open(path, 'rb').read()
    magic, paras, secsize, parahi = struct.unpack('<HHHB', d[:7])
    if magic != ATR_MAGIC:
        raise ValueError('není ATR')
    body = d[16:]
    return {'secsize': secsize, 'body': body, 'sectors': len(body) // secsize,
            'size': (paras | parahi << 16) * 16}

def atr_sector(img, n):
    s = img['secsize']
    # první tři sektory jsou vždy 128 B i u DD disket
    if s == 256:
        off = (n - 1) * 128 if n <= 3 else 3 * 128 + (n - 4) * 256
        ln = 128 if n <= 3 else 256
    else:
        off, ln = (n - 1) * s, s
    return img['body'][off:off + ln]

def atr_directory(img):
    """Adresář DOS 2 v sektorech 361–368: (flag, sectors, start, name)."""
    out = []
    for sn in range(361, 369):
        sec = atr_sector(img, sn)
        for i in range(0, len(sec), 16):
            e = sec[i:i + 16]
            if len(e) < 16 or e[0] == 0:
                continue
            flag, cnt, start = e[0], struct.unpack('<H', e[1:3])[0], struct.unpack('<H', e[3:5])[0]
            name = e[5:13].decode('latin1').rstrip() + '.' + e[13:16].decode('latin1').rstrip()
            out.append({'flag': flag, 'sectors': cnt, 'start': start, 'name': name, 'deleted': bool(flag & 0x80)})
    return out

def atr_chain(img, start):
    """Řetězené sektory DOS 2: poslední 3 bajty = next (10 bit) + délka."""
    out, s, n = b'', start, 0
    while s and n < 4096:
        b = atr_sector(img, s)
        nxt = ((b[-3] & 3) << 8) | b[-2]
        ln = b[-1] & 0x7f if img['secsize'] == 128 else b[-1]
        out += b[:ln]; s = nxt; n += 1
    return out, n

def atr_boot_image(img):
    """Souvislé bootovací sektory (bajt 1 boot sektoru = počet), pro
    disky bez DOSu."""
    b0 = atr_sector(img, 1)
    nsec = b0[1]; load = struct.unpack('<H', b0[2:4])[0]; init = struct.unpack('<H', b0[4:6])[0]
    data = b''.join(atr_sector(img, n)[:128] for n in range(1, nsec + 1))
    return {'count': nsec, 'load': load, 'init': init, 'data': data}

def parse_xex(f):
    """Segmenty binárního souboru: [(start, end, bytes)]."""
    i, segs = 0, []
    while i + 4 <= len(f):
        if f[i:i + 2] == b'\xff\xff':
            i += 2; continue
        a, b = struct.unpack('<HH', f[i:i + 4]); i += 4
        if b < a:
            break
        segs.append((a, b, f[i:i + b - a + 1])); i += b - a + 1
    return segs

def xex_summary(segs):
    run = init = None; prog = []
    for a, b, d in segs:
        if a == 0x2e0: run = struct.unpack('<H', d[:2])[0]
        elif a == 0x2e2: init = struct.unpack('<H', d[:2])[0]
        else: prog.append((a, b, d))
    return {'run': run, 'init': init, 'segs': prog, 'bytes': sum(len(d) for _, _, d in prog)}

def memory_image(segs):
    """Segmenty poskládané do 64 KB + maska, které bajty jsou zapsané."""
    mem = bytearray(65536); mask = bytearray(65536)
    for a, b, d in segs:
        if a in (0x2e0, 0x2e2): continue
        mem[a:a + len(d)] = d; mask[a:a + len(d)] = b'\x01' * len(d)
    return mem, mask

def load_program(path):
    """Obraz → seznam (jméno souboru uvnitř, segmenty). XEX = jeden;
    ATR = každý soubor z adresáře, který vypadá jako binárka; bez DOSu
    boot obraz."""
    if path.lower().endswith('.xex'):
        return [(os.path.basename(path), parse_xex(open(path, 'rb').read()))]
    img = read_atr(path)
    out = []
    try:
        entries = [e for e in atr_directory(img) if not e['deleted']]
    except Exception:
        entries = []
    for e in entries:
        data, _ = atr_chain(img, e['start'])
        if data[:2] == b'\xff\xff':
            out.append((e['name'], parse_xex(data)))
        else:
            out.append((e['name'], [('raw', data)]))
    if not entries:
        boot = atr_boot_image(img)
        out.append(('boot', [(boot['load'], boot['load'] + len(boot['data']) - 1, boot['data'])]))
    return out


# --- Boulder Dash: referenční program jako obraz paměti za běhu -------------

REFERENCE = os.path.join(os.path.dirname(__file__), '..', 'sources', 'diskette',
                         'Boulder Dash (1984)(First Star Software)(US)[cart version].xex')
RUN_OFFSET = 0x2000   # ★ stub $6C80 kopíruje $2900→$0900: běhová adresa = soubor − $2000

def program_image(path=REFERENCE):
    """★ Obraz paměti za běhu (64 KB) poskládaný z referenčního souboru:
    segment $2900–$6CBF posunutý o −$2000 na $0900–$4CBF, jak ho tam dá
    kopírovací stub. Bez emulátoru — jsou to bajty programu, ne živý stav
    (sady na $4000 tedy nepřepsané animací, $0700–$08FF prázdné)."""
    segs = parse_xex(open(path, 'rb').read())
    mem = bytearray(65536)
    for a, b, d in segs:
        if a in (0x2e0, 0x2e2):
            continue
        lo = a - RUN_OFFSET
        if 0 <= lo and lo + len(d) <= 65536:
            mem[lo:lo + len(d)] = d
    return bytes(mem)

def decode_text(b):
    """Interní kód znaku → text (bit 7 = barva, ne inverze; jen pro čtení
    textů, ne dlaždic)."""
    out = ''
    for x in b:
        c = x & 0x7f
        out += chr(c + 32) if c < 64 else (chr(c) if c < 96 else '~')
    return out
