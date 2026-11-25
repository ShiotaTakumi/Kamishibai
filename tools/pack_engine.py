#!/usr/bin/env python3
"""Pack a draft of the runtime engine (engine/kamishibai.js) into ONE self-contained HTML file.

  python3 tools/pack_engine.py SRC [-o OUT] [--theme NAME] [--allow DIR]   (or: make pack SRC=...)

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
    ipa-pgothic.css) are embedded unchanged when present: IPA P-Gothic is not
    subset, because the IPA Font License puts conditions on modified fonts. Missing font CSS means
    system fonts, as in the draft;
  - images (<img src>, <qr src>, SVG <image href>), video and audio (<video src poster>, <audio src>,
    <source src>, <track src>), other <script src> and <link rel=stylesheet> (with the url(...) inside)
    of the draft as inline data, with srcset, the url(...) of style attributes and of <style>, and
    the stylesheets a stylesheet takes in with @import; not inside comments, nor in the code of scripts. Files
    may come only from the draft's folder, the folder holding engine/, or a folder given with --allow;
    any other path stops the packing. Other references to files (<a href>, <iframe>, <object>) stay
    and are warned about: the packed file needs those files next to it. Large videos make a large file.

When packing fails, an older NAME.dist.html is removed, so that it does not pass for the draft.

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
import numbering  # noqa: E402

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
LEFT = re.compile(r"(\\\$|" + "|".join(re.escape(d[0]) for d in DELIMS) + ")")  # \$ in the text is the character $
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
        if text.startswith("\\$"):
            text = text[2:]
            continue
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


LATTR = ["title", "cite", "label", "sec", "aff", "short"]  # the engine's attributes with an X-en


def drop_lang(frag, L):
    """frag with the other language's half of each pair dropped, as the engine's plain(e, L): for
    "ja" every <en> and every lang="en" element right after a lang="ja" one; for "en" every <ja> or
    lang="ja" element that has its English right after it (Japanese with no English stays)."""
    pair = r"""(<(ja)\b[^>]*>.*?</ja\s*>|<([A-Za-z][\w-]*)\b[^>]*\slang=["']?ja\b[^>]*>.*?</\3\s*>)""" \
           r"""(\s*)(<(en)\b[^>]*>.*?</en\s*>|<([A-Za-z][\w-]*)\b[^>]*\slang=["']?en\b[^>]*>.*?</\7\s*>)"""
    frag = re.sub(pair, lambda m: m.group(4) + m.group(5) if L == "en" else m.group(1) + m.group(4), frag,
                  flags=re.S | re.I)
    if L == "ja":
        frag = re.sub(r"<en\b[^>]*>.*?</en\s*>", "", frag, flags=re.S | re.I)
    return frag


def short_of(a, L, frag):
    """The engine's shortOf(): short-en="..." for English, else short="..." (for English only when
    the element holds no English of its own)."""
    if L == "en" and "short-en" in a:
        return a["short-en"]
    if "short" in a and (L != "en" or not re.search(r"<en\b|\slang=[\"']?en\b", frag, re.I)):
        return a["short"]
    return None


def plain(frag, a, L="ja"):
    """The engine's plain(e, L): text of an element in language L, <rt> dropped, <br> as a space;
    short="..." (short-en="...") wins."""
    s = short_of(a, L, frag)
    if s is not None:
        return s
    t = drop_lang(frag, L)
    t = re.sub(r"<rt\b.*?</rt\s*>", "", t, flags=re.S | re.I)
    t = re.sub(r"<br\b[^>]*>", " ", t, flags=re.I)
    t = re.sub(r"<!--.*?-->|<[^>]*>", "", t, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def math_of(src):
    """Every formula the engine's auto-render meets, in document order: the text of the pages
    (outside ignored tags and classes, split at ➡ as the engine does first), and the attributes the
    engine turns into text (titles, cite, labels, sections, affiliations, short, each also as X-en,
    and the footer of the cover in both languages)."""
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
                frag = src[start:m.start()]
                for L in ("ja", "en"):
                    p = plain(frag, a, L)
                    texts.append(p)
                    f = a.get("aff-en" if L == "en" and "aff-en" in a else "aff")
                    if name == "author" and f and short_of(a, L, frag) is None:
                        texts.append(p + "  (" + f + ")")
            continue
        a = attrs(m.group(2))
        if ctx() or name in PAGES:
            # every attribute the engine turns into text, in both languages (a superset does no harm:
            # the table of formulas has each one once); box titles are split at full-width digits
            for k in LATTR:
                for v in (a.get(k), a.get(k + "-en")):
                    if v is None:
                        continue
                    texts.append(v)
                    if k == "title" and name != "slide":
                        texts.extend(re.split(r"[０-９]+", v))
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
    ar = (KATEX_DIST / "contrib" / "auto-render.min.js").read_text(encoding="utf-8").strip()
    return stub + "/* KaTeX auto-render (MIT License, Khan Academy and other contributors) */\n" + ar + "\n"


def katex_css(engine, rendered, other_css):
    """engine/katex/katex.css with the @font-face rules of the KaTeX families in use only: those the
    rules of katex.css give to the classes of the rendered math, and those named by the theme's CSS."""
    css = (engine / "katex" / "katex.css").read_text(encoding="utf-8")
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


class Files:
    """The files a draft may load: inside the draft's folder, the folder of its engine (the slide
    folder) or a folder given with --allow. A reference outside them stops the packing, so that a
    path such as ../../secret.txt never ends up inside a file handed out."""

    def __init__(self, base, roots):
        self.base, self.roots = base, [r.resolve() for r in roots]

    def get(self, ref, base=None):
        """The file of ref (relative to base, default the draft's folder), or None for a URL."""
        if re.match(r"^(?:[a-z][\w+.-]*:|#|//)", ref, re.I) or not ref.strip():
            return None
        path = ((base or self.base) / html.unescape(ref).split("#")[0].split("?")[0]).resolve()
        if not any(path == r or r in path.parents for r in self.roots):
            sys.exit(f"{ref}: outside the folders a draft may load from ({', '.join(map(str, self.roots))}); "
                     "copy the file next to the draft, or allow its folder:  --allow DIR  (make pack ALLOW=DIR)")
        if not path.is_file():
            sys.exit(f"missing file: {path}")
        return path


# what pack never looks inside: comments, and the text of scripts and styles written in the draft
OPAQUE = re.compile(r"<!--.*?-->|(<script\b[^>]*>)(.*?)</script\s*>|<style\b[^>]*>.*?</style\s*>", re.S | re.I)


def outside_opaque(src, fn, style=None):
    """src with fn applied to the parts outside comments, scripts and styles; a <script src> with
    nothing inside is given to fn too (it is a reference, not code), and each <style> to style."""
    out, last = [], 0
    for m in OPAQUE.finditer(src):
        out.append(fn(src[last:m.start()]))
        tok = m.group(0)
        if m.group(1) and re.search(r"\ssrc\s*=", m.group(1), re.I) and not m.group(2).strip():
            tok = fn(tok)
        elif style and tok[:6].lower() == "<style":
            tok = style(tok)
        out.append(tok)
        last = m.end()
    out.append(fn(src[last:]))
    return "".join(out)


def css_inline(css, base, files, quote='"', seen=()):
    """url(...) and @import of a stylesheet (relative to the stylesheet's folder) as inline data.
    quote="" writes url(data:…) with no quotes, for CSS inside an HTML attribute."""
    def imp(m):
        p = files.get(m.group(2) or m.group(3), base)
        if p is None:
            return m.group(0)
        if p in seen:
            sys.exit(f"@import loop at {p}")
        inner = css_inline(p.read_text(encoding="utf-8"), p.parent, files, quote, seen + (p,))
        cond = m.group(4).strip()
        return f"@media {cond} {{\n{inner}\n}}" if cond else inner
    css = re.sub(r"""@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|["']([^"']+)["'])([^;]*);""", imp, css, flags=re.I)

    def url(m):
        p = files.get(m.group(2), base)
        return m.group(0) if p is None else f"url({quote}{data_uri(p)}{quote})"
    return re.sub(r"""url\(\s*(["']?)([^"')]+)\1\s*\)""", url, css)


# an attribute value: "…", '…' or bare
VALUE = r"""(?:(["'])([^"']*)\2|([^\s"'>]+))"""


def inline_resources(src, files):
    """Images, media, scripts and stylesheets the draft loads from files, as inline data; outside
    comments and the code of scripts and styles. Warns about what still loads anything."""
    def part(t):
        def media(m):
            def ref(k):
                p = files.get(k.group(3) if k.group(2) else k.group(4))
                return k.group(0) if p is None else f'{k.group(1)}"{data_uri(p)}"'

            def srcset(k):
                def one(c):
                    c = c.strip()
                    if not c:
                        return c
                    u, _, d = c.partition(" ")
                    p = files.get(u)
                    return (u if p is None else data_uri(p)) + (" " + d.strip() if d.strip() else "")
                # candidates are split at commas followed by a space (a data: URL holds commas)
                return f'{k.group(1)}"' + ", ".join(one(c) for c in re.split(r",\s+|,$", k.group(3))) + '"'
            tag = re.sub(r"(\s(?:src|href|xlink:href|poster)\s*=\s*)" + VALUE, ref, m.group(0), flags=re.I)
            return re.sub(r"""(\ssrcset\s*=\s*)(["'])([^"']*)\2""", srcset, tag, flags=re.I)
        t = re.sub(r"<(?:img|qr|image|source|video|audio|track)\b[^>]*>", media, t, flags=re.I)

        def style_attr(m):
            def css(k):  # url(data:…) without quotes, whichever quote the attribute uses
                q = '"' if k.group(2) is not None else "'"
                v = k.group(2) if k.group(2) is not None else k.group(3)
                return k.group(1) + q + css_inline(v, files.base, files, quote="") + q
            return re.sub(r"""(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')""", css, m.group(0), flags=re.I)
        t = re.sub(r"<[a-zA-Z][^<>]*\sstyle\s*=[^<>]*>", style_attr, t)

        def script(m):
            p = files.get(m.group(3) if m.group(2) else m.group(4))
            if p is None:
                return m.group(0)
            attr = re.sub(r"\ssrc\s*=\s*" + VALUE.replace("\\2", "\\1"), "", m.group(1), flags=re.I)
            if re.search(r"\s(?:defer|async)\b|\stype\s*=\s*[\"']?module", attr, re.I):
                # deferred, async and module scripts keep their timing: the code as a data URL
                return f'<script{attr} src="data:text/javascript;base64,{base64.b64encode(p.read_bytes()).decode()}"></script>'
            return f"<script{attr}>" + re.sub(r"</(script)", r"<\\/\1", p.read_text(encoding="utf-8"), flags=re.I) + "</script>"
        t = re.sub(r"<script\b([^>]*?\ssrc\s*=\s*" + VALUE + r"[^>]*)>\s*</script\s*>", script, t, flags=re.I)

        def link(m):
            if not re.search(r"""rel\s*=\s*["']?stylesheet""", m.group(0), re.I):
                return m.group(0)
            h = re.search(r"\shref\s*=\s*" + VALUE.replace("\\2", "\\1"), m.group(0), re.I)
            p = files.get(h.group(2) if h.group(1) else h.group(3)) if h else None
            if p is None:
                return m.group(0)
            media = re.search(r"""\smedia\s*=\s*(["'][^"']*["'])""", m.group(0))
            css = css_inline(p.read_text(encoding="utf-8"), p.parent, files)
            return (f"<style media={media.group(1)}>" if media else "<style>") + \
                re.sub(r"</(style)", r"<\\/\1", css, flags=re.I) + "</style>"
        t = re.sub(r"<link\b[^>]*>", link, t, flags=re.I)

        for m in re.finditer(r"<(\w+)\b[^>]*?\s(src|href|poster|data|xlink:href|srcset)\s*=\s*" +
                             VALUE.replace("\\2", "\\3"), t):
            tag, v = m.group(1).lower(), m.group(4) if m.group(3) else m.group(5)
            if v.startswith(("data:", "#", "javascript:", "mailto:")) or not v.strip():
                continue
            if re.match(r"https?:|//", v):
                print(f"warning: the packed file still loads {v} (<{tag}>; not there offline)", file=sys.stderr)
            elif not re.match(r"[a-z][\w+.-]*:", v, re.I):
                print(f"warning: <{tag} {m.group(2)}=\"{v}\"> is not packed (only images, video, audio, scripts and "
                      "stylesheets are): the packed file needs that file next to it", file=sys.stderr)
        return t
    return outside_opaque(src, part, lambda t: css_inline(t, files.base, files))


ENGINE_TAG = re.compile(r"""<script\b[^>]*\ssrc=(["'])([^"']*?)kamishibai\.js\1[^>]*>\s*</script\s*>""", re.I)


def pack(src_path, theme=None, allow=()):
    src = src_path.read_text(encoding="utf-8")
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
    own_scripts = bool(re.search(r"<script\b", re.sub(r"<!--.*?-->", "", head + tail, flags=re.S), re.I))
    files = Files(src_path.parent, [src_path.parent, engine.parent, *allow])
    head, tail = inline_resources(head, files), inline_resources(tail, files)
    draft = head + tail

    js = (engine / "kamishibai.js").read_text(encoding="utf-8")
    fig = (engine / "figure.js").read_text(encoding="utf-8") if own_scripts else ""
    base_css = (engine / "base.css").read_text(encoding="utf-8")
    theme_css = theme_css_path.read_text(encoding="utf-8")

    items = math_of(draft)
    version, rendered = render(items) if items else ("", [])
    ev = re.search(r'version:"([^"]+)"', (engine / "katex" / "katex.js").read_text(encoding="utf-8"))
    if items and ev and ev.group(1) != version:
        print(f"warning: math rendered with KaTeX {version}, the engine has {ev.group(1)}", file=sys.stderr)
    ar = (KATEX_DIST / "contrib" / "auto-render.min.js").read_text(encoding="utf-8").strip()
    if ar not in (engine / "katex" / "katex.js").read_text(encoding="utf-8"):
        print("warning: KaTeX's auto-render in tools/node_modules differs from the engine's", file=sys.stderr)
    katex = katex_css(engine, rendered, base_css + theme_css)

    if theme == "Boadilla":
        text = re.sub(r"<!--.*?-->", "", draft, flags=re.S)
        text += strip_js_comments(js + fig) + strip_css_comments(base_css + theme_css)
        if re.search(r"<html\b[^>]*\snumbering\s*=", draft, re.I):
            text += "\u00a0."  # between the kind and the number of a reference
        chars = "".join(sorted((set(html.unescape(text)) | set("0123456789/ ")) - {"\n", "\r", "\t"}))
        fonts = fonts_css(chars)
    else:
        fonts = ""
        for f in THEME_FONT_CSS.get(theme, []):
            p = engine / f
            if p.exists():
                fonts += p.read_text(encoding="utf-8") + "\n"
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
    ap.add_argument("--allow", type=Path, action="append", default=[], metavar="DIR",
                    help="a folder outside the draft's and the engine's the draft may load files from")
    a = ap.parse_args()
    src = a.src.resolve()
    out = a.out or src.with_name(src.stem + ".dist.html")
    if out.resolve() == src:  # fail() below removes the output: never the draft
        sys.exit(f"{out}: the output is the draft itself")

    def fail(msg):
        if out.exists():  # an older packed file would pass for this draft
            out.unlink()
            print(f"removed {out}", file=sys.stderr)
        sys.exit(msg)
    try:
        boxes, figures = check_blocks.check(src), check_figures.check(src)
    except SystemExit as e:
        fail(e.code if isinstance(e.code, str) else f"{src}: nothing packed")
    if boxes or figures:
        check_blocks.report(boxes)
        check_figures.report(figures)
        fail(f"{src}: {len(boxes)} problems in boxes (tools/check_blocks.py), "
             f"{len(figures)} with figures (tools/check_figures.py); nothing packed")
    try:
        text = src.read_text(encoding="utf-8")
        check_figures.report_warnings(check_figures.warnings(text))
        for p, what in numbering.numbers(text, numbering.kinds_of(text, src))[1]:
            print(f"warning: page {p}: {what} (tools/numbering.py)", file=sys.stderr)
        data, n = pack(src, a.theme, a.allow)
    except SystemExit as e:
        fail(e.code if isinstance(e.code, str) else f"{src}: nothing packed")
    except Exception as e:
        print(f"{src}: nothing packed", file=sys.stderr)
        fail(f"{type(e).__name__}: {e}")
    out.write_text(data, encoding="utf-8")
    print(f"{out}: {len(data.encode()) / 1024:.0f} KiB, {n} formulas")


if __name__ == "__main__":
    main()
