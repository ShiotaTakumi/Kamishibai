#!/usr/bin/env python3
"""Report the reading order of numbered statements in html/slide.src.html or in a draft of the
Kamishibai engine (engine/kamishibai.js; pages <cover>, <slide>, <divider>).

For each numbered statement (定理 1, 補題 2・3, 定義 4–6, ...; the kinds are set by --kinds):
the slide where it is stated, the first slide that uses it, and the slides where its proof starts
(a 証明の方針 box or a proof box) and ends, counting the proofs of later
statements that the proof uses. Warn-only; exit code is always 0.

Warnings:
  FORWARD   used (outside a 証明の方針 box) before it is stated
  EARLY     stated more than --gap slides before its proof starts
            (the reader holds an unproved statement through unrelated slides)
  DEFERRED  used in an argument before its proof, although the proof is short
            (at most --short slides), so it could have been proved first

A statement is the title of a box (div.blk, div.pf, div.ph; see html/slide.src.html; in an engine draft
the title attribute of <block>, <alertblock>, <exampleblock>, <proof>, <plan>, <later>) that starts
with a kind and a number. A box titled 証明 or 証明の方針 proves the last statement on its slide,
or the statement named in the frame title ("補題 2 の証明"); "補題 2 の証明" as a box title works too.
A div.ph box states a claim whose proof comes later. References are "kind number" in the text. A draft whose
numbers the engine gives (<html numbering="…">) is read with those numbers and references (tools/numbering.py).

Usage: python3 tools/check_order.py [src.html] [--sec PREFIX] [--kinds 定理,補題,主張,定義]
                                    [--gap 3] [--short 2]
"""
import argparse
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numbering  # noqa: E402

SRC = Path(__file__).resolve().parent.parent / 'html' / 'slide.src.html'
KIND, REF = None, None
ONE = r'(?:[A-Z]\.)?\d+(?:\.\d+)*'  # 3, 3.1, A.1
NUM = '(' + ONE + '(?:[・–]' + ONE + ')*)'
# full-width digits and dashes count as ASCII (補題１ = 補題 1); the space after the kind is optional
WIDE = str.maketrans('０１２３４５６７８９－', '0123456789–')


def expand(nums):
    out = []
    for part in nums.split('・'):
        if '–' in part:
            a, b = part.split('–')
            p, a = a.rpartition('.')[::2]  # 2.6–2.8 = 2.6, 2.7, 2.8
            p += '.' if p else ''
            out += [p + str(i) for i in range(int(a), int(b.rpartition('.')[2]) + 1)]
        else:
            out.append(part)
    return out


def number_key(n):
    return [(0, int(p), '') if p.isdigit() else (1, 0, p) for p in n.split('.')]


def slides_of(src, sec):
    # every <section class="slide ..."> (the title slide too), numbered as on screen
    secs = re.split(r'<section class="slide[\s"]', src)[1:]
    cur, out = None, []
    for n, x in enumerate(secs, 1):
        m = re.search(r'data-sec="([^"]*)"', x.split('>', 1)[0])
        if m:
            cur = m.group(1)
        if not sec or (cur and cur.startswith(sec)):
            out.append((n, x))
    return out


ENGINE_PAGE = re.compile(r'<(cover|slide|divider)\b((?:"[^"]*"|\'[^\']*\'|[^>"\'])*)>')
ENGINE_BOX = re.compile(r'<(block|alertblock|exampleblock|proof|plan|later)\b((?:"[^"]*"|\'[^\']*\'|[^>"\'])*)>')
ENGINE_KIND = {'block': 'blk', 'alertblock': 'blk', 'exampleblock': 'blk', 'proof': 'pf', 'plan': 'pf pl', 'later': 'ph'}
ENGINE_TITLE = {'proof': '証明', 'plan': '証明の方針'}


def attr(attrs, name):
    m = re.search(r'\s' + name + r'\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', attrs)
    return None if not m else (m.group(1) if m.group(1) is not None else m.group(2))


def engine_slides_of(src, sec):
    """Pages of an engine draft as (number, heading, text), numbered as on screen."""
    src = re.sub(r'<!--.*?-->|<script\b.*?</script>', '', src, flags=re.S)
    ms = list(ENGINE_PAGE.finditer(src))
    cur, out = None, []
    for n, m in enumerate(ms, 1):
        end = ms[n].start() if n < len(ms) else len(src)
        s = attr(m.group(2), 'sec')
        if s:
            cur = s
        if not sec or (cur and cur.startswith(sec)):
            out.append((n, attr(m.group(2), 'title') or '', src[m.end():end]))
    return out


def engine_boxes(x):
    ms = list(ENGINE_BOX.finditer(x))
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(x)
        title = attr(m.group(2), 'title')
        if title is None:
            title = ENGINE_TITLE.get(m.group(1))
        if title is not None:
            yield ENGINE_KIND[m.group(1)], title, x[m.end():end]


def boxes(x):
    """Yield (kind, title, body) for each titled box in document order."""
    pat = re.compile(r'<div class="(blk|pf pl|pf|ph)[^"]*"[^>]*>\s*<div class="(?:bt|pt)">(.*?)</div>', re.S)
    ms = list(pat.finditer(x))
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(x)
        yield m.group(1), m.group(2), x[m.end():end]


def main():
    global KIND, REF
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?', default=SRC, type=Path)
    ap.add_argument('--sec', default='', help='only the slides whose data-sec starts with this')
    ap.add_argument('--kinds', default='定理,補題,主張,定義', help='comma-separated, in sort order')
    ap.add_argument('--gap', type=int, default=3)
    ap.add_argument('--short', type=int, default=2)
    a = ap.parse_args()
    kinds = a.kinds.split(',')
    KIND = '(' + '|'.join(map(re.escape, kinds)) + ')'
    REF = re.compile(KIND + r' ?' + NUM)

    stated, uses, pstart, pend, deps = {}, {}, {}, {}, {}
    text = a.src.read_text(encoding="utf-8")
    if re.search(r'kamishibai\.js', text):  # the numbers the engine gives (<html numbering="…">)
        text = numbering.expand(text, numbering.kinds_of(text, a.src))
    text = text.translate(WIDE)
    if re.search(r'kamishibai\.js', text):
        pages = [(n, html.unescape(h), x, engine_boxes(x)) for n, h, x in engine_slides_of(text, a.sec)]
    else:
        pages = []
        for n, x in slides_of(text, a.sec):
            h2 = re.search(r'<h2>(.*?)</h2>', x)
            h2 = html.unescape(re.sub(r'<[^>]+>', '', h2.group(1))) if h2 else ''
            pages.append((n, h2, x, boxes(x)))
    for n, h2, x, bxs in pages:
        last_lemma = None
        for kind, title, body in bxs:
            t = html.unescape(re.sub(r'<[^>]+>', '', title)).strip()
            if t in ('証明', '証明の方針'):
                # a bare title belongs to the last statement on the slide, else to the heading
                hm = re.match(KIND + r' ?' + NUM + r' ?の証明', h2)
                if last_lemma:
                    t = f'{last_lemma} の{t}'
                elif hm:
                    t = f'{hm.group(1)} {hm.group(2)} の{t}'
            m = re.match(KIND + r' ?' + NUM + r'(.*)', t)
            proved = []
            if m and 'の証明' not in m.group(3):
                for k in expand(m.group(2)):
                    stated.setdefault(f'{m.group(1)} {k}', n)
                if kind != 'ph':  # a deferred claim does not own the next proof box
                    last_lemma = f'{m.group(1)} {m.group(2)}'
            elif m:  # "X の証明" or "X の証明の方針"
                for k in expand(m.group(2)):
                    key = f'{m.group(1)} {k}'
                    proved.append(key)
                    pstart.setdefault(key, n)
                    if 'の方針' not in m.group(3):
                        pend[key] = n
            refs = [f'{k} {p}' for k, nums in REF.findall(body) for p in expand(nums)]
            for key in proved:
                deps.setdefault(key, set()).update(r for r in refs if r != key)
            if kind == 'pf pl':
                continue  # forward references are allowed in a plan
            for r in refs:
                uses.setdefault(r, []).append(n)

    def eff_end(k, seen=()):
        """Last slide of the proof of k, including proofs of what that proof uses."""
        e = pend.get(k, 0)
        for d in deps.get(k, ()):
            if d in pend and d not in seen and stated.get(d, 0) > stated.get(k, 0):
                e = max(e, eff_end(d, seen + (k,)))
        return e

    order = {k: i for i, k in enumerate(kinds)}
    keys = sorted(stated, key=lambda k: (order[k.split()[0]], number_key(k.split()[1])))
    print(f'{"":7}{"stated":>7}{"1st use":>8}{"proof":>10}')
    warns = []
    for k in keys:
        s = stated[k]
        u = sorted(set(uses.get(k, [])))
        after = [v for v in u if v > s]
        ps, pe = pstart.get(k), pend.get(k)
        pe = eff_end(k) or pe
        pr = f'{ps}–{pe}' if ps and pe and ps != pe else (str(ps) if ps else '-')
        print(f'{k:7}{s:>7}{(after[0] if after else "-"):>8}{pr:>10}')
        for v in u:
            if v < s:
                warns.append(f'FORWARD  {k}: used on #{v}, stated on #{s}')
        if k.startswith(('補題', '主張')) and ps and ps - s > a.gap:
            warns.append(f'EARLY    {k}: stated on #{s}, proof starts on #{ps}')
        if ps and pe:
            length = pe - ps + 1
            early = [v for v in u if s <= v < ps]
            if early and length <= a.short:
                warns.append(f'DEFERRED {k}: used on #{early[0]} before its {length}-slide proof on #{ps}')
    print()
    print('\n'.join(warns) if warns else 'no warnings')


if __name__ == '__main__':
    main()
