import sys, unicodedata

def dw(s):
    w = 0
    for ch in s:
        if unicodedata.east_asian_width(ch) in ('W', 'F'):
            w += 2
        elif unicodedata.combining(ch):
            w += 0
        else:
            w += 1
    return w

def blocks(path):
    out, cur, inb = [], None, False
    for ln in open(path, encoding='utf-8').read().split('\n'):
        if ln.startswith('```'):
            if not inb:
                inb = True; cur = []
            else:
                inb = False; out.append(cur); cur = None
            continue
        if inb:
            cur.append(ln)
    return out

a = blocks(sys.argv[1]); b = blocks(sys.argv[2])
print(f"blocks: zh={len(a)} ja={len(b)}")
bad = 0
for bi, (ba, bb) in enumerate(zip(a, b)):
    if len(ba) != len(bb):
        print(f"[block {bi}] LINE COUNT {len(ba)} vs {len(bb)}")
    for li, (la, lb) in enumerate(zip(ba, bb)):
        wa, wb = dw(la), dw(lb)
        if wa != wb:
            bad += 1
            print(f"[b{bi} l{li}] w{wa}->{wb}")
            print(f"   ZH: {la}")
            print(f"   JA: {lb}")
print(f"mismatches: {bad}")
