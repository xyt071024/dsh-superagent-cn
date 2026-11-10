import sys, unicodedata, io
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

out = []
t = open(sys.argv[1], encoding='utf-8').read().split('\n')
inb = False
bi = -1
for i, l in enumerate(t):
    if l.startswith('```'):
        inb = not inb
        if inb:
            bi += 1
            out.append(f'=== block {bi} line {i+1}')
        continue
    if inb:
        out.append(f'{i+1:4d} w={dw(l):3d} |{l}')
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(out))
print('ok', len(out))
