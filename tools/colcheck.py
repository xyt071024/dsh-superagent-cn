import sys, unicodedata
from unicodedata import east_asian_width

def dw(s):
    w = 0
    for ch in s:
        if east_asian_width(ch) in ('W', 'F'):
            w += 2
        elif unicodedata.combining(ch):
            w += 0
        else:
            w += 1
    return w

def cols(ln):
    out, c = [], 0
    for ch in ln:
        if ch in '│┃┌┐└┘├┤┬┴┼┏┓┗┛┣┫━─↓↕←→':
            out.append(f'{ch}@{c}')
        c += dw(ch)
    return out

zh = open(sys.argv[1], encoding='utf-8').read().split('\n')
ja = open(sys.argv[2], encoding='utf-8').read().split('\n')
b = int(sys.argv[3]) if len(sys.argv) > 3 else None
inb = False
bi = -1
buf = []
for i, ln in enumerate(zh):
    if ln.startswith('```'):
        inb = not inb
        if inb:
            bi += 1
        continue
    if inb and (b is None or bi == b):
        buf.append((bi, i + 1, ln))
inb = False
bi = -1
buf2 = []
for i, ln in enumerate(ja):
    if ln.startswith('```'):
        inb = not inb
        if inb:
            bi += 1
        continue
    if inb and (b is None or bi == b):
        buf2.append((bi, i + 1, ln))
print('idx | ZH cols | JA cols')
for k in range(max(len(buf), len(buf2))):
    z = buf[k] if k < len(buf) else None
    j = buf2[k] if k < len(buf2) else None
    zc = cols(z[2]) if z else []
    jc = cols(j[2]) if j else []
    flag = '' if zc == jc else '  <<<'
    print(f'--- b{k}')
    print(f'  ZH[{z[1] if z else "-"}] w={dw(z[2]) if z else "-"} {zc}')
    print(f'     {z[2] if z else ""}')
    print(f'  JA[{j[1] if j else "-"}] w={dw(j[2]) if j else "-"} {jc}')
    print(f'     {j[2] if j else ""}{flag}')
