#!/usr/bin/env python3
"""Check and stamp the Japanese/English pairs of a Kamishibai draft (see "Japanese and English" in
engine/kamishibai.js). The English is written outside (by hand or a translator); this tool only reads
the pairs and records which Japanese each English was made from.

  python3 tools/lang_pairs.py check DRAFT.html          list what is missing or out of date
  python3 tools/lang_pairs.py stamp DRAFT.html          record the Japanese of each English that has no record
  python3 tools/lang_pairs.py stamp --force DRAFT.html  record it again for every English (after updating them)

A pair is <ja>…</ja><en>…</en>, or an element with lang="en" right after one with lang="ja", or an
attribute X with X-en (X in title, cite, label, sec, aff, short). The record is <en ja="hash"> (or
X-en-ja="hash"), the FNV-1a (32 bit) of the UTF-8 of the Japanese text with white space collapsed:
the same hash as in the engine, which marks an English whose Japanese has changed in edit mode.

check reports, with line numbers:
  untr      Japanese text outside any pair (shown in both languages)
  attr      an attribute with Japanese and no X-en
  solo      a <ja> with no English after it, or an <en> with no Japanese before it
  stale     an English whose recorded Japanese differs from the Japanese now
  unstamped an English with no record (run stamp)
A deck with no English at all is a Japanese-only deck: check says so and exits 0.
Exit status of check: 1 when there is anything to report, else 0.
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

LATTR = ["title", "cite", "label", "sec", "aff", "short"]
PAGES = {"cover", "slide", "divider"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
        "track", "wbr"}
# end tags a browser implies: a start tag of the key closes an open element of the value, looking down the
# open elements no further than a scope boundary (HTML's "button scope", "list item scope", table scope)
CLOSES_P = {"address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset",
            "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup",
            "hr", "li", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul", "dd", "dt"}
SCOPE = {"applet", "caption", "html", "table", "td", "th", "marquee", "object", "template", "svg", "math"}
IMPLIED = [  # (start tags, the element they close, extra scope boundaries)
    (CLOSES_P, {"p"}, {"button"}),
    ({"li"}, {"li"}, {"ol", "ul"}),
    ({"dt", "dd"}, {"dt", "dd"}, {"dl"}),
    ({"td", "th", "tr"}, {"td", "th"}, {"tr"} - {"td", "th"}),
    ({"tr"}, {"tr"}, {"tbody", "thead", "tfoot"}),
    ({"option"}, {"option"}, {"select"}),
]
JP = re.compile(r"[぀-ヿ㐀-䶿一-鿿]")


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def fnv(s):
    h = 0x811C9DC5
    for b in norm(s).encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


class El:
    def __init__(self, tag, attrs, parent, line, start, raw):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.line, self.start, self.raw = line, start, raw  # start offset and text of the start tag
        self.kids = []  # El or str
        self.cls = set()

    def text(self):
        return "".join(k if isinstance(k, str) else k.text() for k in self.kids)

    def elements(self):
        return [k for k in self.kids if isinstance(k, El)]

    def walk(self):
        yield self
        for k in self.elements():
            yield from k.walk()

    def lang(self):
        return (self.attrs.get("lang") or "").lower()

    def is_ja(self):
        return self.tag == "ja" or re.match(r"ja\b", self.lang()) is not None

    def inside(self, pred):
        e = self
        while e is not None:
            if pred(e):
                return True
            e = e.parent
        return False


class Tree(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.src = src
        self.offsets = [0]
        for line in src.splitlines(keepends=True):
            self.offsets.append(self.offsets[-1] + len(line))
        self.root = El("#root", [], None, 1, 0, "")
        self.stack = [self.root]
        self.texts = []  # (str, parent El, line)
        self.feed(src)
        self.close()

    def _pos(self):
        line, col = self.getpos()
        return line, self.offsets[line - 1] + col

    def implied_end(self, tag):
        for starts, closes, extra in IMPLIED:
            if tag not in starts:
                continue
            for i in range(len(self.stack) - 1, 0, -1):
                t = self.stack[i].tag
                if t in closes:
                    del self.stack[i:]
                    break
                if t in SCOPE - closes or t in extra:
                    break

    def handle_starttag(self, tag, attrs):
        self.implied_end(tag)
        line, off = self._pos()
        e = El(tag, attrs, self.stack[-1], line, off, self.get_starttag_text())
        self.stack[-1].kids.append(e)
        if tag not in VOID:
            self.stack.append(e)

    def handle_startendtag(self, tag, attrs):
        line, off = self._pos()
        self.stack[-1].kids.append(El(tag, attrs, self.stack[-1], line, off, self.get_starttag_text()))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].kids.append(data)
        self.texts.append((data, self.stack[-1], self.getpos()[0]))


def mark(tree):
    """Give each element the classes the engine gives it: L-ja, L-en, solo, stale. Return the pages."""
    pages = [e for e in tree.root.walk() if e.tag in PAGES]
    for pg in pages:
        for e in pg.walk():
            if e.tag == "ja":
                e.cls.add("L-ja")
            elif e.tag == "en":
                e.cls.add("L-en")
        for e in pg.walk():
            if e.tag != "en" and re.match(r"en\b", e.lang()):
                p = prev(e)
                if p is not None and p.is_ja():
                    e.cls.add("L-en")
                    p.cls.add("L-ja")
        for e in pg.walk():
            if "L-en" in e.cls:
                p = prev(e)
                if p is None or not p.is_ja():
                    e.cls.add("solo")
                elif "ja" in e.attrs and e.attrs["ja"] != fnv(p.text()):
                    e.cls.add("stale")
            if e.tag == "ja":
                n = nxt(e)
                if n is None or "L-en" not in n.cls:
                    e.cls.add("solo")
    return pages


def prev(e):
    sib = e.parent.elements()
    i = sib.index(e)
    return sib[i - 1] if i > 0 else None


def nxt(e):
    sib = e.parent.elements()
    i = sib.index(e)
    return sib[i + 1] if i + 1 < len(sib) else None


def snippet(s, n=40):
    s = norm(s)
    return s if len(s) <= n else s[:n] + "…"


def check(path):
    tree = Tree(path.read_text(encoding="utf-8"))
    pages = mark(tree)
    els = [e for pg in pages for e in pg.walk()]
    has_en = any("L-en" in e.cls for e in els) or any(a + "-en" in e.attrs for e in els for a in LATTR)
    if not has_en:
        print(f"{path}: no English in the deck (Japanese only)")
        return 0
    out = []
    in_pages = set(map(id, els))
    for s, p, line in tree.texts:
        if id(p) not in in_pages or not JP.search(s):
            continue
        if p.inside(lambda e: "L-ja" in e.cls or "L-en" in e.cls or e.tag in ("script", "style")):
            continue
        out.append((line, "untr", snippet(s)))
    for e in els:
        for a in LATTR:
            if a in e.attrs and JP.search(e.attrs[a]):
                if a + "-en" not in e.attrs:
                    out.append((e.line, "attr", f'<{e.tag} {a}="{snippet(e.attrs[a], 30)}"> has no {a}-en'))
                elif a + "-en-ja" not in e.attrs:
                    out.append((e.line, "unstamped", f"{a}-en of <{e.tag}>"))
                elif e.attrs[a + "-en-ja"] != fnv(e.attrs[a]):
                    out.append((e.line, "stale", f'{a}-en="{snippet(e.attrs[a + "-en"], 30)}"'))
        if "solo" in e.cls:
            what = "Japanese with no English" if "L-ja" in e.cls else "English with no Japanese before it"
            out.append((e.line, "solo", f"{what}: {snippet(e.text())}"))
        elif "stale" in e.cls:
            out.append((e.line, "stale", snippet(e.text())))
        elif "L-en" in e.cls and "ja" not in e.attrs:
            out.append((e.line, "unstamped", snippet(e.text())))
    for line, kind, msg in sorted(out, key=lambda x: x[0]):
        print(f"{path}:{line}: {kind:9} {msg}")
    counts = {}
    for _, k, _ in out:
        counts[k] = counts.get(k, 0) + 1
    print(f"{path}: " + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) if out else "all pairs in order"))
    return 1 if out else 0


def set_attr(raw, name, value):
    """The start tag raw with attribute name set to value."""
    pat = re.compile(r"(\s" + re.escape(name) + r"\s*=\s*)(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
    if pat.search(raw):
        return pat.sub(lambda m: m.group(1) + '"' + value + '"', raw, count=1)
    end = len(raw) - (2 if raw.endswith("/>") else 1)
    return raw[:end].rstrip() + f' {name}="{value}"' + raw[end:]


def stamp(path, force):
    src = path.read_text(encoding="utf-8")
    tree = Tree(src)
    pages = mark(tree)
    edits = {}  # start offset -> (old raw, new raw)
    n = 0
    for pg in pages:
        for e in pg.walk():
            raw = edits.get(e.start, (e.raw, e.raw))[1]
            if "L-en" in e.cls and "solo" not in e.cls and (force or "ja" not in e.attrs):
                raw = set_attr(raw, "ja", fnv(prev(e).text()))
                n += 1
            for a in LATTR:
                if a in e.attrs and a + "-en" in e.attrs and (force or a + "-en-ja" not in e.attrs):
                    raw = set_attr(raw, a + "-en-ja", fnv(e.attrs[a]))
                    n += 1
            if raw != e.raw:
                edits[e.start] = (e.raw, raw)
    out, last = [], 0
    for off in sorted(edits):
        old, new = edits[off]
        assert src[off:off + len(old)] == old, f"start tag not found at offset {off}"
        out += [src[last:off], new]
        last = off + len(old)
    out.append(src[last:])
    if n:
        path.write_text("".join(out), encoding="utf-8")
    print(f"{path}: {n} record(s) written" + ("" if n else " (nothing to stamp)"))
    return 0


def main(argv):
    force = "--force" in argv
    args = [a for a in argv if a != "--force"]
    if len(args) != 2 or args[0] not in ("check", "stamp"):
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    path = Path(args[1])
    return check(path) if args[0] == "check" else stamp(path, force)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
