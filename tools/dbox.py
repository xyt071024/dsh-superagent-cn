# -*- coding: utf-8 -*-
"""Render abstract rows into a fixed-width ASCII panel.

The canvas width is computed from the widest row but capped at MAXW; rows that
would overflow are reported so the text can be shortened instead of the frame
silently stretching.
"""
import unicodedata
from unicodedata import east_asian_width

MAXW = 63          # target outer width, matching the Chinese source panels


def dw(s):
    return sum(2 if east_asian_width(c) in ('W', 'F')
               else (0 if unicodedata.combining(c) else 1) for c in s)


def pad(text, width, where=''):
    d = width - dw(text)
    if d < 0:
        raise ValueError(f'{where}: too wide ({dw(text)} > {width}): {text!r}')
    return text + ' ' * d


class Row:
    def __init__(self, kind, a='', b=None, indent=2, tail=2):
        self.kind, self.a, self.b = kind, a, b
        self.indent, self.tail = indent, tail

    def need_sub(self):
        if self.kind != 'text':
            return 0
        w = self.indent + dw(self.a)
        if self.b is not None:
            w += dw(self.b) + self.tail + 1
        return w

    def need_out(self):
        if self.kind in ('kv', 'title'):
            w = self.indent + dw(self.a)
            if self.b is not None:
                w += dw(self.b) + self.tail + 1
            return w
        return 0


def R_u(text='', right=None, indent=2, tail=2):
    return Row('kv', text, right, indent, tail)


def R_t(text=''):
    return Row('title', text)


def R_s(text='', right=None, indent=1, tail=1):
    return Row('text', text, right, indent, tail)


BLANK_ROW = Row('blank')
SUB_BLANK_ROW = Row('text', '__subblank__')
SUB_CLOSE_ROW = Row('text', '__subclose__')


def render(rows, split=None, head=('', ''), maxw=MAXW, label=''):
    need_kv = max([r.need_out() for r in rows] + [0])
    need_sub = max([r.need_sub() for r in rows] + [0])

    if split is not None:
        need_l = max([dw(r.a) for r in rows if r.kind == 'nav'] + [dw(head[0])]) + 2
        need_r = max([dw(r.b or '') for r in rows if r.kind == 'nav']
                     + [dw(head[1])]) + 2
        lw = need_l
        rw = max(need_r, 30)
        inn = lw + rw + 1
        if inn + 2 > maxw:
            raise ValueError(f'{label}: split frame wants {inn + 2} > {maxw}')
        out = ['┌' + '─' * lw + '┬' + '─' * rw + '┐',
               '│' + pad(' ' + head[0], lw) + '│' + pad(' ' + head[1], rw) + '│',
               '├' + '─' * lw + '┼' + '─' * rw + '┤']
        for r in rows:
            out.append('│' + pad(' ' + r.a, lw) + '│' + pad(' ' + r.b, rw) + '│')
        out.append('└' + '─' * lw + '┴' + '─' * rw + '┘')
    else:
        inn = max(need_kv, need_sub + 7)
        if inn + 2 > maxw:
            worst = max([r for r in rows if r.need_sub() > maxw - 9] or
                        [r for r in rows if r.need_out() > maxw - 2],
                        key=lambda r: max(r.need_sub(), r.need_out()))
            raise ValueError(
                f'{label}: width {inn + 2} > {maxw}, worst row: {worst.a!r}')
        sin = inn - 7
        out = []
        for r in rows:
            if r.kind == 'rule':
                out.append({'top': '┌' + '─' * inn + '┐',
                            'mid': '├' + '─' * inn + '┤',
                            'bot': '└' + '─' * inn + '┘'}[r.a])
            elif r.kind == 'blank':
                out.append('│' + ' ' * inn + '│')
            elif r.kind == 'title':
                out.append('│' + pad(' ' * r.indent + r.a, inn) + '│')
            elif r.kind == 'kv':
                if r.b is None:
                    out.append('│' + pad(' ' * r.indent + r.a, inn) + '│')
                else:
                    gap = inn - r.indent - dw(r.a) - dw(r.b) - r.tail
                    out.append('│' + ' ' * r.indent + r.a + ' ' * gap + r.b
                               + ' ' * r.tail + '│')
            elif r.kind == 'subtitle':
                body = '━ ' + r.a + ' '
                out.append('│  ┏' + body + '━' * (sin - dw(body)) + '┓   │')
            elif r.kind == 'text':
                if r.a == '__subclose__':
                    out.append('│  ┗' + '━' * sin + '┛   │')
                elif r.a == '__subblank__':
                    out.append('│  ┃' + ' ' * sin + '┃   │')
                elif r.b is None:
                    out.append('│  ┃' + pad(' ' * r.indent + r.a, sin) + '┃   │')
                else:
                    gap = sin - r.indent - dw(r.a) - dw(r.b) - r.tail
                    out.append('│  ┃' + ' ' * r.indent + r.a + ' ' * gap
                               + r.b + ' ' * r.tail + '┃   │')
        out.append('└' + '─' * inn + '┘')
    w = dw(out[0])
    for ln in out:
        if dw(ln) != w:
            raise AssertionError(f'{label}: ragged {dw(ln)} != {w}: {ln!r}')
    return '```\n' + '\n'.join(out) + '\n```'
