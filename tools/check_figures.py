#!/usr/bin/env python3
"""Check the placement of figures in a Kamishibai draft. tools/pack_engine.py runs this check together
with tools/check_blocks.py and writes no packed file when either fails.

A figure has no caption: the talk explains the figure, and the page holds statements and arguments. A name
given to something in the figure ("the example tetrahedron") is introduced by an item of the page.
The text of a page comes first and its figures below it. A page that explains something step by step (an
algorithm, a walk, a computation shown in stages) may put the text on the left and the figure on the right
with <side><div>text</div><figure>…</figure></side>.

  caption   <figcaption>, <p class="cap">, or a paragraph or item that starts with "図：", "左：", "右：", "上：", "下："
  below     a top-level element of the page after its first figure, other than another figure, a source line
            (class="src") or an empty step (<span step cards="n"></span>, which only advances a figure)
  side      <side> whose first part is a figure, or that does not hold exactly one text part and one figure

A figure is drawn at the width it is shown, not shrunk to fit. The check warns (it does not fail) when a
figure scaled with zoom draws its smallest text below MIN_TEXT_PX on the 1280-pixel page, or when a zoom is
below MIN_ZOOM where the figure gives no font size. The warning is the signal to go back to the structure of
the page (move text to the talk, split at a meaning boundary), not to shrink further.

  shrunk    zoom times the smallest font-size inside the figure's svg is below MIN_TEXT_PX

Usage: python3 tools/check_figures.py DRAFT.html      (exit code 1 when a page breaks a rule; warnings do not)
"""
import re
import sys
from pathlib import Path

PAGE = re.compile(r"<(cover|slide|divider)\b(.*?)</\1>", re.S | re.I)
FIG = ("figure",)
CAPTION = [
    re.compile(r"<figcaption\b", re.I),
    re.compile(r"""<p\b[^>]*\bclass=(["'])[^"']*\bcap\b""", re.I),
    re.compile(r"<(p|item|li)\b[^>]*>\s*(図|左|右|上|下)：", re.I),
]
EMPTY_STEP = re.compile(r"""<span\b[^>]*\bstep\b[^>]*>\s*</span>""", re.I)
SRC = re.compile(r"""^<p\b[^>]*\bclass=(["'])[^"']*\bsrc\b""", re.I)
ZOOM = re.compile(r"zoom:\s*([\d.]+)")
FONT = re.compile(r"font-size[=:]\s*[\"']?([\d.]+)")
MIN_TEXT_PX, MIN_ZOOM = 10.0, 0.5
VOID = {"br", "img", "hr", "input", "meta", "link"}


def children(body):
    """Top-level elements of an HTML fragment: [(tag, outer text)]; svg and comments are skipped over."""
    out, i, n = [], 0, len(body)
    tok = re.compile(r"<!--.*?-->|<(/?)([a-zA-Z][\w-]*)\b[^>]*?(/?)>", re.S)
    depth, start, top = 0, None, None
    for m in tok.finditer(body):
        if m.group(0).startswith("<!--"):
            continue
        close, tag, selfclose = m.group(1), m.group(2).lower(), m.group(3)
        if close:
            depth -= 1
            if depth == 0 and top is not None:
                out.append((top, body[start:m.end()]))
                top = None
        elif selfclose or tag in VOID:
            if depth == 0:
                out.append((tag, m.group(0)))
        else:
            if depth == 0:
                top, start = tag, m.start()
            depth += 1
    return out


def problems(src):
    """[(page, rule, detail)] for the draft text src; pages are numbered as on screen."""
    text = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    text = re.sub(r"<svg\b.*?</svg>", "<svg></svg>", text, flags=re.S | re.I)
    out = []
    for n, pg in enumerate(PAGE.finditer(text), 1):
        inner = pg.group(2).split(">", 1)[1] if ">" in pg.group(2) else ""
        for rx in CAPTION:
            for m in rx.finditer(inner):
                out.append((n, "caption", inner[m.start():m.start() + 60].replace("\n", " ")))
        kids = children(inner)
        seen = False
        for tag, el in kids:
            if tag in FIG:
                seen = True
            elif seen and not (EMPTY_STEP.fullmatch(el.strip()) or SRC.match(el.strip())):
                out.append((n, "below", f"<{tag}> after the figure"))
            if tag == "side":
                parts = children(el[el.index(">") + 1:el.rindex("<")])
                tags = [t for t, _ in parts]
                if len(parts) != 2 or tags[0] in FIG or tags[1] not in FIG:
                    out.append((n, "side", "<side> must hold <div>text</div> then <figure>, got " + ", ".join(tags)))
    return out


def warnings(src):
    """[(page, detail)] for figures shrunk below a readable size; pages are numbered as on screen."""
    text = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    out = []
    for n, pg in enumerate(PAGE.finditer(text), 1):
        body = pg.group(2)
        for m in ZOOM.finditer(body):
            z = float(m.group(1))
            end = body.find("</svg>", m.end())
            fonts = [float(x) for x in FONT.findall(body[m.end():end])] if end >= 0 else []
            if fonts and min(fonts) * z < MIN_TEXT_PX:
                out.append((n, f"zoom {z:g} draws text at {min(fonts) * z:.1f}px (below {MIN_TEXT_PX:g}px)"))
            elif not fonts and z < MIN_ZOOM:
                out.append((n, f"zoom {z:g} (below {MIN_ZOOM:g})"))
    return out


def check(src_path):
    return problems(Path(src_path).read_text())


def report(found, out=sys.stderr):
    for n, rule, detail in found:
        print(f"page {n}: {rule}: {detail}", file=out)


def report_warnings(found, out=sys.stderr):
    for n, detail in found:
        print(f"page {n}: shrunk (warning): {detail}; revisit the page structure", file=out)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__.split("Usage: ")[1])
    found = check(sys.argv[1])
    report(found, sys.stdout)
    report_warnings(warnings(Path(sys.argv[1]).read_text()), sys.stdout)
    print(f"{len(found)} problems with figures" if found else "no captions; text above figures, or on their left beside them")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
