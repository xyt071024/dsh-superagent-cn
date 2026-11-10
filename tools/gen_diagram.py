import unicodedata
from unicodedata import east_asian_width

def dw(s):
    return sum(2 if east_asian_width(c) in ('W', 'F') else (0 if unicodedata.combining(c) else 1) for c in s)

def pad_to(s, width):
    d = width - dw(s)
    assert d >= 0, (s, dw(s), width)
    return s + ' ' * d

def center(s, width):
    d = width - dw(s)
    left = d // 2
    return ' ' * left + s + ' ' * (d - left)

L = []
# top box: left edge 5, inner 22  => right edge 28, center 16
left, inner = 5, 22
right = left + inner + 1
L.append(' ' * left + '┌' + '─' * inner + '┐')
L.append(' ' * left + '│' + center('メインセッション', inner) + '│')
# bottom edge with T-join at 16
tb = ' ' * left + '└' + '─' * (16 - left - 1) + '┬' + '─' * (right - 16 - 1) + '┘'
L.append(tb)
# branch line: corner at 7, T at 16, corner at 25
L.append(' ' * 7 + '┌' + '─' * (16 - 7 - 1) + '┼' + '─' * (25 - 16 - 1) + '┐')
L.append(' ' * 7 + '↓' + ' ' * (16 - 7 - 1) + '↓' + ' ' * (25 - 16 - 1) + '↓')
# three sub boxes at 4, 13, 22 ; width 7
starts = [4, 13, 22]
L.append(''.join(' ' * (s - (starts[i - 1] + 7 if i else 0)) + '┌─────┐' for i, s in enumerate(starts)))
row = ''
prev_end = 0
cells = ['│  A  │', '│  B  │', '│  C  │']
for i, (s, c) in enumerate(zip(starts, cells)):
    row += ' ' * (s - prev_end) + c
    prev_end = s + 7
    if i < 2:
        row += '←→'
        prev_end += 2
L.append(row)
L.append(''.join(' ' * (s - (starts[i - 1] + 7 if i else 0)) + '└─────┘' for i, s in enumerate(starts)))
v = ''
prev = 0
for i, s in enumerate(starts):
    c = s + 3
    v += ' ' * (c - prev) + '↕'
    prev = c + 1
L.append(v)
# board box: 3 .. 29  inner 25, center 16
bl, bi = 3, 25
br = bl + bi + 1
L.append(' ' * bl + '┌' + '─' * bi + '┐')
L.append(' ' * bl + '│' + center('共有タスクボード', bi) + '│')
L.append(' ' * bl + '│' + center('（誰が何を・進捗）', bi) + '│')
L.append(' ' * bl + '└' + '─' * bi + '┘')

out = '\n'.join(L)
print(out)
print('---- widths ----')
for ln in L:
    print(dw(ln), ln)
