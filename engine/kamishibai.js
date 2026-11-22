/* ===== 紙芝居エンジン（kamishibai.js）=====
  Kamishibai, developed jointly by TonanKamata and ShiotaTakumi. CC0 1.0 Universal (engine/LICENSE).
  タグで書いた下書きを組む本体に、紙芝居（html/slide.src.html）の見た目・部品・段階表示・クリックの扱いを
  合わせたもの。ビルドなしで、ファイルを直接ブラウザで開いて使う。

  ■ 使い方：下書きの HTML（engine/sample.html を見る）の最初に
      <html lang="ja" theme="Boadilla">            テーマ（themes/ の中のファイルの名前。書かなければ Boadilla）
      <script src="engine/kamishibai.js"></script> この engine/ への相対パス
    と書き、その後ろにページをタグで並べる。URL に ?theme=Madrid を付けると、そのテーマで開く。
    書体は engine/fonts/kamishibai-fonts.css（make engine-fonts で作る）。無くても手元の書体で出る。

  ページ
    <cover>…</cover>                    表紙。<headline>題名</headline> <subtitle>副題</subtitle>
                                        <author aff="所属" presenter>名前</author>（何人でも） <meeting>会の名前</meeting> <date>日付</date>
    <slide title="見出し" sec="節の名前">…</slide>   ふつうのページ。sec のあるページから、別の名前の sec の前までが一つの節（同じ名前を続けて書いてもよい）
                                        （Boadilla では上の見出し帯に、節の名前とページごとの丸が出る）
    <divider>参考資料</divider>          区切りのページ

  ページの中
    <p>…</p>  <list><item>…</item></list>（item の中に list で 2 段目）
    <block title="…" cite="[…]">…</block>   箱。<alertblock>・<exampleblock> も同じ
    <note>…</note>  <down>…</down>  <columns><column>…</column><column>…</column></columns>
    <figure><img src="図.png"></figure>   <table class="tbl">…</table>
                                        図にキャプション（figcaption、「図：…」の文）を付けない。図は頁の文の下に置く
    class で使う部品：qa / qa-label / navy-normal / label / pink / frame / mark / bar / play / sw
    文の中：<red> <navy> <b> <cite> <frac><num>…</num><den>…</den></frac> <ruby> <nobr> ➡（赤い矢印）

  ページの中（紙芝居の部品）
    <alert>…</alert>                    強調（\alert。class="k" と同じ）
    <proof title="証明">…</proof>        証明（左の線）。title を省くと「証明」
    <plan title="証明の方針">…</plan>    証明の方針（淡い地）
    <later title="補題 2（次の頁で証明）">…</later>   後で証明する主張（破線の枠）
    <nums><item>…</item></nums>         番号つきの手順（丸数字）。<nums labels> と <item label="(i)"> で文字のラベル
    <side><div>…</div><figure>…</figure></side>   文を左、図を右に並べる（アルゴリズムなど段階を追う説明だけの例外）
    <flip id="fyn"><svg>…</svg><svg>…</svg></flip>  重ねた図を 1 枚ずつ見せる（大きさはいちばん大きな図。width・height でも決められる）
    <switch for="fyn"><button>できる</button><button>できない</button></switch>   図を切り替えるボタン
    <figcaption for="fyn" caps="…|…">…</figcaption>   旧い書き方（ボタンの名前と caps を出す）。使わない：ボタンの名前で足りる
    <flip id="…" anim init="1"><svg>…<g class="cd">…</g>…<g class="ov">…</g></svg></flip>
                                        段階的に組み上がる図：class="cd" の群を 1 つずつ、class="ov" の群をまとめて出す。
                                        init は最初から出ている枚数。step のタグに cards="n"（"*" は全部、図ごとに "a|b"）を付けると、
                                        その段階で n 枚目まで出る。ov を付けた段階で class="ov" の群が出る
    class だけでも使える：two（2 段組）・fig・cap・tb（素の表）・blk・pts・nums・pf・ph・nb

  数式：$…$・\(…\)（文の中）、$$…$$・\[…\]（1 行に取って中央）。もう組んである数式（.katex）を含む要素は組み直さない

  段階表示：どのタグにも step を付けると、クリック（→）で 1 つずつ出る。with="prev" を付けると直前の step と一緒に出る
        （← で戻るときも一緒に消える）。class="reveal" も step と同じ。
        キー S で「全部出す」と切り替える（ページだけを送る。組み上がる図は、ページを開いたときに最後まで動く）。
        選んだほうはブラウザが覚える。
  大きさ・行間・空き：size="32"・line="1.4"・before="12"・after="12"（pt）
  テーマ：画面の大きさ（--W・--H）、書体、かっこ・句読点の空き（--jp-pad）はテーマの CSS が決める。
        Boadilla（16:9、1280 × 720、既定）・Madrid（4:3、960 × 720。書体は fonts/cm-sans.css・fonts/ipa-pgothic.css）

  ■ 発表
    → / Space / Enter / クリックで進む。← / 画面の左 1/4 のクリックで戻る。Home / End。S 段階表示の切り替え。
    クリックは、少し待ってから送る（ダブルクリック・トリプルクリック・ドラッグ・文字の選択とその解除では送らない）。
    ⌘F 全画面、⌘B ページ一覧、⌘K ポインター、⌘E 選択、⌘U キー無効、⌘P 印刷（Windows では Ctrl）。左下の ▷ に同じボタン。
    PDF のボタンは step ごとに分けて印刷する。#s5 を付けると 5 枚目から開く。

  ■ 図のコード（figure.js）
    FIG["svg の id"] = function (svg) { … }    figure("id", function (svg, still) { … })
    mk・txt・follow・watchStep・fromPrev・RUNNING・ease・camera・shade・lid など（使い方は figure.js）

  ■ 配る形（tools/pack_engine.py、make pack SRC=下書き）
    下書きを 1 つの HTML（下書き.dist.html）にまとめる。このファイルは <script data-packed="テーマ名"> として中に入り、
    data-packed があると CSS・書体・KaTeX・figure.js を読み込まない（どれも同じファイルに入っている）。
    テーマはその名前に決まり、?theme= は効かない。数式はまとめるときに KaTeX で組んであり、ここでは KaTeX の
    auto-render が、KaTeX の代わりの小さな関数から組んだものを受け取って差し込む。直すのは下書きのほう

  ■ このフォルダ（engine/）
    kamishibai.js（このファイル）・figure.js・base.css・themes/・katex/（KaTeX 0.19.0、MIT License。CC0 の外）・fonts/（作る。git の外）
*/
var Kamishibai = {};
(function () {
"use strict";

/* ===== Loading: CSS, fonts, KaTeX and the figure helpers next to this file =====
   document.write puts them right here, so the figure helpers exist before the page's last <script>.
   Fonts are inside CSS files, because a page opened from file:// cannot fetch font files. */
/* Packed file (tools/pack_engine.py): this script is inline with data-packed="THEME"; the CSS, fonts,
   math and figure helpers are already in the file, so nothing is loaded and the theme is fixed */
/* Kinds of statement a box (<block>, <alertblock>, <exampleblock>) may hold: its title starts with one of them.
   tools/check_blocks.py reads this list */
const BLOCK_KINDS = ["定義", "定理", "主定理", "補題", "系", "命題", "主張", "予想", "未解決問題", "問題", "主結果", "仮定", "公理"];
const BLOCK_HEAD = new RegExp("^(" + BLOCK_KINDS.slice().sort((a, b) => b.length - a.length).join("|") + ")(\\s|\\d|（|$)");
const me = document.currentScript, packed = me && me.getAttribute("data-packed");
Kamishibai.packed = !!packed;
const q = packed ? null : (location.search.match(/[?&]theme=([A-Za-z]+)/) || [])[1];
const name = packed || q || document.documentElement.getAttribute("theme") || "Boadilla";
Kamishibai.theme = /^[A-Za-z]+$/.test(name) ? name : "Boadilla";
if (!packed) {
  const dir = me.src.replace(/[^/]*$/, "");
  /* font stylesheets per theme (missing files are tolerated: the theme falls back to system fonts) */
  const FONT_CSS = { Madrid: ["fonts/ipa-pgothic.css", "fonts/cm-sans.css"] };
  const fontCss = FONT_CSS[Kamishibai.theme] || ["fonts/kamishibai-fonts.css"];
  ["katex/katex.css"].concat(fontCss, ["base.css", "themes/" + Kamishibai.theme + ".css"]).forEach(function (f) {
    document.write('<link rel="stylesheet" href="' + dir + f + '">');
  });
  ["katex/katex.js", "figure.js"].forEach(function (f) {
    document.write('<script src="' + dir + f + '"><\/script>');
  });
}

/* ===== Build the deck from the tags (after the content is parsed) ===== */
function build() {
const $new = function (tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const root = document.documentElement, body = document.body;
const cssVar = function (n) { return getComputedStyle(root).getPropertyValue(n).trim(); };

const stage = $new("div", "stage"), deck = $new("div", "deck");
deck.appendChild(stage);
const pages = [].filter.call(body.children, e => /^(COVER|SLIDE|DIVIDER)$/.test(e.tagName));
const STEP = "[step]:not(input)";   // step on <input> is the slider increment

/* Kamishibai's class="reveal" / data-* spellings are accepted as the tag attributes */
pages.forEach(function (pg) {
  pg.querySelectorAll(".reveal").forEach(function (e) { e.classList.remove("reveal"); e.setAttribute("step", ""); });
  ["with", "cards", "ov", "init"].forEach(function (a) {
    pg.querySelectorAll("[data-" + a + "]").forEach(function (e) { if (!e.hasAttribute(a)) e.setAttribute(a, e.getAttribute("data-" + a)); });
  });
});

/* Footer text (Madrid) taken from the cover; short="…" wins. <rt> dropped, <br> -> space */
function plain(e) {
  if (e.hasAttribute("short")) return e.getAttribute("short");
  const c = e.cloneNode(true);
  c.querySelectorAll("rt").forEach(r => r.remove());
  c.querySelectorAll("br").forEach(b => b.replaceWith(" "));
  return c.textContent.replace(/\s+/g, " ").trim();
}
const FOOT = { who: "", title: "", date: "" };
const cov = pages.find(e => e.tagName === "COVER");
if (cov) {
  const a = cov.querySelector("author[presenter]") || cov.querySelector("author"), h = cov.querySelector("headline"), d = cov.querySelector("date");
  if (a) FOOT.who = a.hasAttribute("short") ? a.getAttribute("short") : plain(a) + (a.hasAttribute("aff") ? "  (" + a.getAttribute("aff") + ")" : "");
  if (h) FOOT.title = plain(h);
  if (d) FOOT.date = plain(d);
}
function foot(i) {
  const f = $new("div", "foot"), f3 = $new("div", "f3");
  f3.append($new("span", "fdate", FOOT.date), $new("span", "pageno", (i + 1) + " / " + pages.length));
  f.append($new("div", "f1", FOOT.who), $new("div", "f2", FOOT.title), f3);
  return f;
}

/* ➡ -> red arrow */
function arrows(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hits = [];
  while (w.nextNode()) if (w.currentNode.nodeValue.indexOf("➡") >= 0) hits.push(w.currentNode);
  hits.forEach(function (t) {
    const parts = t.nodeValue.split(/➡[︎️]?/), frag = document.createDocumentFragment();
    parts.forEach(function (s, i) {
      if (i) frag.appendChild($new("span", "arw"));
      if (s) frag.appendChild(document.createTextNode(s));
    });
    t.parentNode.replaceChild(frag, t);
  });
}

/* Title strip of a box: one span (flex would split the text), full-width digits in .zd */
function titleSpan(title) {
  const ttl = $new("span");
  title.split(/([０-９]+)/).forEach(function (s, k) {
    if (s) ttl.appendChild(k % 2 ? $new("span", "zd", s) : document.createTextNode(s));
  });
  return ttl;
}

/* Kamishibai components written as tags */
function components(pg) {
  pg.querySelectorAll("alert").forEach(e => e.classList.add("k"));
  [["proof", "pf", "証明"], ["plan", "pf pl", "証明の方針"], ["later", "ph", ""]].forEach(function (c) {
    pg.querySelectorAll(c[0]).forEach(function (e) {
      c[1].split(" ").forEach(k => e.classList.add(k));
      const title = e.hasAttribute("title") ? e.getAttribute("title") : c[2];
      e.removeAttribute("title");
      if (title) { const pt = $new("div", "pt"); pt.appendChild(titleSpan(title)); e.prepend(pt); }
    });
  });
  pg.querySelectorAll("nums").forEach(function (e) {
    e.classList.add("nums");
    const start = parseInt(e.getAttribute("start"), 10);
    if (start > 1) e.style.counterReset = "n " + (start - 1);
    if (e.hasAttribute("labels")) e.classList.add("lab");
    e.querySelectorAll(":scope > item[label]").forEach(function (it) {
      it.prepend($new("span", "lb", it.getAttribute("label")));
    });
  });
  /* A label (<span class="label">) at the start of a paragraph, item or box: the text after it wraps
     beside the label, not under it, and the spaces between them are dropped */
  pg.querySelectorAll(".label").forEach(function (lb) {
    let n = lb.previousSibling;
    while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.previousSibling;
    if (n || !lb.nextSibling) return;
    const rest = $new("span", "label-rest");
    while (lb.nextSibling) rest.appendChild(lb.nextSibling);
    const t = rest.firstChild;
    if (t && t.nodeType === 3) t.textContent = t.textContent.replace(/^[\s\u3000]+/, "");
    lb.parentNode.classList.add("labeled");
    lb.parentNode.appendChild(rest);
  });
  pg.querySelectorAll("side").forEach(e => e.classList.add("side"));
  pg.querySelectorAll("flip").forEach(function (f) {
    const kids = [].filter.call(f.children, c => /^(svg|img)$/i.test(c.tagName));
    f.classList.add("flip", kids.length > 1 ? "tg" : "one");
    if (f.hasAttribute("anim")) f.setAttribute("data-anim", "");
    if (f.hasAttribute("init")) f.setAttribute("data-init", f.getAttribute("init"));
    const W = parseFloat(f.getAttribute("width")), H = parseFloat(f.getAttribute("height"));
    if (W > 0) f.style.width = W + "px";
    if (H > 0) f.style.height = H + "px";
    kids.forEach(function (c, k) {
      c.classList.add("gv");
      if (k === 0) c.classList.add("cur");
      if (W > 0 && !c.hasAttribute("width")) c.style.width = W + "px";
    });
  });
  pg.querySelectorAll("switch[for]").forEach(function (s) {
    s.classList.add("ctrl", "below");
    s.setAttribute("data-flip", s.getAttribute("for"));
  });
  pg.querySelectorAll("figcaption[for]").forEach(function (c) {
    c.classList.add("cap");
    c.setAttribute("data-flipcap", c.getAttribute("for"));
    if (c.hasAttribute("caps")) c.setAttribute("data-caps", c.getAttribute("caps"));
  });
  ["cards", "ov", "with"].forEach(function (a) {
    pg.querySelectorAll("[" + a + "]").forEach(function (e) { e.setAttribute("data-" + a, e.getAttribute(a)); });
  });
}

pages.forEach(function (pg, i) {
  const sec = $new("section", "page");
  const tag = pg.tagName;

  if (tag === "SLIDE") {
    /* the title is one span (.ttl is flex; .ja spans would scatter it) */
    sec.appendChild($new("div", "ttl")).appendChild($new("span", null, pg.getAttribute("title") || ""));
    pg.removeAttribute("title");   // no tooltip
  }

  if (tag === "DIVIDER") {
    const box = $new("div", "sbox");
    while (pg.firstChild) box.appendChild(pg.firstChild);
    pg.appendChild(box);
  }

  /* Cover: title box (headline, subtitle), authors on one line, institutes, meeting and date.
     Same institutes merge; with 2+ institutes, names and institutes get numbers */
  if (tag === "COVER") {
    const ct = $new("div", "ctitle"), meta = $new("div", "cmeta"), box = $new("div", "authors"), insts = $new("div", "insts");
    pg.querySelectorAll("headline, subtitle").forEach(e => ct.appendChild(e));
    pg.querySelectorAll("meeting, date").forEach(e => meta.appendChild(e));
    const authors = pg.querySelectorAll("author"), affs = [];
    authors.forEach(function (a) { const f = a.getAttribute("aff"); if (f && affs.indexOf(f) < 0) affs.push(f); });
    authors.forEach(function (a) {
      if (affs.length > 1 && a.hasAttribute("aff")) a.appendChild($new("sup", null, String(affs.indexOf(a.getAttribute("aff")) + 1)));
      box.appendChild(a);
    });
    affs.forEach(function (f, k) {
      const s = insts.appendChild($new("span"));
      if (affs.length > 1) s.appendChild($new("sup", null, String(k + 1)));
      s.appendChild(document.createTextNode(f));
    });
    pg.prepend(ct, box, insts, meta);
    pg.querySelectorAll("qr").forEach(function (q) {
      const img = $new("img"), cap = $new("div", "qcap");
      img.src = q.getAttribute("src"); img.alt = "";
      while (q.firstChild) cap.appendChild(q.firstChild);
      q.append(img, cap);
    });
  }

  pg.querySelectorAll("block, alertblock, exampleblock").forEach(function (b) {
    const bt = $new("div", "bt"), bb = $new("div", "bb"), title = b.getAttribute("title") || "";
    /* A box holds one statement (BLOCK_KINDS). While drafting, a box whose title names no kind is marked;
       tools/check_blocks.py checks the rest, and tools/pack_engine.py packs no draft that fails it */
    if (!packed && !BLOCK_HEAD.test(title.trim())) {
      b.classList.add("bad-box");
      console.warn("Kamishibai: page " + (i + 1) + ": a box titled \"" + title + "\" is not a statement (" + BLOCK_KINDS.join(", ") + ")");
    }
    if (title) bt.appendChild(titleSpan(title));
    if (b.hasAttribute("cite")) bt.appendChild($new("cite", null, b.getAttribute("cite")));
    b.removeAttribute("title");
    while (b.firstChild) bb.appendChild(b.firstChild);
    b.append(bt, bb);
  });

  components(pg);
  arrows(pg);
  sec.appendChild(pg);
  sec.appendChild(foot(i));
  if (tag !== "COVER") sec.appendChild($new("div", "pn", String(i + 1)));
  stage.appendChild(sec);
});
body.prepend(deck);

/* ===== Miniframes header (.hl): <slide sec="…"> starts a section; one dot per slide ===== */
(function () {
  const secs = [];
  let cur = null;
  pages.forEach(function (pg) {
    if (pg.tagName !== "SLIDE") return;
    /* a new section starts where sec="…" names a different section than the one before */
    if (pg.hasAttribute("sec") && (!cur || cur.name !== pg.getAttribute("sec"))) { cur = { name: pg.getAttribute("sec"), sl: [] }; secs.push(cur); }
    if (cur) cur.sl.push(pg);
  });
  secs.forEach(function (sc) {
    sc.sl.forEach(function (pg) {
      const hl = $new("div", "hl");
      secs.forEach(function (t) {
        const hs = $new("div", "hs" + (t === sc ? " cur" : "")), hf = $new("div", "hf");
        t.sl.forEach(x => hf.appendChild($new("i", x === pg ? "cur" : null)));
        hs.append($new("div", "hn", t.name), hf);
        hl.appendChild(hs);
      });
      pg.parentNode.appendChild(hl);
    });
  });
})();

/* ===== size="32" (pt) ===== */
stage.querySelectorAll("[size]").forEach(function (e) {
  const pt = parseFloat(e.getAttribute("size"));
  if (pt > 0) e.style.fontSize = (pt * 4 / 3) + "px";
});

/* ===== line="1.2", before="12", after="12" (pt) ===== */
stage.querySelectorAll("[line]").forEach(function (e) {
  const v = parseFloat(e.getAttribute("line"));
  if (!(v > 0)) return;
  e.style.lineHeight = v;
  const bb = e.querySelector(":scope > .bb");
  if (bb) bb.style.lineHeight = v;
});
[["before", "marginTop"], ["after", "marginBottom"]].forEach(function (a) {
  stage.querySelectorAll("[" + a[0] + "]").forEach(function (e) {
    const pt = parseFloat(e.getAttribute(a[0]));
    if (pt >= 0) e.style[a[1]] = (pt * 4 / 3) + "px";
  });
});

/* ===== Math (KaTeX): $…$, \(…\), $$…$$, \[…\]. No MathML (copying would repeat the text).
   Elements already holding rendered math (.katex, e.g. pre-rendered by a build) are skipped ===== */
if (window.renderMathInElement && window.katex) {
  const pre = [];
  stage.querySelectorAll(".katex").forEach(function (k) {
    const p = k.parentElement;
    if (p && !p.classList.contains("ks-pre")) { p.classList.add("ks-pre"); pre.push(p); }
  });
  renderMathInElement(stage, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
                 { left: "\\(", right: "\\)", display: false }, { left: "$", right: "$", display: false }],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option", "svg"],
    ignoredClasses: ["ks-pre", "katex"],
    throwOnError: false, output: "html"
  });
  pre.forEach(p => p.classList.remove("ks-pre"));
}

/* ===== Japanese brackets and punctuation at full width (theme switch --jp-pad: ipa).
   IPA P-Gothic draws them about half width, so each gets a span with the missing width as padding.
   Applied only when the theme's font (--jp-pad-family, without a unicode-range) is declared, so a
   fallback system font (already full width) is not padded twice ===== */
(function () {
  if (cssVar("--jp-pad") !== "ipa") return;
  const fam = cssVar("--jp-pad-family").replace(/["']/g, "");
  if (fam && !Array.from(document.fonts).some(f => f.family.replace(/["']/g, "") === fam && /^U\+0+-10FFFF$/i.test(f.unicodeRange))) return;
  const OPEN = { "（": .5498, "「": .5698, "『": .6099, "【": .5498, "［": .6001, "〔": .5498, "｛": .52, "〈": .6499, "《": .6602 };
  const CLOSE = { "）": .5498, "」": .5698, "』": .6099, "】": .5498, "］": .6001, "〕": .5498, "｝": .52, "〉": .6499, "》": .6602,
                  "、": .5, "。": .5, "，": .5, "．": .5 };
  const MID = { "・": .5, "：": .5, "；": .5, "！": .48, "？": .7202 };
  const PUNCT = /[（「『【［〔｛〈《）」』】］〕｝〉》、。，．・：；！？]/;
  const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT), hits = [];
  while (w.nextNode()) {
    const t = w.currentNode, p = t.parentElement;
    if (p && PUNCT.test(t.nodeValue) && !p.closest(".katex, svg")) hits.push(t);
  }
  hits.forEach(function (t) {
    const s = t.nodeValue, frag = document.createDocumentFragment();
    let plain = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (!PUNCT.test(c)) { plain += c; continue; }
      if (plain) { frag.appendChild(document.createTextNode(plain)); plain = ""; }
      const prev = s[i - 1] || "", next = s[i + 1] || "", sp = $new("span", "jp", c);
      if (c in OPEN) { if (!(prev in OPEN)) sp.style.paddingLeft = (1 - OPEN[c]).toFixed(4) + "em"; }
      else if (c in CLOSE) { if (!PUNCT.test(next)) sp.style.paddingRight = (1 - CLOSE[c]).toFixed(4) + "em"; }
      else { sp.style.padding = "0 " + ((1 - MID[c]) / 2).toFixed(4) + "em"; }
      frag.appendChild(sp);
    }
    if (plain) frag.appendChild(document.createTextNode(plain));
    t.parentNode.replaceChild(frag, t);
  });
})();

/* ===== Japanese runs in <span class="ja"> so a stroke can be added (--ja-stroke, normally 0).
   Not in bold text, math or figures ===== */
(function () {
  const JA = "[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-￯]";
  const has = new RegExp(JA), split = new RegExp("(" + JA + "+)");
  const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT), hits = [];
  while (w.nextNode()) {
    const t = w.currentNode, p = t.parentElement;
    if (!p || !has.test(t.nodeValue) || p.closest(".katex, svg")) continue;
    if (parseInt(getComputedStyle(p).fontWeight, 10) >= 600) continue;
    hits.push(t);
  }
  hits.forEach(function (t) {
    const frag = document.createDocumentFragment();
    t.nodeValue.split(split).forEach(function (s, i) {
      if (!s) return;
      frag.appendChild(i % 2 ? $new("span", "ja", s) : document.createTextNode(s));
    });
    t.parentNode.replaceChild(frag, t);
  });
})();

/* Load every font now (math on pages not shown yet must be ready for the overview and printing) */
document.fonts.forEach(function (f) { f.load().catch(function () {}); });

/* Show the stage once the fonts are in, but never wait more than 3 s (a missing or slow font CSS
   must not keep the deck hidden) */
stage.style.visibility = "hidden";
Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]).then(function () { stage.style.visibility = ""; });

/* ===== Figures ===== */
const FIG = window.FIG || {};
for (const id in FIG) {
  const svg = document.getElementById(id);
  if (svg) FIG[id](svg);
}

const secs = [].slice.call(stage.children);

/* ===== Flip figures (.flip.tg, buttons [data-flip]) and build-up figures (.flip[data-anim]) =====
   A build-up figure shows its class "cd" groups one by one, up to the count of the last shown step
   with data-cards ("n", "*" = all, "a|b" per figure of a flip); a shown step with data-ov also shows
   the "ov" groups; data-init is the count shown from the start. Going back switches at once. */
const timers = new Map();
function figsOf(f) { return [].slice.call(f.querySelectorAll(":scope > svg.gv, :scope > img.gv")); }
function pick(v, k, n) {
  if (v === undefined || v === null) return null;
  const p = v.split("|"), x = p[Math.min(k, p.length - 1)];
  return x === "*" ? n : parseInt(x, 10);
}
/* state of figure k of flip f for the shown steps of its page (drop: without the last data-cards step) */
function state(f, k, drop) {
  const sv = figsOf(f)[k], n = sv ? sv.querySelectorAll(".cd").length : 0;
  const page = f.closest(".page");
  let on = page ? [].slice.call(page.querySelectorAll(STEP + ".on")) : [];
  if (drop) { let q = -1; on.forEach((e, i) => { if (e.dataset.cards !== undefined) q = i; }); if (q >= 0) on = on.slice(0, q); }
  let t = pick(f.dataset.init, k, n) || 0, ov = false;
  on.forEach(function (e) { const c = pick(e.dataset.cards, k, n); if (c !== null) t = c; if (e.dataset.ov !== undefined) ov = true; });
  return { t: Math.min(t, n), ov: ov };
}
function show(sv, t, ov, anim) {
  if (!sv) return;
  clearTimeout(timers.get(sv));
  const cd = [].slice.call(sv.querySelectorAll(".cd")), o = [].slice.call(sv.querySelectorAll(".ov"));
  let i = cd.filter(e => e.classList.contains("in")).length;
  if (!anim || i >= t) { cd.forEach((e, j) => e.classList.toggle("in", j < t)); o.forEach(e => e.classList.toggle("in", ov)); return; }
  if (!ov) o.forEach(e => e.classList.remove("in"));
  const dt = Math.min(180, 2500 / (t - i));
  (function step() {
    if (i < t) { cd[i++].classList.add("in"); timers.set(sv, setTimeout(step, dt)); }
    else o.forEach(e => e.classList.toggle("in", ov));
  })();
}
/* bring the build-up figures of root (a page or a copy) to the current steps; only the shown figure animates */
function syncAnims(rootEl, anim) {
  rootEl.querySelectorAll(".flip[data-anim]").forEach(function (f) {
    const g = figsOf(f);
    let k = g.findIndex(e => e.classList.contains("cur"));
    if (k < 0) k = 0;
    g.forEach(function (sv, j) { const st = state(f, j, false); show(sv, st.t, st.ov, anim && j === k); });
  });
}
function setFlip(id, k, anim) {
  const f = document.getElementById(id);
  if (!f) return;
  const g = figsOf(f);
  g.forEach((im, i) => im.classList.toggle("cur", i === k));
  if (f.dataset.anim !== undefined && g[k]) {
    const a = state(f, k, true), b = state(f, k, false);
    show(g[k], a.t, a.ov, false); show(g[k], b.t, b.ov, anim);
  }
  const btns = stage.querySelectorAll('[data-flip="' + id + '"] button');
  btns.forEach((b, i) => b.classList.toggle("sub2", i !== k));
  const c = stage.querySelector('[data-flipcap="' + id + '"]');
  if (c && c.dataset.caps !== undefined && btns[k]) c.textContent = btns[k].textContent + "：" + c.dataset.caps.split("|")[k];
}
const flips = [].slice.call(stage.querySelectorAll(".flip.tg"));
function resetFlips() { flips.forEach(f => { if (f.id) setFlip(f.id, 0); }); }
stage.querySelectorAll("[data-flip]").forEach(function (ct) {
  ct.querySelectorAll("button").forEach(function (b, i) {
    b.addEventListener("click", function (e) { e.stopPropagation(); setFlip(ct.dataset.flip, i, true); b.blur(); });
  });
});
resetFlips();
syncAnims(stage, false);

/* ===== Step groups: a step with with="prev" belongs to the group of the step before it ===== */
function groups(page) {
  const g = [];
  page.querySelectorAll(STEP).forEach(function (e) {
    if (g.length && e.dataset.with === "prev") g[g.length - 1].push(e); else g.push([e]);
  });
  return g;
}

/* Copy of a page (overview and printing): ids removed, the first `shown` steps on */
function copyPage(sec, shown) {
  const c = sec.cloneNode(true);
  c.classList.add("on");
  c.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
  c.querySelectorAll(STEP).forEach((e, j) => e.classList.toggle("on", j < shown));
  syncAnims(c, false);
  return c;
}

/* ===== Overview (⌘B): thumbnails on the left ===== */
const side = $new("div", "side");
secs.forEach(function (sec, i) {
  const th = $new("div", "thumb"), box = $new("div", "tbox");
  box.appendChild(copyPage(sec, Infinity));
  th.append(box, $new("span", "tno", String(i + 1)));
  th.addEventListener("click", function () { go(i, true); });
  side.appendChild(th);
});
body.appendChild(side);

/* ===== Printing: one sheet per page; a page with n step groups gives n + 1 sheets (the last is .all) ===== */
const prn = $new("div", "print");
secs.forEach(function (sec) {
  const g = groups(sec);
  let shown = 0;
  for (let k = 0; k <= g.length; k++) {
    if (k) shown += g[k - 1].length;
    const pp = $new("div", k === g.length ? "ppage all" : "ppage");
    pp.appendChild(copyPage(sec, shown));
    prn.appendChild(pp);
  }
});
body.appendChild(prn);

/* figures registered with figure() are redrawn in the copies for their shown steps */
body.querySelectorAll("body > .side svg[data-fig], .print svg[data-fig]").forEach(function (svg) {
  const draw = Kamishibai.STILL && Kamishibai.STILL[svg.getAttribute("data-fig")];
  if (!draw) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  draw(svg, true);
});

/* ===== Stage size from the theme (--W, --H): screen fit, thumbnails, paper size ===== */
const SW = parseFloat(cssVar("--W")) || 1280, SH = parseFloat(cssVar("--H")) || 720;
Kamishibai.size = [SW, SH];
root.style.setProperty("--ratio", String(SH / SW));
root.style.setProperty("--tscale", String(192 / SW));
document.head.appendChild($new("style", null, "@page { size: " + (SW * .75) + "pt " + (SH * .75) + "pt; margin: 0 }"));
function fit() {
  const L = body.classList.contains("side-on") ? side.offsetWidth : 0, W = innerWidth - L, H = innerHeight;
  const s = Math.min(W / SW, H / SH);
  stage.style.transform = "translate(" + (L + (W - SW * s) / 2) + "px," + (H - SH * s) / 2 + "px) scale(" + s + ")";
}
addEventListener("resize", fit);

/* ===== Fullscreen (⌘F), overview (⌘B), pointer (⌘K), select (⌘E), keys off (⌘U), print (⌘P), PDF ===== */
function fullscreen() {
  const d = document, el = d.documentElement;
  const exit = d.exitFullscreen || d.webkitExitFullscreen, enter = el.requestFullscreen || el.webkitRequestFullscreen;
  if (d.fullscreenElement || d.webkitFullscreenElement) { if (exit) exit.call(d); }
  else if (enter) enter.call(el);
}
const tools = $new("div", "tools"), btn = {};
function toggle(name) {
  if (name === "full") { fullscreen(); return; }
  if (name === "print") { print(); return; }
  const cls = { side: "side-on", ptr: "ptr-on", edit: "edit", op: "op" }[name];
  const on = body.classList.toggle(cls);
  btn[name].classList.toggle("on", on);
  if (name === "side") { fit(); if (on) showCurrent(); }
  /* select and keys off exclude each other; the badge shows the key that turns it off */
  if (on && (name === "edit" || name === "op")) {
    const other = name === "edit" ? "op" : "edit";
    body.classList.remove(other);
    btn[other].classList.remove("on");
    badge.textContent = mod + (name === "edit" ? "E" : "U");
  }
}
const handle = $new("button", null, "▷");
handle.addEventListener("click", function () {
  handle.textContent = body.classList.toggle("tools-open") ? "◁" : "▷";
  handle.blur();
});
tools.appendChild(handle);
const mac = /Mac|iPhone|iPad/.test(navigator.platform), mod = mac ? "⌘" : "Ctrl+";
[["side", "Pages", "B"], ["full", "Fullscreen", "F"], ["ptr", "Pointer", "K"], ["edit", "Select", "E"], ["op", "Keys off", "U"], ["print", "Print", "P"]].forEach(function (b) {
  const el = $new("button", "op", b[1] + " " + mod + b[2]);
  el.addEventListener("click", function () { toggle(b[0]); el.blur(); });
  btn[b[0]] = el;
  tools.appendChild(el);
});

/* Print (⌘P): all steps shown, one sheet per page. PDF: one sheet per step group.
   The PDF layout stays until the next key or pointer press (Safari re-lays out in its print dialog) */
function printSteps(on) { body.classList.toggle("print-steps", on); }
addEventListener("keydown", function () { printSteps(false); }, true);
addEventListener("pointerdown", function () { printSteps(false); }, true);
const pdf = $new("button", "op", "PDF");
pdf.addEventListener("click", function () { printSteps(true); pdf.blur(); print(); });
tools.appendChild(pdf);

/* Stroke added to Japanese text (--ja-stroke), changed by 0.1pt; remembered by the browser */
const KEY = "kamishibai-ja-stroke";
const base = (function () {
  const v = cssVar("--ja-stroke"), n = parseFloat(v);
  return isNaN(n) ? 0.2 : (/px$/.test(v) ? n * 0.75 : n);
})();
const val = $new("button", "op val");
function setStroke(pt, keep) {
  pt = Math.max(0, Math.round(pt * 10) / 10);
  root.style.setProperty("--ja-stroke", pt + "pt");
  val.textContent = pt.toFixed(1) + "pt";
  try { if (keep) localStorage.setItem(KEY, pt); else localStorage.removeItem(KEY); } catch (e) {}
  return pt;
}
let stroke = base;
try { const s = parseFloat(localStorage.getItem(KEY)); if (!isNaN(s)) stroke = s; } catch (e) {}
stroke = setStroke(stroke, stroke !== base);
[["−", -0.1], [null, 0], ["+", 0.1]].forEach(function (b) {
  const el = b[0] ? $new("button", "op", b[0]) : val;
  el.addEventListener("click", function () {
    stroke = b[1] ? setStroke(stroke + b[1], true) : setStroke(base, false);
    el.blur();
  });
  tools.appendChild(el);
});
body.appendChild(tools);
const badge = $new("div", "badge", mod + "E"), ptr = $new("div", "pointer"), toastEl = $new("div", "toast");
body.append(badge, ptr, toastEl);
function toast(t) {
  toastEl.textContent = t;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1200);
}

let hideTimer = 0;
addEventListener("mousemove", function (e) {
  ptr.style.left = e.clientX + "px";
  ptr.style.top = e.clientY + "px";
  tools.classList.add("show");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(function () { if (!tools.matches(":hover")) tools.classList.remove("show"); }, 2500);
});
fit();

/* ===== Page turning and steps =====
   Step mode (default on): steps appear one group at a time. Key S switches to "show all" (pages only),
   remembered under localStorage "kamishibai-steps" ("1" on, "0" off) */
const SKEY = "kamishibai-steps";
let stepMode = true;
try { const v = localStorage.getItem(SKEY); if (v !== null) stepMode = v !== "0"; } catch (e) {}
Kamishibai.stepMode = function () { return stepMode; };
let si = 0;
function showCurrent() {
  [].forEach.call(side.children, (t, i) => t.classList.toggle("cur", i === si));
  if (body.classList.contains("side-on")) side.children[si].scrollIntoView({ block: "nearest" });
}
/* all: every step shown (going back to a page, jumping from the overview, or show-all mode) */
function paint(all) {
  secs.forEach((s, i) => s.classList.toggle("on", i === si));
  secs.forEach(s => s.querySelectorAll(STEP).forEach(e => e.classList.remove("on")));
  resetFlips();
  syncAnims(stage, false);
  if (all || !stepMode) {
    secs[si].querySelectorAll(STEP).forEach(e => e.classList.add("on"));
    syncAnims(secs[si], !stepMode && !all);
  }
  showCurrent();
  try { history.replaceState(null, "", "#s" + (si + 1)); } catch (e) {}
}
function go(k, all) { if (k < 0 || k >= secs.length) return; si = k; paint(all); }
function next() {
  if (stepMode) {
    const g = groups(secs[si]).find(x => x.some(e => !e.classList.contains("on")));
    if (g) { g.forEach(e => e.classList.add("on")); syncAnims(secs[si], true); return; }
  }
  go(si + 1);
}
function prev() {
  /* no transitions while going back; the mark is removed two frames later */
  root.classList.add("step-back");
  requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove("step-back"); }); });
  if (stepMode) {
    const g = groups(secs[si]).filter(x => x.some(e => e.classList.contains("on"))).pop();
    if (g) { g.forEach(e => e.classList.remove("on")); syncAnims(secs[si], false); return; }
  }
  go(si - 1, true);
}
function toggleSteps() {
  stepMode = !stepMode;
  try { localStorage.setItem(SKEY, stepMode ? "1" : "0"); } catch (e) {}
  paint(false);
  toast("段階表示：" + (stepMode ? "オン" : "オフ"));
}

/* ===== Click: left quarter = back, elsewhere = forward.
   Not in select / keys-off mode, not on controls (buttons, inputs, bars, switches, the overview).
   Ignored: drags (> 4px), double and triple clicks, clicks while text is selected or that clear a
   selection. A single click waits 260 ms so that it can be told from a double click ===== */
function selecting() { const s = getSelection(); return !!s && !s.isCollapsed && s.toString().trim() !== ""; }
let pend = 0, down = null, hadSel = false;
addEventListener("mousedown", function (e) { down = [e.clientX, e.clientY]; hadSel = selecting(); });
addEventListener("click", function (e) {
  if (body.classList.contains("edit") || body.classList.contains("op") ||
      e.target.closest("button, input, select, textarea, .bar, .sw, .ctrl, switch, body > .side, .tools")) return;
  clearTimeout(pend); pend = 0;
  const moved = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4;
  if (e.detail > 1 || moved || hadSel || selecting()) return;
  const back = e.clientX < innerWidth * 0.25;
  pend = setTimeout(function () { pend = 0; if (selecting()) return; if (back) prev(); else next(); }, 260);
});
/* Keys: ⌘ (Ctrl on Windows) + B F K E U toggle; other ⌘ keys go to the browser (⌘P prints).
   Select mode turns pages with ← → only; keys-off mode never turns pages */
document.addEventListener("keydown", function (e) {
  const k = e.key, edit = body.classList.contains("edit");
  const keys = { KeyB: "side", KeyF: "full", KeyK: "ptr", KeyE: "edit", KeyU: "op" };
  if ((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && keys[e.code]) { e.preventDefault(); toggle(keys[e.code]); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || body.classList.contains("op")) return;
  const t = e.target;
  if (t && t.closest && (t.closest("input, textarea, select") || t.isContentEditable)) return;
  if (body.classList.contains("side-on") && (k === "ArrowDown" || k === "ArrowUp")) {
    e.preventDefault();
    go(si + (k === "ArrowDown" ? 1 : -1), true);
    return;
  }
  if (k === "ArrowRight" || (!edit && (k === " " || k === "Enter" || k === "PageDown"))) { e.preventDefault(); next(); }
  else if (k === "ArrowLeft" || (!edit && k === "PageUp")) { e.preventDefault(); prev(); }
  else if (!edit && k === "Home") { e.preventDefault(); go(0); }
  else if (!edit && k === "End") { e.preventDefault(); go(secs.length - 1); }
  else if (!edit && !e.shiftKey && (k === "s" || k === "S")) { e.preventDefault(); toggleSteps(); }
});
/* sliders and buttons in a slide give the focus back once used, so keys turn pages again */
["change", "pointerup"].forEach(function (t) {
  stage.addEventListener(t, function (e) { if (e.target.matches("input, button")) e.target.blur(); });
});

/* ◀ ▶ for touch screens (same as ← →) */
[["tap-prev", "前へ", "ArrowLeft"], ["tap-next", "次へ", "ArrowRight"]].forEach(function (b) {
  const el = $new("button", "tap-nav " + b[0]);
  el.setAttribute("aria-label", b[1]);
  el.addEventListener("click", function () {
    el.blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: b[2], bubbles: true }));
  });
  body.appendChild(el);
});

/* Copy: math becomes the visible characters in one string (e.g. x∈ℝ+), the rest as innerText */
const BB = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ" };
document.addEventListener("copy", function (e) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const frag = sel.getRangeAt(0).cloneContents();
  if (!frag.querySelector(".katex")) return;
  frag.querySelectorAll(".katex").forEach(function (k) {
    const html = k.querySelector(".katex-html") || k;
    html.querySelectorAll(".mathbb").forEach(function (b) { b.textContent = b.textContent.replace(/[RNZQC]/g, function (ch) { return BB[ch]; }); });
    k.replaceWith(document.createTextNode(html.textContent.replace(/\s+/g, "")));
  });
  const box = $new("div");
  box.style.cssText = "position: fixed; left: -99999px; top: 0";
  box.appendChild(frag);
  body.appendChild(box);
  const text = box.innerText;
  box.remove();
  e.clipboardData.setData("text/plain", text);
  e.preventDefault();
});

/* #sN: read on opening and when the address is edited */
function hashPage() {
  const h = parseInt((location.hash || "").replace("#s", ""), 10);
  return (h >= 1 && h <= secs.length) ? h - 1 : 0;
}
addEventListener("hashchange", function () { go(hashPage()); });
Kamishibai.go = go; Kamishibai.next = next; Kamishibai.prev = prev; Kamishibai.current = function () { return si; };
si = hashPage();
paint();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
else build();
})();
