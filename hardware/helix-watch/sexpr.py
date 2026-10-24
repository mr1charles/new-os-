"""Tiny KiCad s-expression reader/writer (just enough to place library footprints on a board)."""
import re

_TOKEN = re.compile(r'\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))')


class Str(str):
    """A quoted atom."""


def parse(text):
    stack, cur = [], []
    pos = 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            break
        pos = m.end()
        if m.group(1):
            stack.append(cur)
            cur = []
        elif m.group(2):
            done, cur = cur, stack.pop()
            cur.append(done)
        elif m.group(3) is not None:
            cur.append(Str(m.group(3)))
        else:
            cur.append(m.group(4))
    return cur[0]


def dump(node, indent=0):
    if isinstance(node, Str):
        return '"' + node + '"'      # library text arrives still escaped, so write it back verbatim
    if not isinstance(node, (list, tuple)):
        return str(node)
    pad = '\t' * indent
    if all(not isinstance(c, list) for c in node):
        return '(' + ' '.join(dump(c) for c in node) + ')'
    out = '(' + ' '.join(dump(c) for c in node if not isinstance(c, list))
    for c in node:
        if isinstance(c, list):
            out += '\n' + pad + '\t' + dump(c, indent + 1)
    return out + '\n' + pad + ')'


def find(node, name):
    return [c for c in node if isinstance(c, list) and c and c[0] == name]
