#!/usr/bin/env python3
"""Pack a draft of the runtime engine (engine/kamishibai.js) into ONE self-contained HTML file.

  python3 tools/pack_engine.py SRC [-o OUT] [--theme NAME]      (or: make pack SRC=...)

SRC is a draft as engine/sample.html (it loads the engine with <script src=".../kamishibai.js">).
OUT (default: next to SRC as NAME.dist.html) opens from file:// with no network and no other file:

  - the engine (kamishibai.js, marked data-packed="THEME" so that it loads nothing), figure.js when the
    draft has scripts of its own, base.css and the theme's CSS, all inline;
  - the math rendered here with KaTeX (tools/node_modules, the engine's version). The page keeps
    KaTeX's auto-render (3 KB) and a stand-in for KaTeX that puts in the HTML rendered here, so the
    formulas are found exactly where the engine finds them (also in titles and labels written as
    attributes); KaTeX itself (katex.js) is not in the file. katex.css keeps only the KaTeX fonts of
    the families the rendered math and the CSS use;
  - the fonts: Boadilla's (Latin Modern Sans and Roman Italic, Harano Aji Gothic from fonts/) cut down
    to the characters of the draft and of the engine's own labels. Madrid's (engine/fonts/cm-sans.css,
    ipa-pgothic.css, copied from WebSlide) are embedded unchanged when present: IPA P-Gothic is not
    subset, because the IPA Font License puts conditions on modified fonts. Missing font CSS means
    system fonts, as in the draft;
  - images (<img src>, <qr src>, SVG <image href>), other <script src> and <link rel=stylesheet>
    of the draft as inline data.

Japanese phrase breaks (BudouX <wbr>, as tools/build_html.py) are not added: the engine's CSS does not
set word-break:keep-all, so <wbr> would change nothing, and setting keep-all here only would break
the lines of the packed file differently from the draft that was checked.

Needs fontTools (make deps), fonts/ (make fonts) and Node.js with KaTeX (npm ci --prefix tools).
Building twice gives the same bytes. Edit the draft, not the packed file.
"""
import argparse, base64, html, io, json, mimetypes, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_html import ROOT, font_path, subset  # noqa: E402
import check_blocks  # noqa: E402
import check_figures  # noqa: E402

KATEX_DIST = ROOT / "tools" / "node_modules" / "katex" / "dist"

# (CSS family, weight, font file in fonts/): the families of --sans in engine/themes/Boadilla.css,
# the same as tools/engine_fonts.py writes into engine/fonts/kamishibai-fonts.css
BOADILLA_FONTS = [
    ("LMSans", 400, "lmsans10-regular.otf"),
    ("LMSans", 700, "lmsans10-bold.otf"),
    ("JPGothic", 400, "HaranoAjiGothic-Regular.otf"),
    ("JPGothic", 700, "HaranoAjiGothic-Bold.otf"),
    ("LMItalic", 400, "lmroman10-italic.otf"),
]
FONT_HEADER = """/* Fonts of the Kamishibai engine, subset to the characters of this file by tools/pack_engine.py.
   Latin Modern Sans / Latin Modern Roman Italic: GUST Font License.
   Harano Aji Gothic: SIL Open Font License 1.1. The copyright notices and license texts follow. */
"""
# font stylesheets of the other themes, as in kamishibai.js (FONT_CSS), embedded unchanged
THEME_FONT_CSS = {"Madrid": ["fonts/ipa-pgothic.css", "fonts/cm-sans.css"]}

# ===== Math: the engine's auto-render call (kamishibai.js), ported =====
DELIMS = [("$$", "$$", True), ("\\[", "\\]", True), ("\\(", "\\)", False), ("$", "$", False)]
LEFT = re.compile("(" + "|".join(re.escape(d[0]) for d in DELIMS) + ")")
IGNORED_TAGS = {"script", "noscript", "style", "textarea", "pre", "code", "option", "svg"}
IGNORED_CLASSES = {"ks-pre", "katex"}
PAGES = {"cover", "slide", "divider"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


def find_end(delim, text, start):
    """KaTeX auto-render's findEndOfMath: the end delimiter outside braces, skipping \\x."""
    r, depth = start, 0
    while r < len(text):
        if depth <= 0 and text.startswith(delim, r):
            return r
        c = text[r]
        if c == "\\":
            r += 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        r += 1
    return -1


def split_math(text):
    """KaTeX auto-render's splitAtDelimiters with the engine's delimiters: [(TeX, display), ...]."""
    out = []
    while True:
        m = LEFT.search(text)
        if not m:
            break
        text = text[m.start():]
        left, right, display = next(d for d in DELIMS if text.startswith(d[0]))
        n = find_end(right, text, len(left))
        if n == -1:
            break
        raw = text[:n + len(right)]
        out.append((raw if raw.startswith("\\begin{") else text[len(left):n], display))
        text = text[n + len(right):]
    return out


TAG = re.compile(r"""<!--.*?-->|<!\w[^>]*>|</?([A-Za-z][^\s/>]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?|\s*/)*)\s*/?>""", re.S)
ATTR = re.compile(r"""([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?""")
RAW = {"script", "style", "textarea", "title"}


def attrs(s):
    out = {}
    for k, v in ATTR.findall(s or ""):
        out.setdefault(k.lower(), html.unescape(v[1:-1] if v[:1] in "\"'" else v))
    return out


def plain(frag, a):
    """The engine's plain(): text of an element, <rt> dropped, <br> as a space; short="..." wins."""
    if "short" in a:
        return a["short"]
    t = re.sub(r"<rt\b.*?</rt\s*>", "", frag, flags=re.S | re.I)
    t = re.sub(r"<br\b[^>]*>", " ", t, flags=re.I)
    t = re.sub(r"<!--.*?-->|<[^>]*>", "", t, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def math_of(src):
    """Every formula the engine's auto-render meets, in document order: the text of the pages
    (outside ignored tags and classes, split at ➡ as the engine does first), and the attributes the
    engine turns into text (titles, cite, labels, affiliations, the footer of the cover)."""
    texts, stack, run = [], [], []
    opened = {}  # element name -> (offset after its start tag, attributes) for the footer texts

    def ctx():
        page = any(n in PAGES for n, _ in stack)
        ign = any(n in IGNORED_TAGS or (IGNORED_CLASSES & set(a.get("class", "").split())) for n, a in stack)
        return page and not ign

    def flush():
        if run and ctx():
            texts.extend(re.split(r"➡[︎️]?", html.unescape("".join(run))))
        run.clear()

    pos = 0
    for m in TAG.finditer(src):
        run.append(src[pos:m.start()])
        pos = m.end()
        tok = m.group(0)
        if tok.startswith("<!"):
            flush()
            continue
        flush()
        name = m.group(1).lower()
        if tok.startswith("</"):
            if any(n == name for n, _ in stack):
                while stack and stack.pop()[0] != name:
                    pass
            if name in ("author", "headline", "date") and name in opened:
                start, a = opened.pop(name)
                p = plain(src[start:m.start()], a)
                texts.append(p)
                if name == "author" and "aff" in a:
                    texts.append(p + "  (" + a["aff"] + ")")
            continue
        a = attrs(m.group(2))
        if ctx() or name in PAGES:
            if name == "slide" and "title" in a:
                texts.append(a["title"])
            if name in ("block", "alertblock", "exampleblock", "proof", "plan", "later") and "title" in a:
                texts.extend(re.split(r"[０-９]+", a["title"]))
            for k in ("cite", "label", "aff"):
                if k in a:
                    texts.append(a[k])
            if name in ("author", "headline", "date"):
                opened[name] = (m.end(), a)
        if name in RAW:
            end = re.compile(r"</" + name + r"\s*>", re.I).search(src, m.end())
            pos = end.end() if end else len(src)
            continue
        if name not in VOID and not tok.endswith("/>"):
            stack.append((name, a))
    run.append(src[pos:])
    flush()
    seen, out = set(), []
    for t in texts:
        for item in split_math(t):
            if item not in seen:
                seen.add(item)
                out.append(item)
    return out


def render(items):
    if not (KATEX_DIST / "katex.min.js").exists():
        sys.exit("KaTeX not found: run  make deps  (or npm ci --prefix tools)")
    out = subprocess.run(["node", str(ROOT / "tools" / "pack_math.js")], input=json.dumps(items),
                         capture_output=True, text=True, check=True)
    res = json.loads(out.stdout)
    for (tex, _), h in zip(items, res["html"]):
        if "katex-error" in h:
            print(f"warning: KaTeX cannot render: {tex}", file=sys.stderr)
    return res["version"], res["html"]


def math_script(items, rendered):
    """The stand-in for KaTeX (render() puts in the HTML rendered at build time), then auto-render."""
    table = {("D" if d else "I") + tex: h for (tex, d), h in zip(items, rendered)}
    data = json.dumps(table, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    stub = ("/* Math rendered by tools/pack_engine.py with KaTeX; this stand-in gives it to KaTeX's auto-render */\n"
            "(function () {\nvar M = " + data + ";\n"
            "window.katex = { ParseError: function () {}, render: function (tex, el, o) {\n"
            "  var h = M[(o && o.displayMode ? \"D\" : \"I\") + tex];\n"
            "  if (h === undefined) { el.className = \"katex-missing\"; el.textContent = tex; console.warn(\"kamishibai: math not packed: \" + tex); return; }\n"
            "  el.innerHTML = h;\n} };\n})();\n")
    ar = (KATEX_DIST / "contrib" / "auto-render.min.js").read_text().strip()
    return stub + "/* KaTeX auto-render (MIT License, Khan Academy and other contributors) */\n" + ar + "\n"


def katex_css(engine, rendered, other_css):
    """engine/katex/katex.css with the @font-face rules of the KaTeX families in use only: those the
    rules of katex.css give to the classes of the rendered math, and those named by the theme's CSS."""
    css = (engine / "katex" / "katex.css").read_text()
    classes = {"katex"}
    for h in rendered:
        for c in re.findall(r'class="([^"]*)"', h):
            classes |= set(c.split())
    fams = {"KaTeX_Main"} | set(re.findall(r"KaTeX_\w+", other_css))
    for sel, body in re.findall(r"([^{}@]+)\{([^{}]*)\}", re.sub(r"@font-face\{[^}]*\}", "", css)):
        names = re.findall(r"KaTeX_\w+", body)
        if names and any(set(re.findall(r"\.([\w-]+)", part)) <= classes for part in sel.split(",")):
            fams |= set(names)

    def face(m):
        fam = re.search(r'font-family:"?(KaTeX_\w+)', m.group(0)).group(1)
        return m.group(0) if fam in fams else ""
    return re.sub(r"@font-face\{[^}]*\}\n?", face, css)


def strip_js_comments(js):
    return re.sub(r"/\*.*?\*/|(?<![:\\\w\"'])//[^\n]*", "", js, flags=re.S)


def strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def fonts_css(chars):
    try:
        import fontTools  # noqa: F401
    except ImportError:
        sys.exit("fontTools not found: run  make deps")
    from engine_fonts import license_notice
    rules = [FONT_HEADER, license_notice([n for _, _, n in BOADILLA_FONTS])]
    for fam, wt, name in BOADILLA_FONTS:
        woff = subset(font_path(name), chars)
        rules.append(f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:{wt};font-display:block;'
                     f'src:url(data:font/woff;base64,{base64.b64encode(woff).decode()}) format("woff")}}\n')
    return "".join(rules)


def data_uri(path):
    mime = mimetypes.guess_type(path.name)[0] or sys.exit(f"unknown file type: {path}")
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def local(base, ref):
    if re.match(r"^(?:[a-z][\w+.-]*:|#|//)", ref, re.I):
        return None
    path = (base / html.unescape(ref)).resolve()
    if not path.is_file():
        sys.exit(f"missing file: {path}")
    return path


def inline_resources(src, base):
    """Images, scripts and stylesheets the draft loads from files, as inline data."""
    def ref(m):
        p = local(base, m.group(3))
        return m.group(0) if p is None else m.group(1) + m.group(2) + data_uri(p) + m.group(2)
    src = re.sub(r"""(<(?:img|qr|image|source)\b[^>]*?\s(?:src|href|xlink:href)=)(["'])([^"']*)\2""", lambda m: ref(m), src, flags=re.I)

    def script(m):
        p = local(base, m.group(2))
        if p is None:
            return m.group(0)
        return "<script>" + p.read_text().replace("</script", "<\\/script") + "</script>"
    src = re.sub(r"""<script\b[^>]*?\ssrc=(["'])([^"']*)\1[^>]*>\s*</script\s*>""", script, src, flags=re.I)

    def link(m):
        if not re.search(r"""rel=["']?stylesheet""", m.group(0), re.I):
            return m.group(0)
        p = local(base, re.search(r"""href=(["'])([^"']*)\1""", m.group(0)).group(2))
        return m.group(0) if p is None else "<style>" + p.read_text() + "</style>"
    src = re.sub(r"<link\b[^>]*>", link, src, flags=re.I)
    for m in re.finditer(r"""\s(?:src|href)=(["'])([^"'#][^"']*)\1""", src):
        if not m.group(2).startswith("data:") and re.match(r"https?:|//", m.group(2)):
            print(f"warning: the packed file still loads {m.group(2)}", file=sys.stderr)
    return src


ENGINE_TAG = re.compile(r"""<script\b[^>]*\ssrc=(["'])([^"']*?)kamishibai\.js\1[^>]*>\s*</script\s*>""", re.I)


def pack(src_path, theme=None):
    src = src_path.read_text()
    m = ENGINE_TAG.search(src)
    if not m:
        sys.exit(f"{src_path}: no <script src=\".../kamishibai.js\"> (not a draft of the engine)")
    engine = (src_path.parent / html.unescape(m.group(2) or "./")).resolve()
    if theme is None:
        t = re.search(r"""<html\b[^>]*\stheme=(["']?)([A-Za-z]+)\1""", src, re.I)
        theme = t.group(2) if t else "Boadilla"
    theme_css_path = engine / "themes" / f"{theme}.css"
    if not re.fullmatch(r"[A-Za-z]+", theme) or not theme_css_path.exists():
        sys.exit(f"no such theme: {theme} ({theme_css_path})")

    # the rest of the draft: its own files inline, and the theme on <html> for anyone reading it
    head, tail = src[:m.start()], src[m.end():]
    head = re.sub(r"""(<html\b[^>]*\stheme=)(["']?)[A-Za-z]+\2""", lambda k: f'{k.group(1)}"{theme}"', head, count=1, flags=re.I)
    own_scripts = bool(re.search(r"<script\b", head + tail, re.I))
    head, tail = inline_resources(head, src_path.parent), inline_resources(tail, src_path.parent)
    draft = head + tail

    js = (engine / "kamishibai.js").read_text()
    fig = (engine / "figure.js").read_text() if own_scripts else ""
    base_css = (engine / "base.css").read_text()
    theme_css = theme_css_path.read_text()

    items = math_of(draft)
    version, rendered = render(items) if items else ("", [])
    ev = re.search(r'version:"([^"]+)"', (engine / "katex" / "katex.js").read_text())
    if items and ev and ev.group(1) != version:
        print(f"warning: math rendered with KaTeX {version}, the engine has {ev.group(1)}", file=sys.stderr)
    ar = (KATEX_DIST / "contrib" / "auto-render.min.js").read_text().strip()
    if ar not in (engine / "katex" / "katex.js").read_text():
        print("warning: KaTeX's auto-render in tools/node_modules differs from the engine's", file=sys.stderr)
    katex = katex_css(engine, rendered, base_css + theme_css)

    if theme == "Boadilla":
        text = re.sub(r"<!--.*?-->", "", draft, flags=re.S)
        text += strip_js_comments(js + fig) + strip_css_comments(base_css + theme_css)
        chars = "".join(sorted((set(html.unescape(text)) | set("0123456789/ ")) - {"\n", "\r", "\t"}))
        fonts = fonts_css(chars)
    else:
        fonts = ""
        for f in THEME_FONT_CSS.get(theme, []):
            p = engine / f
            if p.exists():
                fonts += p.read_text() + "\n"
            else:
                print(f"note: {p.relative_to(ROOT) if ROOT in p.parents else p} not found; "
                      f"theme {theme} uses system fonts for it", file=sys.stderr)

    def style(css):
        return "<style data-kamishibai>\n" + css.rstrip("\n").replace("</style", "<\\/style") + "\n</style>\n"

    def script(code, attr=""):
        return f"<script{attr}>\n" + code.rstrip("\n").replace("</script", "<\\/script") + "\n</script>\n"

    block = (f"<!-- Packed from {src_path.name} by tools/pack_engine.py (theme {theme}). "
             "Edit the draft, not this file. -->\n"
             + style(katex) + (style(fonts) if fonts else "") + style(base_css) + style(theme_css)
             + script(js, f' data-packed="{theme}"')
             + (script(math_script(items, rendered)) if items else "")
             + (script(fig) if fig else ""))
    return head + block.rstrip("\n") + tail, len(items)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--theme")
    a = ap.parse_args()
    src = a.src.resolve()
    out = a.out or src.with_name(src.stem + ".dist.html")
    boxes, figures = check_blocks.check(src), check_figures.check(src)
    if boxes or figures:
        check_blocks.report(boxes)
        check_figures.report(figures)
        if out.exists():  # an older packed file would pass for this draft
            out.unlink()
            print(f"removed {out}", file=sys.stderr)
        sys.exit(f"{src}: {len(boxes)} problems in boxes (tools/check_blocks.py), "
                 f"{len(figures)} with figures (tools/check_figures.py); nothing packed")
    check_figures.report_warnings(check_figures.warnings(src.read_text()))
    data, n = pack(src, a.theme)
    out.write_text(data, encoding="utf-8")
    print(f"{out}: {len(data.encode()) / 1024:.0f} KiB, {n} formulas")


if __name__ == "__main__":
    main()
