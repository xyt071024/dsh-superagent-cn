import sys, unicodedata, re
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

path = sys.argv[1]
lines = open(path, encoding='utf-8').read().split('\n')
inb = False
bi = -1
for i, ln in enumerate(lines):
    if ln.startswith('```'):
        inb = not inb
        if inb:
            bi += 1
            print(f"=== block {bi} starts line {i+1}")
        continue
    if not inb:
        continue
    if not ln.strip():
        continue
    # column of each box char
    cols = []
    c = 0
    for ch in ln:
        if ch in '│┃┏┓┗┛┌┐└┘├┤┬┴┼─━':
            cols.append((c, ch))
        c += dw(ch)
    print(f"{i+1:5d} w={dw(ln):3d} {cols}  |{ln}")
