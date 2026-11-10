"""Re-align box-drawing code blocks in JA docs to the ZH source widths.

For every fenced block that contains a vertical border (│ or ┃), each JA line is
padded/trimmed so its display width equals the corresponding ZH line.  Padding is
inserted into the longest run of spaces (or ━) on that line, which keeps inner
columns and right-aligned widgets in place.
"""
import sys, unicodedata
from unicodedata import east_asian_width

BOX = set('\u2500\u2501\u2502\u2503\u250c\u250d\u250e\u250f'
          '\u2510\u2511\u2512\u2513\u2514\u2515\u2516\u2517'
          '\u2518\u2519\u251a\u251b\u251c\u251d\u251e\u251f'
          '\u2520\u2521\u2522\u2523\u2524\u2525\u2526\u2527'
          '\u2528\u2529\u252a\u252b\u252c\u252d\u252e\u252f'
          '\u2530\u2531\u2532\u2533\u2534\u2535\u2536\u2537'
          '\u2538\u2539\u253a\u253b\u253c\u253d\u253e\u253f'
          '\u2540\u2541\u2542\u2543\u2544\u2545\u2546\u2547'
          '\u2548\u2549\u254a\u254b\u254c\u254d\u254e\u254f'
          '\u2550\u2551\u2552\u2553\u2554\u2555\u2556\u2557'
          '\u2558\u2559\u255a\u255b\u255c\u255d\u255e\u255f'
          '\u2560\u2561\u2562\u2563\u2564\u2565\u2566\u2567'
          '\u2568\u2569\u256a\u256b\u256c\u256d\u256e\u256f'
          '\u2570\u2571\u2572\u2573')


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


def blocks(text):
    out, cur, inb = [], None, False
    lines = text.split('\n')
    marks = []
    for idx, ln in enumerate(lines):
        if ln.startswith('```'):
            if not inb:
                inb = True
                cur = []
                start = idx
            else:
                inb = False
                out.append((start, cur))
                cur = None
            continue
        if inb:
            cur.append(ln)
    return lines, out


def runs(line, ch):
    """(start_idx, length) for runs of ch, by character index."""
    res, i = [], 0
    while i < len(line):
        if line[i] == ch:
            j = i
            while j < len(line) and line[j] == ch:
                j += 1
            res.append((i, j - i))
            i = j
        else:
            i += 1
    return res


def adjust(line, delta, filler):
    """Insert (delta>0) or remove (delta<0) filler chars from the longest run."""
    rs = runs(line, filler)
    if not rs:
        return None
    # skip a run that is only the leading indentation of the line
    lead = len(line) - len(line.lstrip(' '))
    cand = [r for r in rs if not (r[0] == 0)]
    if not cand:
        return None
    if delta > 0:
        i, n = max(cand, key=lambda r: r[1])
        return line[:i + n] + filler * delta + line[i + n:]
    need = -delta
    big = [r for r in cand if r[1] >= need]
    if not big:
        return None
    i, n = max(big, key=lambda r: r[1])
    cut = min(need, n)
    line = line[:i] + line[i + cut:]
    return line


def fix(zh_text, ja_text, name):
    zh_lines, zb = blocks(zh_text)
    ja_lines, jb = blocks(ja_text)
    report = []
    if len(zb) != len(jb):
        report.append(f'  !! block count {len(zb)} vs {len(jb)}')
    for bi, ((zs, zl), (js, jl)) in enumerate(zip(zb, jb)):
        joined = '\n'.join(zl)
        if '│' not in joined and '┃' not in joined:
            continue
        out = []
        for k, ln in enumerate(jl):
            tgt = dw(zl[k]) if k < len(zl) else None
            if tgt is None or not ln.strip():
                out.append(ln)
                continue
            w = dw(ln)
            if w == tgt:
                out.append(ln)
                continue
            delta = tgt - w
            filler = ' ' if ' ' in ln else '━'
            fixed = adjust(ln, delta, ' ') or adjust(ln, delta, '━')
            if fixed is None or dw(fixed) != tgt:
                report.append(f'  !! b{bi} l{js + k + 1} w={w} tgt={tgt}')
                out.append(ln)
            else:
                out.append(fixed)
        for k, ln in enumerate(out):
            ja_lines[js + k + 1] = ln
    return '\n'.join(ja_lines), report


def main():
    zh = open(sys.argv[1], encoding='utf-8').read()
    ja = open(sys.argv[2], encoding='utf-8').read()
    fixed, report = fix(zh, ja, sys.argv[2])
    if '--write' in sys.argv:
        open(sys.argv[2], 'w', encoding='utf-8').write(fixed)
    for r in report:
        print(r)
    print(f'{sys.argv[2]}: {len(report)} unresolved')


main()
