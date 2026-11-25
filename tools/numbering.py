#!/usr/bin/env python3
"""The numbers of the statements of a Kamishibai draft, and the references to them, as the engine makes them
(<html numbering="deck|section">; see "Numbers of the statements" in engine/kamishibai.js).

  python3 tools/numbering.py DRAFT.html     list the numbers; exit code 1 when a name or a number is wrong

It reads the draft as text: the boxes are the tags <block>, <alertblock>, <exampleblock>, <later> inside
<cover>, <slide>, <divider>. tools/check_order.py reads a numbered draft through expand(), and
tools/pack_engine.py prints the problems. A draft with no numbering attribute has no numbers and no problems,
and expand() returns it as it is.
"""
import html
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

ENGINE_TAG = re.compile(r"""<script\b[^>]*\bsrc=(["'])([^"']*?)kamishibai\.js\1[^>]*>\s*</script>""", re.I)
ENGINE = Path(__file__).resolve().parent.parent / "engine" / "kamishibai.js"
PAGES = {"cover", "slide", "divider"}
BOXES = {"block", "alertblock", "exampleblock", "later"}
OPAQUE = {"script", "style", "noscript", "textarea", "pre", "code", "option"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
        "track", "wbr"}
REF = re.compile(r"\\(ref|num)\{([^{}]*)\}")
TITLE = re.compile(r"""(\stitle\s*=\s*)("[^"]*"|'[^']*')""", re.I)
LATTR = ("title", "cite", "label", "sec", "aff", "short")


class Kinds:
    def __init__(self, engine_js):
        self.ja = re.findall(r'"([^"]+)"', re.search(r"BLOCK_KINDS\s*=\s*\[([^\]]*)\]", engine_js).group(1))
        m = re.search(r"KIND_EN\s*=\s*\{([^}]*)\}", engine_js)
        self.en = dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', m.group(1))) if m else {}
        alt = lambda ws: "|".join(map(re.escape, sorted(ws, key=len, reverse=True)))
        self.head_ja = re.compile(r"\s*(%s)(?:\s*([0-9０-９]+(?:[.．][0-9０-９]+)*)|(?=[\s（(［\[「]|$))" % alt(self.ja))
        self.head_en = re.compile(r"\s*(%s)(?:\s+([0-9]+(?:\.[0-9]+)*)|(?=[\s(\[]|$))"
                                  % alt(self.en.values()).replace("\\ ", r"\s+"), re.I) if self.en else None

    def head(self, s):
        return self.head_ja.match(s) or (self.head_en.match(s) if self.head_en else None)

    def kind(self, w):
        if w in self.ja:
            return w
        w = re.sub(r"\s+", " ", w).lower()
        return next(k for k, e in self.en.items() if e.lower() == w)


def kinds_of(src, path=None):
    """The kinds in the engine the draft loads (this repository's engine when it cannot be read)."""
    m = ENGINE_TAG.search(src)
    f = (Path(path).parent / html.unescape(m.group(2) or "./") / "kamishibai.js") if m and path else ENGINE
    return Kinds((f if f.exists() else ENGINE).read_text(encoding="utf-8"))


class Reader(HTMLParser):
    """The html attributes; the pages [(tag, attributes, [box])]; each box with its offset in the source, its
    language side ("en" for the English of a pair of boxes) and, for that, the box of the Japanese; and the
    references in the text and the attributes of the pages."""

    def __init__(self, src):
        super().__init__(convert_charrefs=False)
        self.src, self.root, self.pages, self.refs = src, {}, [], []
        self.lines = [0]
        for m in re.finditer("\n", src):
            self.lines.append(m.end())
        self.stack = []  # [tag, L-en pair or None, last child: (is ja, its boxes), boxes inside]
        self.feed(src)
        self.close()

    def at(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        a = {k: v or "" for k, v in attrs}
        if tag == "html":
            self.root = a
        page = tag in PAGES and not any(t[0] in PAGES for t in self.stack)
        if page:
            self.pages.append((tag, a, []))
        inside = page or any(t[0] in PAGES for t in self.stack)
        if inside and not any(t[0] in OPAQUE for t in self.stack):
            for k in LATTR:
                for key in (k, k + "-en"):
                    for m in REF.finditer(a.get(key, "")):
                        self.refs.append((len(self.pages) - 1, m.group(1), m.group(2).strip()))
        lang = "ja" if tag == "ja" else "en" if tag == "en" else a.get("lang", "").lower()
        prev = self.stack[-1][2] if self.stack else None
        pair = {"of": prev["boxes"], "n": 0} if inside and re.match(r"en\b", lang) and prev and prev["ja"] else None
        me = {"ja": bool(re.match(r"ja\b", lang)), "boxes": []}
        if self.stack:
            self.stack[-1][2] = me
        if tag not in VOID:
            self.stack.append([tag, pair, None, me["boxes"]])
        if tag in BOXES and inside:
            b = {"tag": tag, "a": a, "at": self.at(), "end": self.at() + len(self.get_starttag_text()), "mate": None}
            for t in self.stack:
                t[3].append(b)
            side = next((t[1] for t in reversed(self.stack) if t[1]), None)
            if side:
                side["n"] += 1
                b["mate"] = side["of"][side["n"] - 1] if side["n"] <= len(side["of"]) else None
            self.pages[-1][2].append(b)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)  # "/>" closes nothing in HTML

    def handle_endtag(self, tag):
        if any(t[0] == tag for t in self.stack):
            while self.stack.pop()[0] != tag:
                pass

    def handle_data(self, data):
        names = [t[0] for t in self.stack]
        if any(n in PAGES for n in names) and not any(n in OPAQUE for n in names):
            for m in REF.finditer(data):
                self.refs.append((len(self.pages) - 1, m.group(1), html.unescape(m.group(2)).strip()))


def after(s, auto):
    if re.fullmatch(r"[0-9]+", s):
        return str(int(s) + 1)
    return chr(ord(s) + 1) if re.fullmatch(r"[A-Y]", s) else str(auto + 1)


def numbers(src, kinds):
    """(entries, problems, entry of a name): an entry is a dict with page (from 1), kind, ja, number, name, box, insert; a
    problem is (page, text)."""
    r = Reader(src)
    words = r.root.get("numbering", "").split()
    mode = next((w for w in words if w in ("deck", "section")), None)
    entries, problems, named = [], [], {}
    if not mode:
        return entries, problems, named
    each, off = "each" in words, r.root.get("unnumbered", "").split()
    sec, name, count, auto, of_box = None, None, {}, 0, {}
    for i, (tag, a, boxes) in enumerate(r.pages, 1):
        if mode == "section" and tag == "slide":
            was, n = sec, a.get("secno", "").strip()
            starts = "sec" in a and a["sec"] != name
            name = a.get("sec", name)
            if n:
                sec = None if n == "none" else n
            elif starts:
                sec = after(str(auto) if sec is None else sec, auto)
            if sec and re.fullmatch(r"[0-9]+", sec):
                auto = int(sec)
            if sec != was:
                count = {}
        for b in boxes:
            t, t_en = b["a"].get("title", ""), b["a"].get("title-en")
            h, he = kinds.head(t), kinds.head(t_en) if t_en is not None else None
            bid, own, like = b["a"].get("name", "").strip(), b["a"].get("number"), b["a"].get("same")
            own = own.strip() if own is not None else None
            if not h:
                if bid or own or like:
                    problems.append((i, f"no number for the box titled \"{t}\": its title starts with no kind of statement"))
                continue
            kind = kinds.kind(h.group(1))
            e = {"page": i, "kind": kind, "ja": h.group(1) if h.group(1) in kinds.ja else kind, "number": None,
                 "name": bid, "box": b, "insert": True, "same": like.strip() if like is not None else None}
            mate = of_box.get(id(b["mate"]))
            if mate:
                e["mate"] = mate
                of_box[id(b)] = e
                continue
            if e["same"]:
                pass
            elif own == "none" or (own is None and kind in off):
                e["insert"] = False
            elif own is None and h.group(2):
                e["number"], e["insert"] = h.group(2), False
            elif own not in (None, "auto") and not re.fullmatch(r"[0-9]+", own):
                e["number"] = own
            else:
                k = kind if each else ""
                count[k] = int(own) if own not in (None, "auto") else count.get(k, 0) + 1
                e["number"] = (sec + "." if mode == "section" and sec is not None else "") + str(count[k])
                if mode == "section" and sec is None:
                    problems.append((i, f"no section number for the box titled \"{t}\" (it is before the first numbered section)"))
            if e["insert"] and he and he.group(2) and not h.group(2):
                problems.append((i, f"title-en has a number written by hand: \"{t_en}\""))
            if e["insert"] and t_en is not None and not he:
                problems.append((i, f"no number in title-en: it starts with no kind of statement: \"{t_en}\""))
            of_box[id(b)] = e
            entries.append(e)
            if bid and bid in named:
                problems.append((i, f"the name \"{bid}\" is given twice (first on page {named[bid]['page']})"))
            elif bid:
                named[bid] = e
    for e in entries:
        if not e["same"]:
            continue
        t, n = named.get(e["same"]), 0
        while t and t["same"] and n < 50:
            t, n = named.get(t["same"]), n + 1
        if not t or t["same"] or t["number"] is None:
            problems.append((e["page"], f"same=\"{e['same']}\" names no statement with a number"))
            e["number"] = "??"
        else:
            e["number"] = t["number"]
    seen = {}  # the same kind and number twice, one of them given here
    for e in entries:
        if e["same"] or e["number"] is None:
            continue
        f = seen.setdefault((e["kind"], unicodedata.normalize("NFKC", e["number"])), e)
        if f is not e and (e["insert"] or f["insert"]):
            problems.append((e["page"], f"{e['ja']} {e['number']} is there twice (first on page {f['page']}; same=\"…\" when it is one statement)"))
    for i, cmd, ref in r.refs:
        e = named.get(ref)
        if not e:
            problems.append((i + 1, f"\\{cmd}{{{ref}}} names no statement"))
        elif cmd == "num" and e["number"] is None:
            problems.append((i + 1, f"\\num{{{ref}}} names a statement with no number"))
    return entries, sorted(problems), named


def expand(src, kinds):
    """The draft with the numbers in the Japanese titles and the references written out in Japanese (for
    check_order.py; not a draft to keep)."""
    entries, _, named = numbers(src, kinds)
    if not entries:
        return src
    out, pos = [], 0
    for e in sorted((e for e in entries if e["insert"]), key=lambda e: e["box"]["at"]):
        b = e["box"]
        m = TITLE.search(src, b["at"], b["end"])
        if not m:  # a title with no quotes: left as it is
            continue
        q, t = m.group(2)[0], html.unescape(m.group(2)[1:-1])
        h = kinds.head(t)
        t = t[:h.end(1)] + " " + e["number"] + t[h.end(1):]
        out += [src[pos:m.start(2)], q, html.escape(t), q]
        pos = m.end(2)
    text = "".join(out) + src[pos:]

    def ref(m):
        e = named.get(html.unescape(m.group(2)).strip())
        if not e or (m.group(1) == "num" and e["number"] is None):
            return "??"
        return e["number"] if m.group(1) == "num" else e["ja"] + (" " + e["number"] if e["number"] else "")
    return REF.sub(ref, text)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__.split("\n\n")[1].strip())
    src = Path(sys.argv[1]).read_text(encoding="utf-8")
    entries, problems, _ = numbers(src, kinds_of(src, sys.argv[1]))
    if not re.search(r"<html\b[^>]*\snumbering\s*=", src, re.I):
        print("the draft has no <html numbering=…>: its numbers are written by hand")
    for e in entries:
        print(f"page {e['page']:3}  {e['ja']} {e['number'] or '-'}" + (f"  ({e['name']})" if e["name"] else ""))
    for i, p in problems:
        print(f"page {i}: {p}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
