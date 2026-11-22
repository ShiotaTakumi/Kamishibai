#!/usr/bin/env python3
"""Check that every box (<block>, <alertblock>, <exampleblock>) of a Kamishibai draft holds a
statement and nothing else. tools/pack_engine.py runs this check and writes no packed file when it fails.

A box is a statement when its title starts with a kind of statement (定義, 定理, 補題, ...; the list is
BLOCK_KINDS in engine/kamishibai.js, which also marks a bad box on screen while drafting), followed by
nothing, a space, a number or "（". Inside a box, the check rejects what does not belong to a statement:

  title     no title, or a title that does not start with a kind ("範囲", "strand と集合 E")
  step      a part shown step by step (step, or <later>): the statement is shown at once
  figure    a figure, image, SVG or switch (flip, switch)
  source    a source line (class="src"): it goes under the box
  nested    a box or proof inside the box
  page      a reference to a page ("頁 4"): a remark for the talk, not part of the statement

The check cannot read meaning: a remark written as a plain sentence inside a statement box passes.
Write remarks (why it matters, where it is used, what is known) outside the box.

Usage: python3 tools/check_blocks.py DRAFT.html      (exit code 1 when a box breaks a rule)
"""
import html
import re
import sys
from pathlib import Path

ENGINE_TAG = re.compile(r"""<script\b[^>]*\bsrc=(["'])([^"']*?)kamishibai\.js\1[^>]*>\s*</script>""", re.I)
PAGE = re.compile(r"<(cover|slide|divider)\b(.*?)</\1>", re.S | re.I)
BOX = re.compile(r"<(block|alertblock|exampleblock)\b([^>]*)>(.*?)</\1>", re.S | re.I)
RULES = [
    ("step", re.compile(r"<[a-z]+\b[^>]*\sstep\b|<later\b", re.I)),
    ("figure", re.compile(r"<(figure|img|svg|flip|switch)\b", re.I)),
    ("source", re.compile(r"""class=(["'])[^"']*\bsrc\b""", re.I)),
    ("nested", re.compile(r"<(block|alertblock|exampleblock|proof|plan)\b", re.I)),
    ("page", re.compile(r"頁\s*\d")),
]


def kinds_of(engine_js):
    m = re.search(r"BLOCK_KINDS\s*=\s*\[([^\]]*)\]", engine_js)
    if not m:
        sys.exit("engine/kamishibai.js has no BLOCK_KINDS")
    return re.findall(r'"([^"]+)"', m.group(1))


def problems(src, kinds):
    """[(page, box tag, title, rule)] for the draft text src; pages are numbered as on screen."""
    text = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    head = re.compile(r"(%s)(\s|\d|（|$)" % "|".join(map(re.escape, sorted(kinds, key=len, reverse=True))))
    out = []
    for n, pg in enumerate(PAGE.finditer(text), 1):
        for b in BOX.finditer(pg.group(2)):
            t = re.search(r"""\btitle=(["'])(.*?)\1""", b.group(2), re.S)
            title = html.unescape(t.group(2)).strip() if t else ""
            if not head.match(title):
                out.append((n, b.group(1), title, "title"))
            if re.search(r"\sstep\b", b.group(2)):
                out.append((n, b.group(1), title, "step"))
            for name, rx in RULES:
                if rx.search(b.group(3)):
                    out.append((n, b.group(1), title, name))
    return out


def check(src_path):
    """Problems of the draft at src_path, with the kinds read from the engine it loads."""
    src = Path(src_path).read_text()
    m = ENGINE_TAG.search(src)
    if not m:
        sys.exit(f"{src_path}: no <script src=\".../kamishibai.js\"> (not a draft of the engine)")
    engine = (Path(src_path).parent / html.unescape(m.group(2) or "./")).resolve()
    return problems(src, kinds_of((engine / "kamishibai.js").read_text()))


def report(found, out=sys.stderr):
    for n, tag, title, rule in found:
        print(f"page {n}: <{tag} title=\"{title}\">: {rule}", file=out)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__.split("Usage: ")[1])
    found = check(sys.argv[1])
    report(found, sys.stdout)
    print(f"{len(found)} problems in boxes" if found else "every box holds a statement only")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
