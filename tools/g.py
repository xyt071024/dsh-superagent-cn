import unicodedata
from unicodedata import east_asian_width

W = 63
IN = 61
SL, SR = 3, 58
SIN = 54


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


def O(left='', right=None, indent=2, tail=1):
    if right is None:
        return '│' + pad(' ' * indent + left, IN) + '│'
    gap = IN - indent - dw(left) - dw(right) - tail
    if gap < 1:
        raise ValueError(f'no room: {left!r} .. {right!r} (gap {gap})')
    return '│' + pad(' ' * indent + left + ' ' * gap + right + ' ' * tail, IN) + '│'


def rule(kind='mid'):
    return {'top': '┌' + '─' * IN + '┐', 'mid': '├' + '─' * IN + '┤',
            'bot': '└' + '─' * IN + '┘'}[kind]


def blank():
    return '│' + ' ' * IN + '│'


def stop(title):
    body = '━ ' + title + ' '
    return '│' + '  ' + '┏' + body + '━' * (SIN - dw(body)) + '┓' + ' ' * 3 + '│'


def S(left='', right=None, indent=1, tail=1):
    if right is None:
        body = ' ' * indent + left
    else:
        gap = SIN - indent - dw(left) - dw(right) - tail
        if gap < 1:
            raise ValueError(f'no room in sub: {left!r} .. {right!r} (gap {gap})')
        body = ' ' * indent + left + ' ' * gap + right + ' ' * tail
    return '│' + '  ' + '┃' + pad(body, SIN) + '┃' + ' ' * 3 + '│'


def SB():
    return '│' + '  ' + '┃' + ' ' * SIN + '┃' + ' ' * 3 + '│'


def SBOT():
    return '│' + '  ' + '┗' + '━' * SIN + '┛' + ' ' * 3 + '│'
