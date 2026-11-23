#!/usr/bin/env python3
"""Rebuild engine/katex/katex.js and katex.css from the KaTeX in tools/node_modules.

  python3 tools/engine_katex.py        (make engine-katex)

katex.js  = the licence comments kept from the current file, then dist/katex.min.js and
            dist/contrib/auto-render.min.js, one per line.
katex.css = the licence comment, then dist/katex.min.css with every @font-face src replaced by
            the woff2 font as a data: URI (so the engine opens over file:// with no font folder).
The version in the first comment of each file is set from node_modules/katex/package.json.
Run after  npm install --prefix tools katex@VERSION  (which updates tools/package.json and the lock).
"""
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KATEX = ROOT / "tools" / "node_modules" / "katex"
DIST = KATEX / "dist"
OUT = ROOT / "engine" / "katex"


def header(path, lines, version):
    """the first `lines` lines of the current file (licence comments), with the version updated"""
    head = path.read_text(encoding="utf-8").split("\n")[:lines]
    head[0] = re.sub(r"KaTeX \d+\.\d+\.\d+", f"KaTeX {version}", head[0])
    return "\n".join(head)


def comment_lines(path):
    """number of leading lines before the first line that is not part of a comment"""
    n, inside = 0, False
    for line in path.read_text(encoding="utf-8").split("\n"):
        s = line.strip()
        if not inside and not s.startswith("/*") and s:
            break
        if s.startswith("/*"):
            inside = True
        if inside and s.endswith("*/"):
            inside = False
        n += 1
    return n


def font(m):
    f = re.search(r"url\((fonts/[^)]+\.woff2)\)", m.group(0)).group(1)
    data = base64.b64encode((DIST / f).read_bytes()).decode()
    return f'src:url(data:font/woff2;base64,{data}) format("woff2")'


def main():
    version = json.loads((KATEX / "package.json").read_text(encoding="utf-8"))["version"]
    js_path, css_path = OUT / "katex.js", OUT / "katex.css"
    js = (header(js_path, comment_lines(js_path), version) + "\n"
          + (DIST / "katex.min.js").read_text(encoding="utf-8").strip() + "\n"
          + (DIST / "contrib" / "auto-render.min.js").read_text(encoding="utf-8").strip() + "\n")
    css_body = re.sub(r"src:url\(fonts/[^;}]*", font, (DIST / "katex.min.css").read_text(encoding="utf-8").strip())
    if "url(fonts/" in css_body:
        raise SystemExit("katex.min.css: a font left unembedded")
    css = header(css_path, comment_lines(css_path), version) + "\n" + css_body + "\n"
    js_path.write_text(js, encoding="utf-8")
    css_path.write_text(css, encoding="utf-8")
    print(f"engine/katex: KaTeX {version}, katex.js {len(js) // 1024} KiB, katex.css {len(css) // 1024} KiB")


if __name__ == "__main__":
    main()
