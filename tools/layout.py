"""Layout helpers for the settings-UI diagrams.

Every diagram is built on one 63-column grid:
  outer frame   : border glyphs at columns 0 and 62 (inner width 61)
  sub-box frame : border glyphs at columns 3 and 58 (inner width 54)
Rows longer than the grid raise an error instead of silently overflowing.
"""
import unicodedata
from unicodedata import east_asian_width

W = 63
IN = W - 2          # 61
SL, SR = 3, 58      # sub-box borders
SIN = SR - SL - 1   # 54


def dw(s):
    return sum(2 if east_asian_width(c) in ('W', 'F')
               else (0 if unicodedata.combining(c) else 1) for c in s)


def pad(text, width):
    d = width - dw(text)
    if d < 0:
        raise ValueError(f'too wide ({dw(text)}>{width}): {text!r}')
    return text + ' ' * d


def center(text, width):
    d = width - dw(text)
    if d < 0:
        raise ValueError(f'too wide ({dw(text)}>{width}): {text!r}')
    l = d // 2
    return ' ' * l + text + ' ' * (d - l)


def row(text=''):
    """A plain content row inside the outer frame."""
    return '│' + pad(' ' + text if text and not text.startswith(' ') else text, IN) + '│'


def rule(kind='mid'):
    return {'top': '┌' + '─' * IN + '┐',
            'mid': '├' + '─' * IN + '┤',
            'bot': '└' + '─' * IN + '┘'}[kind]


def blank():
    return '│' + ' ' * IN + '│'


# --- sub-boxes -------------------------------------------------------------

def sub_top(title):
    head = '━ ' + title + ' '
    return '│  ┏' + pad(head, 0) + '━' * (SIN - dw(head)) + '┓' + '   │'


def sub_row(text=''):
    return '│  ┃' + pad(' ' + text if text and not text.startswith(' ') else text, SIN) + '┃' + '   │'


def sub_pad():
    return '│  ┃' + ' ' * SIN + '┃' + '   │'


def sub_bot():
    return '│  ┗' + '━' * SIN + '┛' + '   │'


# --- two-column frames -----------------------------------------------------

def two(top_border, split, left_text=None, right_text=None, heights=None):
    """Build a 2-column frame; returns list of lines."""
    left_w = split - 1
    right_w = W - split - 2
    out = [top_border]
    out.append('│' + pad(' ' + (left_text or ''), left_w) + '│'
               + pad(' ' + (right_text or ''), right_w) + '│')
    out.append('├' + '─' * left_w + '┬' + '─' * right_w + '┤')
    return out, left_w, right_w


def two_row(left, right, left_w, right_w):
    return '│' + pad(' ' + left, left_w) + '│' + pad(' ' + right, right_w) + '│'


def two_blank(left_w, right_w):
    return '│' + ' ' * left_w + '│' + ' ' * right_w + '│'
