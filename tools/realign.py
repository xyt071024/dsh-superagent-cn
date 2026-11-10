"""Elastic realignment of translated ASCII/box diagrams.

Every *closed* box row (starts and ends with a border glyph) is split at its
border glyphs, and each segment is stretched or shrunk to exactly the display
width the source line gives that segment.  Vertical borders therefore land on
the same columns as in the source, so the drawing keeps its shape.

Stretching inserts characters into the longest run of spaces / ─ / ━ in the
segment (so title bars grow with ━ and right-aligned widgets keep their edge);
shrinking removes characters from the longest run that is long enough.
"""
import sys, unicodedata
from unicodedata import east_asian_width

BORDER = set('│┃┌┐└┘├┤┬┴┼┏┓┗┛┣┫')
FILL = set('─━')


def dw(s):
    return sum(2 if east_asian_width(c) in ('W', 'F')
               else (0 if unicodedata.combining(c) else 1) for c in s)


def segments(line):
    out, cur = [], ''
    for ch in line:
        if ch in BORDER:
            if cur:
                out.append(('seg', cur))
                cur = ''
            out.append(('b', ch))
        else:
            cur += ch
    if cur:
        out.append(('seg', cur))
    return out


def runs_of(text, chars):
    res, i = [], 0
    while i < len(text):
        if text[i] in chars:
            j = i
            while j < len(text) and text[j] in chars:
                j += 1
            res.append((i, j - i))
            i = j
        else:
            i += 1
    return res


def stretch(text, delta):
    rs = runs_of(text, ' ') + runs_of(text, FILL)
    if not rs:
        return None
    i, n = max(rs, key=lambda r: r[1])
    return text[:i + n] + text[i] * delta + text[i + n:]


def shrink(text, need):
    rs = runs_of(text, ' ') + runs_of(text, FILL)
    cand = [r for r in rs if r[1] >= need and r[1] >= 1]
    if not cand:
        return None
    # prefer a run of plain spaces when equally usable, otherwise the longest
    cand.sort(key=lambda r: (r[1], text[r[0]] == ' '), reverse=True)
    i, n = cand[0]
    return text[:i] + text[i + need:]


def fit(text, target):
    w = dw(text)
    if w == target:
        return text, None
    if w < target:
        out = stretch(text, target - w)
        if out is None:
            return text, f'cannot stretch {text.strip()!r}'
        return out, None
    out = shrink(text, w - target)
    if out is None:
        return text, f'cannot shrink {w}->{target}: {text.strip()!r}'
    return out, None


def is_box_row(line):
    s = line.strip()
    return len(s) >= 2 and s[0] in BORDER and s[-1] in BORDER


def align_row(zh, ja):
    zs, js = segments(zh), segments(ja)
    if len(zs) != len(js):
        return ja, f'border count {len(zs)} vs {len(js)}'
    out = []
    for (zk, zt), (jk, jt) in zip(zs, js):
        if zk == 'b':
            if zt != jt:
                return ja, f'glyph {zt!r} vs {jt!r}'
            out.append(jt)
        else:
            new, err = fit(jt, dw(zt))
            if err:
                return ja, err
            out.append(new)
    return ''.join(out), None


def blocks(text):
    lines = text.split('\n')
    out, inb, cur = [], False, None
    for i, ln in enumerate(lines):
        if ln.startswith('```'):
            if not inb:
                inb, cur = True, []
            else:
                inb = False
                out.append((i, cur))
            continue
        if inb:
            cur.append(ln)
    return lines, out


def main():
    zh = open(sys.argv[1], encoding='utf-8').read()
    ja = open(sys.argv[2], encoding='utf-8').read()
    _, zb = blocks(zh)
    jl, jb = blocks(ja)
    problems = []
    if len(zb) != len(jb):
        problems.append(f'block count {len(zb)} vs {len(jb)}')
    for bi, ((_, zlines), (js, jlines)) in enumerate(zip(zb, jb)):
        if len(zlines) != len(jlines):
            problems.append(f'b{bi}: line count {len(zlines)} vs {len(jlines)}')
        for k, jln in enumerate(jlines):
            if k >= len(zlines) or not jln.strip():
                continue
            if not is_box_row(jln):
                continue
            if not is_box_row(zlines[k]):
                problems.append(f'b{bi} l{js + k + 2}: source is not a box row')
                continue
            new, err = align_row(zlines[k], jln)
            if err:
                problems.append(f'b{bi} l{js + k + 2}: {err}')
            jl[js + k + 1] = new
    text = '\n'.join(jl)
    if '--write' in sys.argv:
        open(sys.argv[2], 'w', encoding='utf-8').write(text)
    for p in problems:
        print(p)
    print(f'{sys.argv[2]}: {len(problems)} problems')


main()
