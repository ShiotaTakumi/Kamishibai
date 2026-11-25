#!/usr/bin/env python3
"""Build the single-file HTML slides: html/slide.src.html -> slide.html.

  <!--SVG name w600-->          fig/name.svg inline, 600 px wide (static; its text uses the page fonts;
                                 SMIL <animate>/<animateTransform> inside it play in the page)
  <!--SVG name w600 id [init]--> the same, wrapped as a step-by-step figure
                                 (<div class="flip one" id=... data-anim>): its groups of class "cd"
                                 appear one by one as the slide's .reveal items with data-cards="n"
                                 come in, and those of class "ov" with data-ov; init groups from the start
  <!--SVGS a,b w600 id-->        figures a, b, ... in one place, switched by buttons
                                 (<div class="flip tg" id=...>; see data-flip in slide.src.html)
  <!--IMG file w400-->           an image file (PNG, JPEG, PDF-free SVG) embedded as a data URI
  /*FONTS*/                      @font-face rules for the Beamer fonts (Latin Modern Sans,
                                 HaranoAji Gothic, Latin Modern italic, Latin Modern Math for symbols
                                 such as ℝ), subset to the characters used and embedded as WOFF,
                                 followed by KaTeX's stylesheet with the KaTeX fonts it needs
  \\(TeX\\)                        math, rendered once here with KaTeX (no JavaScript in the page)

Japanese text gets explicit line-break points: BudouX splits each paragraph into phrases and
<wbr> goes between them and after Japanese closing punctuation. The page sets
word-break:keep-all, so Chrome and Safari break lines at the same places. Check with
make check (tools/check_layout.mjs).

Needs fontTools (pip, see requirements.txt), the font files in fonts/ (tools/fetch_fonts.py, pinned
versions with checksums), and Node.js with KaTeX and BudouX (npm ci --prefix tools). The output
depends only on these pinned inputs: building twice gives the same bytes.
"""
import base64, html, io, json, mimetypes, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KATEX = ROOT / "tools" / "node_modules" / "katex" / "dist"
# KaTeX fonts embedded in the page (the rest are dropped from its stylesheet)
KATEX_FONTS = ["KaTeX_Main-Regular", "KaTeX_Main-Bold", "KaTeX_Main-Italic", "KaTeX_Math-Italic",
               "KaTeX_AMS-Regular", "KaTeX_Size1-Regular"]


def drawn(m):
    name, sc, uid, init = m.group(1), m.group(2), m.group(3), m.group(4)
    path = ROOT / "fig" / f"{name}.svg"
    if not path.exists():
        sys.exit(f"missing figure: {path} (run the figure generator first)")
    svg = path.read_text(encoding="utf-8")
    svg = re.sub(r"<\?xml[^>]*\?>\s*", "", svg)
    x, y, w, h = (float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split())
    W, H = float(sc[1:]), float(sc[1:]) * h / w
    if uid:
        svg = svg.replace("<svg ", f'<svg class="gv" aria-label="{name}" style="left:0;top:0;width:{W:.1f}px;height:{H:.1f}px" ', 1)
        init_attr = f' data-init="{init}"' if init else ""
        return (f'<div class="flip one" id="{uid}" data-anim{init_attr} style="width:{W:.1f}px;height:{H:.1f}px">'
                + svg + "</div>")
    return svg.replace("<svg ", f'<svg class="bd" aria-label="{name}" width="{W:.1f}" height="{H:.1f}" ', 1)


def toggled(m):
    names, sc, uid = m.group(1).split(","), m.group(2), m.group(3)
    svgs, size = [], None
    for k, name in enumerate(names):
        one = drawn(re.match(r"(\S+) (w\d+) (\S+)()", f"{name} {sc} {uid}-{k}"))
        size = re.search(r'style="(width:[^"]+)"', one).group(1)
        svg = re.search(r"<svg .*</svg>", one, re.S).group(0)
        svgs.append(svg.replace('class="gv"', 'class="gv cur"', 1) if k == 0 else svg)
    return f'<div class="flip tg" id="{uid}" style="{size}">' + "".join(svgs) + "</div>"


def image(m):
    path, sc = ROOT / m.group(1), m.group(2)
    if not path.exists():
        sys.exit(f"missing image: {path}")
    mime = mimetypes.guess_type(path.name)[0] or sys.exit(f"unknown image type: {path}")
    uri = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    return f'<img class="bd" alt="{path.stem}" src="{uri}" width="{sc[1:]}">'


# (CSS family, weight, font file in fonts/). The same fonts as the Beamer template.
FONTS = [
    ("LMSans", 400, "lmsans10-regular.otf"),
    ("LMSans", 700, "lmsans10-bold.otf"),
    ("JPGothic", 400, "HaranoAjiGothic-Regular.otf"),
    ("JPGothic", 700, "HaranoAjiGothic-Bold.otf"),
    ("LMItalic", 400, "lmroman10-italic.otf"),
    # symbols missing from the two above (e.g. ℝ); only those are embedded, as one face for
    # every weight, so that no browser falls back to a system font or a synthetic bold
    ("LMMath", "100 900", "latinmodern-math.otf"),
]
# the families of --sans in slide.src.html, and of <i>
SANS = ["LMSans", "JPGothic", "LMMath"]
ITALIC = ["LMItalic"]
FONT_DIR = ROOT / "fonts"
_cmaps = {}


def font_path(name):
    path = FONT_DIR / name
    return path if path.exists() else sys.exit(f"font not found: {path}\nrun  make fonts  (or python3 tools/fetch_fonts.py)")


def coverage(fam):
    """Code points of the (regular) font of a family."""
    if fam not in _cmaps:
        from fontTools.ttLib import TTFont
        name = next(n for f, w, n in FONTS if f == fam and w in (400, "100 900"))
        _cmaps[fam] = set(TTFont(font_path(name), lazy=True).getBestCmap())
    return _cmaps[fam]


def visible_text(src):
    """Text drawn in the page fonts: outside CSS, scripts, comments and math, and outside the
    inline SVG figures' own <style> (their <text> uses the page fonts too)."""
    body = re.sub(r"<style>.*?</style>|<script>.*?</script>|<!--.*?-->", "", src, flags=re.S)
    return MATH.sub("", body)


def check_glyphs(src):
    """Every character of the text must be in an embedded font, or each browser draws it with
    a different system font. Math (KaTeX) is left out: it uses KaTeX's own fonts."""
    body = visible_text(src)
    ital = "".join(re.findall(r"<i>(.*?)</i>", body))
    text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<i>.*?</i>", "", body)))
    text += "".join(re.findall(r'data-caps="([^"]*)"', body))
    miss = []
    for chars, fams in ((text, SANS), (ital, ITALIC)):
        have = set().union(*(coverage(f) for f in fams))
        miss += sorted({c for c in chars if not c.isspace() and ord(c) not in have and c != "​"})
    if miss:
        sys.exit("no embedded font has: " + " ".join(f"{c} (U+{ord(c):04X})" for c in miss)
                 + "\nadd a font to FONTS (and to --sans in slide.src.html)")


def subset(path, chars):
    """The font at path cut down to chars, as WOFF bytes without timestamp (stable bytes).

    The second glyphs of each pair of a
    PairPos format 1 subtable are put back in glyph-ID order: fontTools (4.60) keeps their old order,
    which no longer agrees with the new glyph IDs of a CID-keyed font such as Harano Aji, and the
    shaper's binary search then misses pairs (kerning such as the き-る of できる is lost in Chrome).

    A subset is a Modified Version of the font, so it is renamed (rename_subset): the SIL Open Font
    License forbids the Reserved Font Names (Harano Aji, Source) on modified versions, and the GUST
    Font License asks that derived Latin Modern fonts carry new names. The copyright and license
    name records are kept."""
    from fontTools import subset as ft
    opts = ft.Options()
    opts.flavor = "woff"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.drop_tables += ["FFTM"]
    font = ft.load_font(str(path), opts, dontLoadGlyphNames=True)
    font.recalcTimestamp = False
    sub = ft.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    if "GPOS" in font and font["GPOS"].table.LookupList:
        gid = font.getReverseGlyphMap()
        for lookup in font["GPOS"].table.LookupList.Lookup:
            for st in lookup.SubTable:
                st = getattr(st, "ExtSubTable", st)
                if getattr(st, "Format", None) == 1 and hasattr(st, "PairSet"):
                    for ps in st.PairSet:
                        ps.PairValueRecord.sort(key=lambda r: gid[r.SecondGlyph])
    rename_subset(font, Path(path).name)
    buf = io.BytesIO()
    ft.save_font(font, buf, opts)
    return buf.getvalue()


# new family names of the subset fonts, by the start of the font file name (none uses a Reserved Font Name)
SUBSET_FAMILIES = [("HaranoAjiGothic", "Kamishibai Gothic JP"), ("lmsans10", "Kamishibai Sans"),
                   ("lmroman10", "Kamishibai Roman"), ("latinmodern-math", "Kamishibai Math")]


def rename_subset(font, filename):
    """Give a subset font a new family name (name IDs 1-6, 16, 17 and their localized records),
    keep the copyright (0) and license (13, 14) records, and say in the description (10) what it is."""
    family = next((new for start, new in SUBSET_FAMILIES if filename.startswith(start)), None)
    if family is None:
        sys.exit(f"no subset name for {filename}: add it to SUBSET_FAMILIES in tools/build_html.py")
    name = font["name"]
    style = name.getDebugName(2) or "Regular"
    original = name.getDebugName(16) or name.getDebugName(1) or filename
    version = re.search(r"\d[\w.]*", name.getDebugName(5) or "")
    name.names = [r for r in name.names if r.nameID not in (1, 2, 3, 4, 5, 6, 10, 16, 17, 18, 21, 22)]
    full = family if style == "Regular" else f"{family} {style}"
    ps = (family + "-" + style).replace(" ", "")
    for nid, value in [(1, family), (2, style), (3, ps), (4, full), (6, ps),
                       (5, "Version " + (version.group(0) if version else "1") + "; Kamishibai subset"),
                       (10, f"Subset of {original} made by Kamishibai for one document; renamed as a Modified Version.")]:
        name.setName(value, nid, 3, 1, 0x409)
        name.setName(value, nid, 1, 0, 0)
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [ps]
        top = cff.topDictIndex[0]
        for key, value in [("FullName", full), ("FamilyName", family)]:
            if hasattr(top, key):
                setattr(top, key, value)
        for fd in getattr(top, "FDArray", None) or []:
            if hasattr(fd, "FontName"):
                fd.FontName = ps + "-" + fd.FontName.split("-")[-1]


def license_notices():
    """CSS comments with the license texts of what goes into the page: the fonts (their copyright
    notices and licenses, as tools/engine_fonts.py writes them), and KaTeX (MIT License), its fonts and
    its stretchy symbols (SIL Open Font License 1.1), as the first comments of engine/katex/katex.css."""
    from engine_fonts import license_notice
    css = (ROOT / "engine" / "katex" / "katex.css").read_text(encoding="utf-8")
    katex = [c for c in re.findall(r"/\*.*?\*/", css.split("@font-face", 1)[0], re.S) if "Copyright" in c]
    if not (any("MIT License" in c for c in katex) and any("SIL OPEN FONT LICENSE" in c for c in katex)):
        raise SystemExit("engine/katex/katex.css: the licence comments of KaTeX and its fonts not found")
    return license_notice([name for _, _, name in FONTS]) + "\n".join(katex) + "\n"


def fonts_css(text):
    """Subset each font to the characters of the page and return @font-face rules."""
    try:
        import fontTools  # noqa: F401
    except ImportError:
        sys.exit("fontTools not found: run  make deps  (or pip install -r requirements.txt)")
    chars = "".join(sorted(set(text) | set("0123456789/ "))).replace("\n", "")
    rest = "".join(sorted(set(chars) - {chr(c) for c in coverage("LMSans") | coverage("JPGothic")})) or " "
    rules = []
    for fam, wt, name in FONTS:
        woff = subset(font_path(name), rest if fam == "LMMath" else chars)
        uri = "data:font/woff;base64," + base64.b64encode(woff).decode()
        rules.append(f"@font-face{{font-family:\"{fam}\";font-weight:{wt};"
                     f"src:url({uri}) format(\"woff\")}}")
    return "\n".join(rules)


MATH = re.compile(r"\\\((.+?)\\\)")


def render_math(src):
    """Replace every \\(TeX\\) with KaTeX's HTML (rendered by tools/katex_render.js)."""
    texs = MATH.findall(src)
    if not texs:
        return src
    if not (KATEX / "katex.min.js").exists():
        sys.exit("KaTeX not found: run  make deps  (or npm ci --prefix tools)")
    out = subprocess.run(["node", str(ROOT / "tools" / "katex_render.js")], input=json.dumps(texs),
                         capture_output=True, text=True, check=True).stdout
    rendered = iter(json.loads(out))
    return MATH.sub(lambda m: next(rendered), src)


TAG = re.compile(r"(<!--.*?-->|</?[A-Za-z][\w-]*(?:\s[^>]*)?>)", re.S)
# inline elements continue the paragraph; any other tag (or a comment, or <br>) ends it
INLINE = {"span", "b", "i", "strong", "em", "sub", "sup", "a", "wbr"}
CJK = re.compile(r"[　-ヿ㐀-鿿＀-￯]")
# Japanese punctuation. Under keep-all Chrome still breaks after closing punctuation and
# before opening brackets but WebKit does not, so those breaks get a <wbr> too. No <wbr> goes
# before a character that must not start a line or after one that must not end it.
CLOSE = set("、。，．）」』】〕〉》・：；！？")
OPEN = set("（「『【〔〈《")
NO_START = CLOSE | set("ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ)]},.:;!?")
NO_END = OPEN | set("([{")


def phrases(texts):
    """BudouX phrases of each string (tools/phrase_breaks.js)."""
    if not texts:
        return []
    if not (ROOT / "tools" / "node_modules" / "budoux").exists():
        sys.exit("BudouX not found: run  make deps  (or npm ci --prefix tools)")
    out = subprocess.run(["node", str(ROOT / "tools" / "phrase_breaks.js")], input=json.dumps(texts),
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def mask(text):
    """text with each \\(math\\) masked as one character, and the offset in text of each
    masked character (plus the end)."""
    masked, where = "", []
    pos = 0
    for m in MATH.finditer(text):
        for k in range(pos, m.start()):
            masked += text[k]; where.append(k)
        masked += "￼"; where.append(m.start())
        pos = m.end()
    for k in range(pos, len(text)):
        masked += text[k]; where.append(k)
    return masked, where + [len(text)]


def phrase_breaks(src):
    """Insert <wbr> between the phrases of every paragraph of the slides (inline SVG excluded)."""
    a = src.index("</style>"); b = src.rindex("<script>")
    toks = TAG.split(src[a:b])
    runs, cur, in_svg = [], [], 0
    for i, t in enumerate(toks):
        if i % 2 == 0:
            if t and not in_svg:
                cur.append(i)
            continue
        name = re.match(r"(</?)([A-Za-z][\w-]*)", t)
        if name and name.group(2).lower() == "svg":
            in_svg += -1 if name.group(1) == "</" else (0 if t.endswith("/>") else 1)
        if not (name and name.group(2).lower() in INLINE):
            runs.append(cur); cur = []
    runs.append(cur)
    runs = [r for r in runs if any(CJK.search(toks[i]) for i in r)]
    paras = []
    for r in runs:
        ms = [mask(toks[i]) for i in r]
        paras.append((r, ms, "".join(m for m, _ in ms)))
    ins = {}  # token index -> offsets for <wbr>
    for (r, ms, whole), ph in zip(paras, phrases([p[2] for p in paras])):
        ends, n = set(), 0
        for p in ph[:-1]:
            n += len(p); ends.add(n)
        ends |= {e for e in range(1, len(whole)) if whole[e - 1] in CLOSE or whole[e] in OPEN}
        ends = sorted(e for e in ends if whole[e] not in NO_START and whole[e - 1] not in NO_END)
        base = 0
        for i, (m, where) in zip(r, ms):
            for e in ends:
                j = e - base
                if 0 < j <= len(m):
                    if j == len(m) and e == len(whole):
                        continue
                    left, right = whole[e - 1], whole[e] if e < len(whole) else " "
                    if left.isspace() or right.isspace():
                        continue
                    off = where[j]
                    if re.search(r"&[#\w]*$", toks[i][:off]):
                        continue
                    ins.setdefault(i, set()).add(off)
            base += len(m)
    for i, offs in ins.items():
        t = toks[i]
        for off in sorted(offs, reverse=True):
            t = t[:off] + "<wbr>" + t[off:]
        toks[i] = t
    body = "".join(toks)

    def caps(m):
        parts = m.group(1).split("|")
        return 'data-caps="' + "|".join("​".join(p) for p in phrases(parts)) + '"'
    body = re.sub(r'data-caps="([^"]*)"', caps, body)
    return src[:a] + body + src[b:]


def katex_css():
    """KaTeX's stylesheet with the fonts in KATEX_FONTS embedded and the others dropped."""
    css = (KATEX / "katex.min.css").read_text(encoding="utf-8")

    def face(m):
        name = re.search(r"url\(fonts/(KaTeX_[\w-]+)\.woff2\)", m.group(0)).group(1)
        if name not in KATEX_FONTS:
            return ""
        uri = "data:font/woff2;base64," + base64.b64encode((KATEX / "fonts" / f"{name}.woff2").read_bytes()).decode()
        return re.sub(r"src:[^}]*", f'src:url({uri}) format("woff2")', m.group(0))
    css = re.sub(r"@font-face\{[^}]*\}", face, css)
    # math at the size of the surrounding text (KaTeX's default is 1.21em)
    return css + "\n.katex{font-size:1.05em}"


def main():
    src = (ROOT / "html" / "slide.src.html").read_text(encoding="utf-8")
    src = re.sub(r"<!--SVGS (\S+) (w\d+) (\S+)-->", toggled, src)
    src = re.sub(r"<!--SVG (\S+) (w\d+)(?: (\S+))?(?: (\d+))?-->", drawn, src)
    check_glyphs(src)
    src = phrase_breaks(src)
    src = render_math(src)
    body = re.sub(r"<style>.*?</style>", "", src, flags=re.S)
    src = src.replace("/*FONTS*/", license_notices() + fonts_css(body) + "\n" + katex_css(), 1)
    out = re.sub(r"<!--IMG (\S+) (w\d+)-->", image, src)
    left = re.findall(r"<!--(?:SVGS?|IMG) [^>]*-->", out)
    if left:
        sys.exit(f"unresolved placeholders: {left}")
    (ROOT / "slide.html").write_text(out, encoding="utf-8")
    print(f"slide.html: {len(out)/1024:.0f} KiB")


if __name__ == "__main__":
    main()
