#!/usr/bin/env python3
"""matchimage — vytáhne program ze všech obrazů v sources/diskette/ a
porovná ho bajt po bajtu s referencí (cart version, $2900–$6CBF, 17 344 B).

Umí: DOS 2 disketu (AUTORUN.SYS), XEX, k-file disketu (zavaděč 3 sektory,
za ním XEX v sektorech 4+), boot disketu (souvislé boot sektory) a disketu
s vlastním zavaděčem (program hledá jako surové sektory). U relokovaných
variant najde posun hlasováním 24bajtových vzorků a počítá rozdíly po
posunu. Report: kontrol / rozdílů = jen obrazy téže rodiny na téže adrese
(posun 0); relokované rodiny jsou informace, ne kontrola."""
import sys, os, glob, collections
sys.path.insert(0, os.path.dirname(__file__))
import bdlib

ROOT = os.path.join(os.path.dirname(__file__), '..', 'sources', 'diskette')
REF = 'Boulder_Dash_1984_First_Star_Software_US.atr'
LO, HI = 0x2900, 0x6CC0

def ref_program():
    for name, segs in bdlib.load_program(os.path.join(ROOT, REF)):
        if name == 'AUTORUN.SYS':
            mem, _ = bdlib.memory_image(segs); return bytes(mem[LO:HI])
    raise SystemExit('reference nenalezena')

def variants(path):
    """→ [(popis, mem bytes 64K, mask)] – všechny programy v obrazu."""
    out = []
    if path.lower().endswith('.xex'):
        segs = bdlib.parse_xex(open(path, 'rb').read())
        m, k = bdlib.memory_image(segs); return [('xex', m, k, bdlib.xex_summary(segs))]
    img = bdlib.read_atr(path); b0 = bdlib.atr_sector(img, 1)
    entries = [e for e in bdlib.atr_directory(img) if not e['deleted']]
    if entries:
        for e in entries:
            data, _ = bdlib.atr_chain(img, e['start'])
            if data[:2] == b'\xff\xff':
                segs = bdlib.parse_xex(data); m, k = bdlib.memory_image(segs)
                out.append((e['name'], m, k, bdlib.xex_summary(segs)))
        return out
    raw = b''.join(bdlib.atr_sector(img, n) for n in range(1, img['sectors'] + 1))
    after = b''.join(bdlib.atr_sector(img, n) for n in range(b0[1] + 1, img['sectors'] + 1))
    if after[:2] == b'\xff\xff':
        segs = bdlib.parse_xex(after); m, k = bdlib.memory_image(segs)
        return [('k-file', m, k, bdlib.xex_summary(segs))]
    boot = bdlib.atr_boot_image(img)
    if boot['count'] > 8:
        m = bytearray(65536); k = bytearray(65536)
        m[boot['load']:boot['load'] + len(boot['data'])] = boot['data']
        k[boot['load']:boot['load'] + len(boot['data'])] = b'\x01' * len(boot['data'])
        return [('boot %d sektorů' % boot['count'], m, k, {'run': boot['init'], 'init': None, 'segs': [(boot['load'], boot['load'] + len(boot['data']) - 1, None)], 'bytes': len(boot['data'])})]
    # vlastní zavaděč: program jako surové sektory kdekoli na disku
    m = bytearray(65536); k = bytearray(65536)
    n = min(len(raw), 65536 - LO); m[LO:LO + n] = raw[:n]; k[LO:LO + n] = b'\x01' * n
    return [('surové sektory (zavaděč %d B)' % (boot['count'] * 128), m, k, {'run': None, 'init': None, 'segs': [], 'bytes': len(raw), 'raw': True})]

def shift(ref, mem):
    votes = collections.Counter(); m = bytes(mem)
    for kk in range(0, len(ref) - 24, len(ref) // 200):
        c = ref[kk:kk + 24]
        if len(set(c)) < 4: continue
        i = m.find(c)
        if i >= 0: votes[i - (LO + kk)] += 1
    return votes.most_common(1)[0] if votes else (None, 0)

def main():
    ref = ref_program(); checks = diffs = 0
    files = sorted(glob.glob(os.path.join(ROOT, '*.atr')) + glob.glob(os.path.join(ROOT, '*.xex')))
    for p in files:
        for what, mem, mask, s in variants(p):
            d, votes = shift(ref, mem)
            label = os.path.basename(p).replace('Boulder Dash (1984)(First Star Software)(US)', '…')
            run = f"RUN ${s['run']:04X}" if s.get('run') is not None else ''
            if d is None:
                print(f"{label:34} {what:28} {s['bytes']:6} B {run:10} — program nenalezen"); continue
            both = dd = 0
            for a in range(LO, HI):
                b = a + d
                if 0 <= b < 65536 and mask[b]:
                    both += 1; dd += mem[b] != ref[a - LO]
            # kontrola = týž program na téže adrese: posun 0, nebo surové sektory
            # (posun je poloha na disku, ne relokace) — a jen když se najde
            # naprostá většina vzorků (hacky s jinými jeskyněmi mají ~70/200)
            control = (d == 0 or s.get('raw')) and votes >= 150
            if control: checks += both; diffs += dd
            segtxt = ' '.join(f"${a:04X}-${b:04X}" for a, b, _ in s['segs'][:2]) + (' …' if len(s['segs']) > 2 else '')
            print(f"{label:34} {what:28} {s['bytes']:6} B {run:10} {segtxt:24} posun {d:+6} ({votes:3} hlasů)  překryv {both:5}, rozdílů {dd:5}{'  ← kontrola' if control else ''}")
    print(f"\nmatchimage.py: {checks} kontrol, {diffs} rozdílů (reference {REF}, program ${LO:04X}–${HI-1:04X}, posun 0)")

if __name__ == '__main__':
    main()
