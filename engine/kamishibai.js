/* ===== Kamishibai のエンジン（kamishibai.js）=====
  Kamishibai, developed jointly by TonanKamata and ShiotaTakumi. CC0 1.0 Universal (engine/LICENSE).
  タグで書いた HTML の原稿を、ブラウザで直接開いたときにスライドに組む。説明は engine/README.md。

  ■ 使い方：原稿の HTML（見本は engine/sample.html）の最初に
      <html lang="ja" theme="Boadilla">            テーマ（themes/ の中のファイルの名前。書かなければ Boadilla）
      <script src="engine/kamishibai.js"></script> 原稿からこのファイルへの相対パス
    と書き、その後ろにページをタグで並べる。URL に ?theme=Madrid を付けると、そのテーマで開く。
    Boadilla の書体は engine/fonts/kamishibai-fonts.css（make engine-fonts で作る）。無ければ手元の書体で出る。

  ページ
    <cover>…</cover>                    表紙。<headline>題名</headline> <subtitle>副題</subtitle>
                                        <author aff="所属" presenter>名前</author>（何人でも） <meeting>会の名前</meeting> <date>日付</date>
                                        Madrid の下の帯には、presenter を付けた著者（無ければ最初の著者）・題名・日付が出る。
                                        author・headline・date に short="…" を付けると、下の帯にはその短い文が出る
    <slide title="見出し" sec="節の名前">…</slide>   ふつうのページ。sec のあるページから、別の名前の sec の前までが一つの節
                                        （同じ名前を続けて書いてもよい。Boadilla では上端の帯に、節の名前とページごとの丸が出る）
    <divider>参考資料</divider>          区切りのページ

  ページの中
    <p>…</p>  <list><item>…</item></list>（item の中に list で 2 段目）
    <block title="…" cite="[…]">…</block>   block（Beamer の block）。<alertblock>・<exampleblock> も同じ。
                                        定義・定理などの主張を一つだけ入れ、題は主張の種類（BLOCK_KINDS）で始める
    <note>…</note>                      緑の枠の囲み（短い注意）
    <down>…</down>                      赤い下向きの矢印と、その下の文（話の帰結）
    <columns><column>…</column><column>…</column></columns>   段組み
    <figure><img src="図.png"></figure>   <table class="tbl">…</table>
                                        図にキャプション（figcaption、p.cap、「図：…」の文）を付けない。図はページの文の下に置く
    <qr src="qr.png">説明</qr>           表紙の QR コードの画像と、その下の短い説明
    文の中：<red> <navy> <b> <cite> <frac><num>…</num><den>…</den></frac> <ruby> <nobr>（改行しない） ➡（赤い矢印）

  ページの中（証明と図の部品）
    <alert>…</alert>                    強調（Beamer の \alert）
    <proof title="証明">…</proof>        証明（左の線）。title を省くと「証明」
    <plan title="証明の方針">…</plan>    証明の方針（淡い地）
    <later title="補題 2（後で証明）">…</later>   後で証明する主張（破線の枠）
    <nums start="3"><item>…</item></nums>   番号つきの手順（丸数字。start で始めの番号）。<nums labels> と <item label="(i)"> で文字のラベル
    <side><div>…</div><figure>…</figure></side>   文を左、図を右に並べる（アルゴリズムなど段階を追う説明だけの例外）
    <flip id="fyn"><svg>…</svg><svg>…</svg></flip>  重ねた図を 1 枚ずつ見せる（大きさはいちばん大きな図。width・height でも決められる）
    <switch for="fyn"><button>できる</button><button>できない</button></switch>   図を切り替えるボタン
    <flip id="…" anim init="1"><svg>…<g class="cd">…</g>…<g class="ov">…</g></svg></flip>
                                        段階的に組み上がる図：class="cd" の群（カード）を 1 つずつ、class="ov" の群をまとめて出す。
                                        init は最初から出ているカードの数。段階の要素に cards="n" を付けると、その段階で n 枚目まで出る
                                        （"*" は全部。一つの flip に SVG が複数あれば "a|b" で 1 枚目の SVG に a、2 枚目に b。
                                        数でない値は数えず、make pack が警告する）。ov を付けた段階で class="ov" の群が出る
    <figcaption for="fyn" caps="…|…" caps-en="…|…">…</figcaption>   押したボタンの名前と caps の対応する文を出す（英語では caps-en）。
                                        開けば表示するが、make pack は拒む。ボタンの名前で足りる

  class で使う部品
    qa・qa-label（「入力：」「問い：」のように見出しをそろえた段落）、navy-normal（紺の文字）、label（行の中の小さな枠）、
    pink（桃色の枠の囲み）、frame（絶対配置で図などを囲む赤い枠）、mark（何も出さない段階の印）、
    bar（数を変えるスライダーの行：<div class="bar"><i>n</i><input type="range">…</div>）、play（再生のボタン）、
    sw（横に並べた切り替えのボタン）。bar・play・sw は見た目だけで、動きは図のコードで付ける。two（2 段組）、tb（罫線の少ない表）、nb（改行しない）。
    class だけで書く書き方の class：fig・cap・blk（block）・pts（箇条書き）・nums・pf（証明）・ph（後で証明する主張）。blk と pts は Boadilla だけで効く

  数式：$…$・\(…\)（文の中）、$$…$$・\[…\]（別の行に取って中央）。もう組んである数式（.katex）を含む要素は組み直さない

  主張の番号と参照（<html> に numbering を書いた原稿だけ。無ければ番号は手で書いたまま）
    <html numbering="deck">             通し番号（定理 3）。numbering="section" は節の番号つき（定理 3.1）。"deck each" のように each を足すと種類ごとに数える。
                                        unnumbered="問題 主定理" の種類には付けない
    <block title="定理（上界）" name="upper">   題が主張の種類で始まる block・alertblock・exampleblock・later の、種類の後に番号が入る（定理 3（上界））。
                                        name は参照のための名前。number="none" は番号なし、number="8" は 8 から数え直し、number="A.1" のような数でない番号はそのまま。
                                        same="upper" は、その名前の主張と同じ番号（再掲・続き）。題に手で書いた番号はそのまま残し、数えない
    <slide sec="…" secno="A">           節の番号（numbering="section"）。書かなければ sec の順に 1, 2, …。secno="none" は節の番号なし
    \ref{upper} は「定理 3」（英語では「Theorem 3」）、\num{upper} は番号「3」だけ。文の中と、題などの属性の中に書ける（<code> の中はそのまま）。
                                        前の主張も後の主張も指せる。図のコードからは Kamishibai.ref("upper")
    同じ名前・同じ番号が二つある、名前の主張が無いなどは、ページに「??」を出し（番号の誤りは出さない）、console と make pack・make numbers が知らせる

  段階表示：どのタグにも step を付けると、クリック（→）で 1 つずつ出る。with="prev" を付けると直前の step と一緒に出る
        （← で戻るときも一緒に消える）。class="reveal" も step と同じ。既定でオン。
        キー S で「全部出す」と切り替える（ページだけを送る。組み上がる図は、ページを開いたときに最後まで動く）。
        選んだほうはブラウザが覚える。
  大きさ・行間・空き：size="32"（文字の大きさ、pt）・line="1.4"（行の高さ、文字の大きさの倍数）・before="12"・after="12"（上下の空き、pt）
  テーマ：画面の大きさ（--W・--H）、書体、括弧・句読点の空き（--jp-pad）はテーマの CSS が決める。
        Boadilla（16:9、1280 × 720、既定）・Madrid（4:3、960 × 720。書体は fonts/cm-sans.css・fonts/ipa-pgothic.css）

  ■ 発表
    → / Space / Enter / PageDown / クリックで進む。← / PageUp / 画面の左 1/4 のクリックで戻る。Home / End。S 段階表示の切り替え。
    クリックは、少し待ってから送る（ダブルクリック・トリプルクリック・ドラッグ・文字の選択とその解除では送らない）。
    ボタン・入力欄・リンク・動画・音声・iframe・details・summary のクリックでも送らない。
    タッチの画面では ◀ ▶ のボタンが出て、タップ（すぐに送る）と左右のスワイプでも送る。左の隙間を空けず、道具は縦に持つと ◀ ▶ の上、
    横に持つと左下に置き、ポインター・選択・キー無効（と、使えないときの全画面）は出さない。
    道具はページの左の隙間に縦一列のアイコンで並ぶ（名前はアイコンに指を置くと出る）。下のつまみで上へ開く。上の板に今のモードの道具、
    下の板にくぼんだ溝に入った三つのモード（編集・プレゼン・出力）とつまみ。畳むと編集・出力のときだけそのモードのアイコンが残り、プレゼンの道具が
    オンのときはつまみに橙の点が付く。ページは左にこの欄の幅（52px）の隙間を必ず空けて置く。既定はプレゼン。モードのキーをもう一度押すとプレゼンに戻る（Windows では Ctrl）。
    編集 ⌘E：文をクリックして直し原稿へ書き戻す（Chrome 拡張 page-edit が要る。無いときは灰色）。編集する言語・ページ一覧 ⌘B・日本語の太さ。
    プレゼン：全画面 ⌘F、ポインター ⌘K、段階表示 S、ページ一覧 ⌘B、日本語の太さ、
      選択 ⌘I（文字を選べ、クリックでは送らず ← → だけで送る）、キー無効 ⌘U（キーでもクリックでも送らない）。選択とキー無効はどちらか一方。
    出力 ⌘P：印刷の版面を画面に並べる。PDF（段階ごとに 1 枚／全段階を 1 枚に）は印刷の画面から、
      HTML（1 ファイル）は page-edit があるとき原稿の隣に 原稿.dist.html を書く（無いときは make pack）。
    #s5 を付けると 5 枚目から開く。
    ブラウザが覚える設定（段階表示 "kamishibai-steps"・言語 "kamishibai-lang"・日本語の太さ "kamishibai-ja-stroke"）は
    localStorage に入る。同じオリジン（file:// では多くのブラウザで全てのファイル）の原稿で共通になる。

  ■ 日本語と英語
    一つの原稿に日本語と英語を並べて書き、どちらか一方を出す。英語は外で作り（手か翻訳）、エンジンは切り替えと組みだけを行う。
    書き方：文の中は <ja>…</ja><en>…</en>。要素ごとなら lang="ja" の要素のすぐ後に lang="en" の要素（SVG の <g>・<tspan> でもよい）。
      属性 title・cite・label・sec・aff・short は X-en="…" に英語を書く。英語の無い日本語は両方の言語で出る。
    切り替え：プレゼンの道具「日本語 ⇄ English」かキー L。URL に ?lang=en。選んだほうはブラウザが覚える。既定は <html lang>。
    収まらないページは、その言語だけ文字を少しずつ縮めて収める（85% まで）。それでもはみ出すページは make check-pack が報告する。
    訳の記録：tools/lang_pairs.py stamp（make lang-stamp）が、英語ごとに元の日本語のハッシュを <en ja="…">（属性は X-en-ja）に書く。
      日本語を直すと、編集モードでその英語に「古い訳」の印が付き、英語の無い日本語にも印が付く。
      一覧は make lang（tools/lang_pairs.py check）。英語を直したら make lang-stamp で記録を足し、作り直した英語は stamp --force。

  ■ 図のコード（figure.js）
    JavaScript で SVG を描く図。<svg id="…"> に対して FIG["id"] = function (svg) { … } と書くと、ページを開いたときに描く。
    figure("id", function (svg, still) { … }) は、ページ一覧と印刷の写しでも、その段階に合わせて動きなしで描き直す（still が true）。
    道具：mk・txt・follow・watchStep・fromPrev・RUNNING・ease・camera・shade・lid など（使い方は figure.js）

  ■ 配布用ファイル（tools/pack_engine.py、make pack SRC=原稿）
    原稿を 1 つの HTML（原稿.dist.html）にまとめる。このファイルは <script data-packed="テーマ名"> として中に入り、
    CSS・書体・図の道具は同じファイルに入っているので読み込まない。テーマはその名前に決まり、?theme= は効かない。
    数式はまとめるときに組んである。直すのは原稿のほう

  ■ このフォルダ（engine/）
    kamishibai.js（このファイル）・figure.js・base.css・themes/・katex/（KaTeX 0.19.0、MIT License。CC0 の外）・
    fonts/（Madrid の書体は同梱。Boadilla の kamishibai-fonts.css は make engine-fonts で作り、git で追跡しない）
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
/* The same kinds in English (numbering and references; tools/numbering.py reads this list) */
const KIND_EN = { "定義": "Definition", "定理": "Theorem", "主定理": "Main Theorem", "補題": "Lemma", "系": "Corollary", "命題": "Proposition",
  "主張": "Claim", "予想": "Conjecture", "未解決問題": "Open Problem", "問題": "Problem", "主結果": "Main Result", "仮定": "Assumption", "公理": "Axiom" };
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

/* ===== Japanese and English (日英) =====
   A deck may hold both languages; one is shown at a time (button in the panel, key L, ?lang=ja|en,
   remembered under localStorage "kamishibai-lang"; the default is the html's lang). The English is
   written outside (by hand or a translator) next to the Japanese:
     <p><ja>…</ja><en>…</en></p>              inline pair (both tags are display: contents)
     <div lang="ja">…</div><div lang="en">…</div>   any element (also SVG <tspan>, <g>): the lang="en"
                                              element right after a lang="ja" one is its English
     title="…" title-en="…"                   attributes: title, cite, label, sec, aff, short
   <en ja="hash"> (or title-en-ja="hash") records the Japanese the English was made from
   (tools/lang_pairs.py stamp); when the Japanese changes, the English is marked as stale in edit mode.
   Japanese with no English is shown in both languages (marked in edit mode) */
const norm = s => s.replace(/\s+/g, " ").trim();
/* FNV-1a (32 bit) of the UTF-8 of the normalized text; the same in tools/lang_pairs.py */
function hash(s) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(norm(s))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return ("0000000" + h.toString(16)).slice(-8);
}
const LANG0 = /^en\b/i.test(root.getAttribute("lang") || "") ? "en" : "ja";
const LATTR = ["title", "cite", "label", "sec", "aff", "short"];
const isJa = e => !!e && (e.tagName === "JA" || /^ja\b/i.test(e.getAttribute("lang") || ""));
pages.forEach(function (pg) {
  pg.querySelectorAll("ja").forEach(e => { e.classList.add("L-ja"); e.setAttribute("lang", "ja"); });
  pg.querySelectorAll("en").forEach(e => { e.classList.add("L-en"); e.setAttribute("lang", "en"); });
  /* a lang="en" element counts only right after a lang="ja" one (a lone lang="en" span is left alone) */
  pg.querySelectorAll("[lang|=en]:not(en)").forEach(function (e) {
    const j = e.previousElementSibling;
    if (isJa(j)) { e.classList.add("L-en"); j.classList.add("L-ja"); }
  });
  pg.querySelectorAll(".L-en").forEach(function (e) {
    const j = e.previousElementSibling;
    if (!isJa(j)) { e.classList.add("solo"); return; }
    if (e.hasAttribute("ja") && e.getAttribute("ja") !== hash(j.textContent)) e.classList.add("en-stale");
  });
  pg.querySelectorAll("ja").forEach(function (j) { const n = j.nextElementSibling; if (!n || !n.classList.contains("L-en")) j.classList.add("solo"); });
});
const EN_ATTR = LATTR.map(a => "[" + a + "-en]").join(",");
const hasEn = pages.some(pg => pg.matches(EN_ATTR) || !!pg.querySelector(".L-en, " + EN_ATTR));
Kamishibai.hasEn = hasEn;
const LKEY = "kamishibai-lang";
let lang = LANG0;
if (hasEn) {
  let v = (location.search.match(/[?&]lang=(ja|en)\b/) || [])[1];
  if (!v) try { v = localStorage.getItem(LKEY); } catch (e) {}
  if (v === "ja" || v === "en") lang = v;
  root.classList.add("bi");
  root.setAttribute("lang", lang);
}
/* {ja, en, stale} of attribute a of e (def / defEn when e has none); en is null when there is no English */
function pair(e, a, def, defEn) {
  const has = e.hasAttribute(a), ja = has ? e.getAttribute(a) : (def || "");
  const en = e.hasAttribute(a + "-en") ? e.getAttribute(a + "-en") : (has ? null : (defEn || null));
  const h = e.getAttribute(a + "-en-ja");
  return { ja: ja, en: en, stale: !!(en != null && h && h !== hash(ja)) };
}
const txt = s => document.createTextNode(s);
/* the node made by make(text) for the Japanese and for the English of p, each in its tag */
function both(p, make) {
  if (!hasEn || p.en == null || p.en === p.ja) return make(p.ja);
  const s = $new("span"), j = document.createElement("ja"), e = document.createElement("en");
  j.className = "L-ja"; j.setAttribute("lang", "ja");
  e.className = "L-en" + (p.stale ? " en-stale" : ""); e.setAttribute("lang", "en");
  j.appendChild(make(p.ja)); e.appendChild(make(p.en));
  s.append(j, e);
  return s;
}

/* ===== Numbers of the statements and references to them =====
   Off unless <html numbering="deck"> (1, 2, 3, …) or numbering="section" (3.1, 3.2, …) asks for it; adding
   "each" counts every kind by itself. Numbered: the boxes (block, alertblock, exampleblock, later) whose
   title starts with a kind and has no number written by hand. name="…" names a box, number="none" takes its
   number away, number="8" counts from there, same="…" gives it the number of a named box. In the text and in
   the attributes of LATTR, \ref{name} becomes "定理 3" / "Theorem 3" and \num{name} becomes "3" (after the
   math is set, so the source and the recorded translations keep the names). tools/numbering.py does the
   same for the checks: change both together (tools/test/numbering-test.mjs compares them) */
const NUMBERING = (root.getAttribute("numbering") || "").trim().split(/\s+/);
const numbering = NUMBERING.find(m => m === "deck" || m === "section") || null;
const problems = [];   // {type, page (from 0, or null), text, el}: what the draft has wrong, for the author
function problem(type, page, text, el) {
  if (problems.some(p => p.type === type && p.page === page && p.text === text && (p.el || null) === (el || null))) return;
  problems.push({ type: type, page: page, text: text, el: el || null });
}
const BOXES = "block, alertblock, exampleblock, later";
const byLen = (a, b) => b.length - a.length, alt = l => l.slice().sort(byLen).join("|");
/* the kind a title starts with, and the number written by hand after it: [whole, kind, number] */
const HEAD_JA = new RegExp("^\\s*(" + alt(BLOCK_KINDS) + ")(?:\\s*([0-9０-９]+(?:[.．][0-9０-９]+)*)|(?=[\\s（(［\\[「]|$))");
const HEAD_EN = new RegExp("^\\s*(" + alt(Object.values(KIND_EN)).replace(/ /g, "\\s+") + ")(?:\\s+([0-9]+(?:\\.[0-9]+)*)|(?=[\\s(\\[]|$))", "i");
const headOf = s => s.match(HEAD_JA) || s.match(HEAD_EN);
const kindOf = w => KIND_EN[w] ? w : Object.keys(KIND_EN).find(k => KIND_EN[k].toLowerCase() === w.toLowerCase().replace(/\s+/g, " "));
const numOf = new Map(), named = new Map();   // box -> its entry; name -> the entry it refers to
Kamishibai.numbers = [];
if (numbering) (function () {
  const each = NUMBERING.includes("each"), off = (root.getAttribute("unnumbered") || "").trim().split(/\s+/);
  let sec = null, name = null, count = {}, auto = 0;
  /* the number of the section after s: 2 -> 3, A -> B */
  const after = s => /^\d+$/.test(s) ? String(+s + 1) : /^[A-Y]$/.test(s) ? String.fromCharCode(s.charCodeAt(0) + 1) : String(auto + 1);
  pages.forEach(function (pg, i) {
    if (numbering === "section" && pg.tagName === "SLIDE") {
      const was = sec, n = pg.hasAttribute("secno") ? pg.getAttribute("secno").trim() : null;
      const starts = pg.hasAttribute("sec") && pg.getAttribute("sec") !== name;
      if (pg.hasAttribute("sec")) name = pg.getAttribute("sec");
      if (n) sec = n === "none" ? null : n;
      else if (starts) sec = after(sec == null ? String(auto) : sec);
      if (/^\d+$/.test(sec)) auto = +sec;
      if (sec !== was) count = {};
    }
    const boxes = [].slice.call(pg.querySelectorAll(BOXES));
    boxes.forEach(function (b) {
      const p = pair(b, "title"), h = headOf(p.ja), id = (b.getAttribute("name") || "").trim();
      const own = b.hasAttribute("number") ? b.getAttribute("number").trim() : null;
      const like = b.hasAttribute("same") ? b.getAttribute("same").trim() : null;
      if (!h) {
        if (id || own || like) problem("number", i, "番号を付けられません：題が主張の種類（定義・定理など）で始まっていません「" + p.ja + "」", b);
        return;
      }
      const he = p.en == null ? null : headOf(p.en), kind = kindOf(h[1]);
      const e = { page: i, box: b, name: id, kind: kind, ja: BLOCK_KINDS.includes(h[1]) ? h[1] : kind,
                  en: he ? he[1].replace(/\s+/g, " ") : kindOf(h[1]) === h[1] ? KIND_EN[kind] : h[1], number: null, same: like };
      /* the English box of a pair of boxes (lang="ja", lang="en") has the number of the Japanese one */
      const E = b.closest(".L-en:not(.solo)"), J = E && E.previousElementSibling;
      const of = r => r.matches(BOXES) ? [r].concat([].slice.call(r.querySelectorAll(BOXES))) : [].slice.call(r.querySelectorAll(BOXES));
      const mate = J && numOf.get(of(J)[of(E).indexOf(b)]);
      let insert = true;
      if (mate) { mate.en = e.en; e.mate = mate; }
      else if (like) { /* after every box has its number */ }
      else if (own === "none" || (own == null && off.includes(kind))) insert = false;
      else if (own == null && h[2]) { e.number = h[2]; insert = false; }   // written by hand: kept, not counted
      else if (own != null && own !== "auto" && !/^\d+$/.test(own)) e.number = own;
      else {
        const k = each ? kind : "";
        count[k] = own != null && own !== "auto" ? +own : (count[k] || 0) + 1;
        e.number = (numbering === "section" && sec != null ? sec + "." : "") + count[k];
        if (numbering === "section" && sec == null) problem("number", i, "節の番号がありません（番号の付いた節より前の主張です）「" + p.ja + "」", b);
      }
      e.insert = insert;
      if (insert && he && he[2] && !h[2]) problem("number", i, "英語の題に番号が手で書かれています「" + p.en + "」", b);
      e.keepEn = !!(he && he[2] && !h[2]);
      if (insert && p.en != null && !he) problem("number", i, "英語の題に番号を付けられません：title-en が主張の種類（Theorem など）で始まっていません「" + p.en + "」", b);
      numOf.set(b, e);
      if (mate) return;
      Kamishibai.numbers.push(e);
      if (!id) return;
      if (named.has(id)) problem("number", i, "名前「" + id + "」が二度付いています（始めは " + (named.get(id).page + 1) + " 枚目）", b);
      else named.set(id, e);
    });
  });
  Kamishibai.numbers.forEach(function (e) {
    if (!e.same) return;
    let t = named.get(e.same);
    for (let n = 0; t && t.same && n < 50; n++) t = named.get(t.same);
    if (!t || t.same || t.number == null) {
      problem("number", e.page, !t ? "same の名前「" + e.same + "」の主張がありません" : "same の名前「" + e.same + "」の主張に番号がありません", e.box);
      e.number = "??";
    } else e.number = t.number;
  });
  numOf.forEach(function (e) { if (e.mate) e.number = e.mate.number; });
  /* the same kind and number twice, one of them given here */
  const seen = new Map();
  Kamishibai.numbers.forEach(function (e) {
    if (e.same || e.number == null) return;
    const k = e.kind + " " + e.number.normalize("NFKC"), f = seen.get(k);
    if (!f) seen.set(k, e);
    else if (e.insert || f.insert) problem("number", e.page, "「" + e.ja + " " + e.number + "」が二つあります（始めは " + (f.page + 1) + " 枚目。同じ主張なら same を付けます）", e.box);
  });
})();
/* the title p of box b with its number after the kind */
function numbered(b, p) {
  const e = numOf.get(b);
  if (!e || !e.insert || e.number == null) return p;
  const put = function (s) {
    const h = s == null ? null : headOf(s);
    return h ? s.slice(0, h[0].indexOf(h[1]) + h[1].length) + " " + e.number + s.slice(h[0].indexOf(h[1]) + h[1].length) : s;
  };
  return { ja: put(p.ja), en: e.keepEn ? p.en : put(p.en), stale: p.stale };
}
const REF = /\\(ref|num)\{([^{}]*)\}/g;
const hasRef = s => /\\(ref|num)\{[^{}]*\}/.test(s);
/* the text of \ref{name} or \num{name} in language L, or null with the problem reported */
function refText(cmd, id, L, page, el) {
  const e = named.get(id.trim());
  if (!e) { problem("ref", page, "\\" + cmd + "{" + id + "} の名前の主張がありません", el); return null; }
  if (cmd === "num" && e.number == null) { problem("ref", page, "\\num{" + id + "} の主張に番号がありません", el); return null; }
  return cmd === "num" ? e.number : (L === "en" ? e.en : e.ja) + (e.number == null ? "" : "\u00a0" + e.number);
}
const refsIn = (s, L, page, el) => s.replace(REF, function (m, c, id) { const t = refText(c, id, L, page, el); return t == null ? "??" : t; });
/* for the figures drawn by code: Kamishibai.ref("name") is "定理 3" in the shown language */
Kamishibai.ref = (id, L) => refText("ref", id, L || lang, null, null) || "??";
function references() {
  const skip = ".katex, script, style, noscript, textarea, pre, code, option", jp = /[぀-ヿ㐀-䶿一-鿿]/;
  const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT), hits = [];
  while (w.nextNode()) {
    const p = w.currentNode.parentElement;
    if (hasRef(w.currentNode.nodeValue) && p && !p.closest(skip)) hits.push(w.currentNode);
  }
  const pageOf = e => { const s = e.closest(".page"); return s ? +s.dataset.k : null; };
  if (!numbering) {   // the names stay as they are written
    hits.forEach(t => problem("ref", pageOf(t.parentElement), "\\ref・\\num がありますが、<html> に numbering がありません", t.parentElement));
    return;
  }
  hits.forEach(function (t) {
    const p = t.parentElement, svg = p.namespaceURI === "http://www.w3.org/2000/svg", page = pageOf(p);
    const el = (cls, l, s) => {
      const x = svg ? document.createElementNS(p.namespaceURI, "tspan") : document.createElement(l || "span");
      if (cls) x.setAttribute("class", cls);
      if (l) x.setAttribute("lang", l);
      if (s != null) x.textContent = s;
      return x;
    };
    const side = p.closest(".L-ja, .L-en"), s = t.nodeValue;
    /* a text in neither language of a pair shows the word of the shown language, unless it is Japanese */
    const L = side ? (side.classList.contains("L-en") ? "en" : "ja") : !hasEn ? LANG0 : jp.test(s.replace(REF, "")) ? "ja" : null;
    const frag = document.createDocumentFragment();
    let at = 0, run = "";   // run: text not put in yet (one node, so that the brackets and runs below are seen whole)
    const flush = () => { if (run) frag.append(run); run = ""; };
    s.replace(REF, function (m, c, id, k) {
      run += s.slice(at, k);
      at = k + m.length;
      const ja = refText(c, id, L || "ja", page, p), en = L || c === "num" || ja == null ? ja : refText(c, id, "en", page, p);
      if (ja == null) { flush(); frag.append(el("ref-bad", null, "??")); }
      else if (ja === en) run += ja;
      else { flush(); const b = el(); b.append(el("L-ja", "ja", ja), el("L-en", "en", en)); frag.append(b); }
      return m;
    });
    run += s.slice(at);
    flush();
    p.replaceChild(frag, t);
  });
  /* captions of the flip figures are put in later as text */
  stage.querySelectorAll("[data-caps], [data-caps-en]").forEach(function (c) {
    if (c.dataset.caps && hasRef(c.dataset.caps)) c.dataset.caps = refsIn(c.dataset.caps, hasEn ? "ja" : LANG0, pageOf(c), c);
    if (c.dataset.capsEn && hasRef(c.dataset.capsEn)) c.dataset.capsEn = refsIn(c.dataset.capsEn, "en", pageOf(c), c);
  });
}

/* Footer text (Madrid) taken from the cover; short="…" (short-en="…") wins. <rt> dropped, <br> -> space */
function shortOf(e, L) {
  if (L === "en" && e.hasAttribute("short-en")) return e.getAttribute("short-en");
  if (e.hasAttribute("short") && (L !== "en" || !e.querySelector(".L-en"))) return e.getAttribute("short");
  return null;
}
function plain(e, L) {
  const s = shortOf(e, L);
  if (s != null) return s;
  const c = e.cloneNode(true);
  c.querySelectorAll(L === "en" ? ".L-ja:not(.solo)" : ".L-en").forEach(r => r.remove());
  c.querySelectorAll("rt").forEach(r => r.remove());
  c.querySelectorAll("br").forEach(b => b.replaceWith(" "));
  return norm(c.textContent);
}
const FOOT = { who: { ja: "", en: null }, title: { ja: "", en: null }, date: { ja: "", en: null } };
const cov = pages.find(e => e.tagName === "COVER");
if (cov) {
  const a = cov.querySelector("author[presenter]") || cov.querySelector("author"), h = cov.querySelector("headline"), d = cov.querySelector("date");
  const who = function (L) {
    const s = shortOf(a, L);
    if (s != null) return s;
    const f = a.getAttribute(L === "en" && a.hasAttribute("aff-en") ? "aff-en" : "aff");
    return plain(a, L) + (f ? "  (" + f + ")" : "");
  };
  ["ja", "en"].forEach(function (L) {
    if (a) FOOT.who[L] = who(L);
    if (h) FOOT.title[L] = plain(h, L);
    if (d) FOOT.date[L] = plain(d, L);
  });
}
function foot(i) {
  const f = $new("div", "foot"), f3 = $new("div", "f3");
  const el = (tag, cls, p) => { const x = $new(tag, cls); x.appendChild(both(p, txt)); return x; };
  f3.append(el("span", "fdate", FOOT.date), $new("span", "pageno", (i + 1) + " / " + pages.length));
  f.append(el("div", "f1", FOOT.who), el("div", "f2", FOOT.title), f3);
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
  title.split(numbering ? /([０-９]+)(?![^{}]*\})/ : /([０-９]+)/).forEach(function (s, k) {
    if (s) ttl.appendChild(k % 2 ? $new("span", "zd", s) : document.createTextNode(s));
  });
  return ttl;
}

/* Kamishibai components written as tags */
function components(pg) {
  pg.querySelectorAll("alert").forEach(e => e.classList.add("k"));
  [["proof", "pf", "証明", "Proof"], ["plan", "pf pl", "証明の方針", "Proof sketch"], ["later", "ph", "", ""]].forEach(function (c) {
    pg.querySelectorAll(c[0]).forEach(function (e) {
      c[1].split(" ").forEach(k => e.classList.add(k));
      const title = numbered(e, pair(e, "title", c[2], c[3]));
      e.removeAttribute("title");
      if (title.ja || title.en) { const pt = $new("div", "pt"); pt.appendChild(both(title, titleSpan)); e.prepend(pt); }
    });
  });
  pg.querySelectorAll("nums").forEach(function (e) {
    e.classList.add("nums");
    const start = parseInt(e.getAttribute("start"), 10);
    if (start > 1) e.style.counterReset = "n " + (start - 1);
    if (e.hasAttribute("labels")) e.classList.add("lab");
    e.querySelectorAll(":scope > item[label]").forEach(function (it) {
      const lb = $new("span", "lb");
      lb.appendChild(both(pair(it, "label"), txt));
      it.prepend(lb);
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
    if (c.hasAttribute("caps-en")) c.setAttribute("data-caps-en", c.getAttribute("caps-en"));
  });
  ["cards", "ov", "with"].forEach(function (a) {
    pg.querySelectorAll("[" + a + "]").forEach(function (e) { e.setAttribute("data-" + a, e.getAttribute(a)); });
  });
}

pages.forEach(function (pg, i) {
  const sec = $new("section", "page");
  const tag = pg.tagName;
  sec.dataset.k = i;   // also on the copies (overview, printing): the shrink of the page is set on all

  if (tag === "SLIDE") {
    /* the title is one span (.ttl is flex; .ja spans would scatter it) */
    const tp = pair(pg, "title"), ts = sec.appendChild($new("div", "ttl")).appendChild($new("span"));
    if (tp.ja || tp.en) ts.appendChild(both(tp, txt));
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
    const authors = pg.querySelectorAll("author"), affs = [], affP = {};
    authors.forEach(function (a) {
      const f = a.getAttribute("aff");
      if (f && affs.indexOf(f) < 0) affs.push(f);
      if (f && (!affP[f] || affP[f].en == null)) affP[f] = pair(a, "aff");
    });
    authors.forEach(function (a) {
      if (affs.length > 1 && a.hasAttribute("aff")) a.appendChild($new("sup", null, String(affs.indexOf(a.getAttribute("aff")) + 1)));
      box.appendChild(a);
    });
    affs.forEach(function (f, k) {
      const s = insts.appendChild($new("span"));
      if (affs.length > 1) s.appendChild($new("sup", null, String(k + 1)));
      s.appendChild(both(affP[f], txt));
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
    const bt = $new("div", "bt"), bb = $new("div", "bb"), tp = pair(b, "title"), title = tp.ja;
    /* A box holds one statement (BLOCK_KINDS). While drafting, a box whose title names no kind is marked;
       tools/check_blocks.py checks the rest, and tools/pack_engine.py packs no draft that fails it */
    if (!packed && !BLOCK_HEAD.test(title.trim())) {
      b.classList.add("bad-box");
      console.warn("Kamishibai: page " + (i + 1) + ": a box titled \"" + title + "\" is not a statement (" + BLOCK_KINDS.join(", ") + ")");
    }
    if (title || tp.en) bt.appendChild(both(numbered(b, tp), titleSpan));
    if (b.hasAttribute("cite")) bt.appendChild($new("cite")).appendChild(both(pair(b, "cite"), txt));
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
    if (pg.hasAttribute("sec") && (!cur || cur.name !== pg.getAttribute("sec"))) { cur = { name: pg.getAttribute("sec"), p: pair(pg, "sec"), sl: [] }; secs.push(cur); }
    if (cur) cur.sl.push(pg);
  });
  secs.forEach(function (sc) {
    sc.sl.forEach(function (pg) {
      const hl = $new("div", "hl");
      secs.forEach(function (t) {
        const hs = $new("div", "hs" + (t === sc ? " cur" : "")), hf = $new("div", "hf");
        t.sl.forEach(x => hf.appendChild($new("i", x === pg ? "cur" : null)));
        const hn = $new("div", "hn");
        if (numbering) hn.dataset.name = t.name;   // as written (page-edit finds the section by it)
        hn.appendChild(both(t.p, txt));
        hs.append(hn, hf);
        hl.appendChild(hs);
      });
      pg.parentNode.appendChild(hl);
    });
  });
})();

/* ===== size="32" (pt) ===== */
stage.querySelectorAll("[size]:not(input, select, font, hr, basefont)").forEach(function (e) {
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

references();
problems.forEach(p => console.warn("Kamishibai: " + (p.page == null ? "" : "page " + (p.page + 1) + ": ") + p.text));

/* ===== Japanese with no English (in a deck that has English): its element is marked .untr ===== */
if (hasEn) (function () {
  const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT), jp = /[぀-ヿ㐀-䶿一-鿿]/;
  while (w.nextNode()) {
    const t = w.currentNode, p = t.parentElement;
    if (p && jp.test(t.nodeValue) && !p.closest(".L-ja, .L-en, .katex, script, style")) p.classList.add("untr");
  }
})();

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
    if (p && PUNCT.test(t.nodeValue) && !p.closest(".katex, svg, .L-en")) hits.push(t);
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
    if (!p || !has.test(t.nodeValue) || p.closest(".katex, svg, .L-en")) continue;
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
   must not keep the deck hidden). Before that, the pages that overflow are shrunk (shrinkPages).
   Kamishibai.ready resolves then, with Kamishibai.fits */
stage.style.visibility = "hidden";
Kamishibai.ready = Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]).then(function () {
  try { shrinkPages(); } catch (e) { console.error(e); }
  finally { stage.style.visibility = ""; }
  return Kamishibai.fits;
});

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
  const p = v.split("|"), x = p[Math.min(k, p.length - 1)].trim();
  if (x === "*") return n;
  if (!/^\d+$/.test(x)) { console.warn('kamishibai: cards="' + v + '": not a count ("n", "*", or "a|b" per figure)'); return null; }
  return parseInt(x, 10);
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
  if (c && c.dataset.caps !== undefined && btns[k]) {
    f.dataset.k = k;
    const en = hasEn && lang === "en", b = btns[k].cloneNode(true);
    b.querySelectorAll(en ? ".L-ja:not(.solo)" : ".L-en").forEach(e => e.remove());
    const caps = (en && c.dataset.capsEn !== undefined ? c.dataset.capsEn : c.dataset.caps).split("|");
    c.replaceChildren.apply(c, [].slice.call(b.childNodes).concat([txt((en ? ": " : "：") + (caps[k] || ""))]));
  }
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
document.addEventListener("kamishibai:lang", function () {
  flips.forEach(f => { if (f.id && f.dataset.k !== undefined) setFlip(f.id, +f.dataset.k); });
});

/* ===== Step groups: a step with with="prev" belongs to the group of the step before it ===== */
function groups(page) {
  const g = [];
  page.querySelectorAll(STEP).forEach(function (e) {
    if (g.length && e.dataset.with === "prev") g[g.length - 1].push(e); else g.push([e]);
  });
  return g;
}

/* Copy of a page (overview and printing): the first `shown` steps on. Each id gets a suffix of its
   copy, and the references inside the copy follow it (url(#…) in attributes and <style>, and
   href="#…" of SVG elements), so that gradients, markers, clip paths and <use> still draw */
let copies = 0;
const URLREF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;
function copyPage(sec, shown) {
  const c = sec.cloneNode(true), sfx = "--c" + (++copies), ids = new Map();
  c.classList.add("on");
  [c].concat([].slice.call(c.querySelectorAll("[id]"))).forEach(function (e) {
    if (e.id) { ids.set(e.id, e.id + sfx); e.id += sfx; }
  });
  if (ids.size) {
    const fix = v => v.replace(URLREF, (m, q, id) => ids.has(id) ? "url(#" + ids.get(id) + ")" : m);
    c.querySelectorAll("*").forEach(function (e) {
      [].slice.call(e.attributes).forEach(function (a) {
        const v = a.value;
        if (/^(xlink:)?href$/.test(a.name)) {
          if (v[0] === "#" && ids.has(v.slice(1)) && e.namespaceURI === "http://www.w3.org/2000/svg") a.value = "#" + ids.get(v.slice(1));
        } else if (v.indexOf("url(") >= 0) { const w = fix(v); if (w !== v) a.value = w; }
      });
      if (e.localName === "style") e.textContent = fix(e.textContent);
    });
  }
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
  th.addEventListener("click", function () { go(i, true); if (sideOver()) tool("side"); });
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

/* ===== Shrink to fit: a page whose content runs past its area (all steps shown; steps only fade) is
   drawn smaller, by 0.02 down to FIT_MIN, through `zoom` on the children of its slide / cover / divider.
   Measured for each language after the fonts are in; the result is --fit-ja / --fit-en on the page and
   its copies. A page still overflowing at FIT_MIN gets .over-ja / .over-en (outlined in edit mode) and
   a warning in the console. Kamishibai.fits = { ja: [{ zoom, over }, …], en: […] } ===== */
const FIT_MIN = 0.85, FIT_STEP = 0.02;
Kamishibai.fits = {};
function overflows(sec) {
  const ce = sec.querySelector(":scope > :is(cover, slide, divider)");
  if (!ce) return false;
  const s = sec.getBoundingClientRect().height / (sec.offsetHeight || 1) || 1;
  const bottom = ce.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(ce).paddingBottom) || 0) * s;
  let max = -Infinity;
  [].forEach.call(ce.children, function (c) {
    const cs = getComputedStyle(c);
    if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none") return;
    const b = c.getBoundingClientRect();
    if (b.width || b.height) max = Math.max(max, b.bottom);
  });
  return max > bottom + 0.5 * s;
}
function shrinkPages() {
  const cur = root.getAttribute("lang"), fits = {};
  (hasEn ? ["ja", "en"] : [LANG0]).forEach(function (L) {
    if (hasEn) root.setAttribute("lang", L);
    fits[L] = secs.map(function (sec, i) {
      const on = sec.classList.contains("on");
      sec.classList.add("on");
      let z = 1;
      sec.style.setProperty("--fit", "1");
      while (z > FIT_MIN + 1e-9 && overflows(sec)) {
        z = Math.max(FIT_MIN, Math.round((z - FIT_STEP) * 100) / 100);
        sec.style.setProperty("--fit", String(z));
      }
      const over = overflows(sec);
      sec.style.removeProperty("--fit");
      sec.classList.toggle("on", on);
      document.querySelectorAll('.page[data-k="' + i + '"]').forEach(function (p) {
        if (z < 1) p.style.setProperty("--fit-" + L, String(z)); else p.style.removeProperty("--fit-" + L);
        p.classList.toggle("over-" + L, over);
      });
      if (over) console.warn("Kamishibai: page " + (i + 1) + " (" + L + ") overflows even at " + FIT_MIN);
      return { zoom: z, over: over };
    });
  });
  if (hasEn) root.setAttribute("lang", cur);
  Kamishibai.fits = fits;
}

/* ===== Stage size from the theme (--W, --H): screen fit, thumbnails, paper size ===== */
const SW = parseFloat(cssVar("--W")) || 1280, SH = parseFloat(cssVar("--H")) || 720;
Kamishibai.size = [SW, SH];
root.style.setProperty("--ratio", String(SH / SW));
root.style.setProperty("--tscale", String(192 / SW));
document.head.appendChild($new("style", null, "@page { size: " + (SW * .75) + "pt " + (SH * .75) + "pt; margin: 0 }"));
/* The panel (40px wide) sits in the gap left of the page. When that gap is narrower than GUT, the page
   gives up just enough room on the left (it moves right by at most GUT / 2) */
const GUT = 52;
/* Phones and tablets: html.touch. No gap is kept for the panel (it goes where the screen has room, see base.css).
   Held upright, the page is centred in what is left above ◀ ▶ (NAV). On a phone the overview lies over the page */
const NAV = 76, touchMQ = matchMedia("(hover: none), (pointer: coarse)");
const isTouch = () => touchMQ.matches;
function touchClass() { root.classList.toggle("touch", isTouch()); }
touchClass();
touchMQ.addEventListener("change", function () { touchClass(); fit(); });
const sideOver = () => isTouch() && Math.min(innerWidth, innerHeight) < 600;
function fit() {
  const L = body.classList.contains("side-on") && !sideOver() ? side.offsetWidth : 0, W = innerWidth - L, H = innerHeight;
  let s = Math.min(W / SW, H / SH), x = (W - SW * s) / 2, y = (H - SH * s) / 2;
  /* in fullscreen the page fills the screen; the panel, shown only while the mouse is near, lies over it */
  const full = document.fullscreenElement || document.webkitFullscreenElement;
  if (isTouch()) { if (H > innerWidth) y = Math.max(0, (H - NAV - SH * s) / 2); }
  else if (x < GUT && !full) { s = Math.min(H / SH, (W - GUT) / SW); x = GUT + (W - GUT - SW * s) / 2; y = (H - SH * s) / 2; }
  stage.style.transform = "translate(" + (L + x) + "px," + y + "px) scale(" + s + ")";
  /* in 出力 the printed sheets, not the page, leave the gap */
  if (!tools) return;
  const left = body.classList.contains("mode-out") ? (root.clientWidth - SW * parseFloat(cssVar("--pzoom") || 1) - 80) / 4 : L + (x - 40) / 2;
  if (body.classList.contains("side-on") && sideOver()) tools.style.left = side.offsetWidth + 6 + "px";
  else tools.style.left = Math.max(4, left) + "px";
}
let tools = null;
addEventListener("resize", function () { zoomPrint(); fit(); });
document.addEventListener("fullscreenchange", fit);
document.addEventListener("webkitfullscreenchange", fit);

/* ===== Three modes, chosen in the panel in the gap left of the page (it opens upward) or by their keys =====
   プレゼン (default): fullscreen ⌘F, pointer ⌘K, steps S, select ⌘I (text can be selected, clicks do not turn
     pages, ← → still do), keys off ⌘U (badge at the top right; select and keys off exclude each other).
   編集 ⌘E: the text is edited on the page by the page-edit extension (Kamishibai.setEditor); without it the
     heading is gray. Clicks do not turn pages.
   出力 ⌘P: the printed sheets are shown on the screen; PDF with one sheet per step, PDF with all steps on one
     sheet (both through the print dialog), or one HTML file (page-edit writes it; without it: make pack).
   Pages ⌘B and the stroke of Japanese text work in every mode. The key of the current mode, pressed again,
   goes back to プレゼン */
function fullscreen() {
  const d = document, el = d.documentElement;
  const exit = d.exitFullscreen || d.webkitExitFullscreen, enter = el.requestFullscreen || el.webkitRequestFullscreen;
  if (d.fullscreenElement || d.webkitFullscreenElement) { if (exit) exit.call(d); }
  else if (enter) enter.call(el);
}
const mac = /Mac|iPhone|iPad/.test(navigator.platform), mod = mac ? "⌘" : "Ctrl+";
const st = { mode: "show", side: false, ptr: false, sel: false, op: false, out: "steps" };
let editor = window.KamishibaiEditor || null;
tools = $new("div", "tools");
const lit = {}, vals = [];
const edText = () => editor && editor.enter ? "文をクリックして直す（Enter で保存、Esc で取り消し）" : "文を直すには拡張機能 page-edit が要ります";
const canHTML = () => !!(editor && editor.exportHTML) && !Kamishibai.packed;
const outText = () => st.out !== "html" ? "出力を押し、印刷の画面で「PDF に保存」を選ぶ"
  : canHTML() ? "出力を押すと、原稿の隣に 名前.dist.html を書く" : "HTML は make pack で作ります（page-edit があればここから出せます）";
const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen);
const NAMES = { ptr: "ポインター", sel: "選択", op: "キー無効" };
function render() {
  const C = body.classList, show = st.mode === "show";
  C.toggle("side-on", st.side);
  C.toggle("ptr-on", show && st.ptr);
  C.toggle("edit", (show && st.sel) || st.mode === "edit");
  C.toggle("op", show && st.op);
  C.toggle("mode-edit", st.mode === "edit");
  C.toggle("mode-out", st.mode === "out");
  C.toggle("print-steps", st.mode === "out" && st.out === "steps");
  const on = { side: st.side, ptr: st.ptr, sel: st.sel, op: st.op, steps: stepMode, lang: hasEn && lang === "en",
               edit: st.mode === "edit", show: show, out: st.mode === "out",
               "o-steps": st.out === "steps", "o-all": st.out === "all", "o-html": st.out === "html" };
  Object.keys(lit).forEach(k => lit[k].forEach(b => b.classList.toggle("on", !!on[k])));
  lit.edit.forEach(b => b.classList.toggle("off", !(editor && editor.enter)));
  lit.lang.forEach(b => b.classList.toggle("off", !hasEn));
  lit["o-html"].forEach(b => b.classList.toggle("off", !canHTML()));
  outBtn.classList.toggle("off", st.out === "html" && !canHTML());
  outBtn.title = outText();
  /* while folded, a dot on the handle tells that pointer, select or keys off is on */
  const act = show ? Object.keys(NAMES).filter(k => st[k]).map(k => NAMES[k]) : [];
  handle.classList.toggle("dot", act.length > 0);
  handle.title = (body.classList.contains("tools-open") ? "道具をしまう" : "道具を開く") + (act.length ? "（オン：" + act.join("・") + "）" : "");
}
/* m: "show", "edit" or "out" */
function setMode(m) {
  if (m === st.mode) return;
  if (st.mode === "edit" && editor && editor.leave) editor.leave();
  st.mode = m;
  if (m === "out") { openTools(true); zoomPrint(); }
  render();
  fit();
  if (m === "edit") { if (editor && editor.enter) editor.enter(); toast(edText() + langNote(), 3500); }
  if (m === "out") toast(outText(), 2500);
}
function zoomPrint() { root.style.setProperty("--pzoom", String(Math.min(1, (innerWidth - 2 * GUT) / SW))); }
/* the tools: those of プレゼン first leave another mode */
function tool(name) {
  if (name === "edit" && st.mode !== "edit" && !(editor && editor.enter)) {
    openTools(true); tools.classList.add("show"); toast(edText(), 2500); return;
  }
  if (name === "edit" || name === "out") { setMode(st.mode === name ? "show" : name); return; }
  if (name === "show") { setMode("show"); return; }
  if (name === "lang") { setLang(lang === "en" ? "ja" : "en"); return; }
  if (name === "side") { st.side = !st.side; render(); fit(); if (st.side) showCurrent(); return; }
  if (/^o-/.test(name)) { st.out = name.slice(2); render(); toast(outText(), 2500); return; }
  setMode("show");
  if (name === "full") { fullscreen(); return; }
  if (name === "steps") { toggleSteps(); return; }
  st[name] = !st[name];
  if (st[name] && name === "sel") st.op = false;
  if (st[name] && name === "op") st.sel = false;
  render();
}
function output() {
  if (st.out === "html") { if (canHTML()) editor.exportHTML(); return; }
  render();
  print();
}
/* Icons: 24 × 24 line drawings (stroke only) */
const ICON = {
  up: "M6 15l6-6 6 6", down: "M6 9l6 6 6-6",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  show: "M3 4h18v12H3zM12 16v4M8 20h8M10 7.5l4.5 2.5-4.5 2.5z",
  out: "M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7z",
  full: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  ptr: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v4M12 18v4M2 12h4M18 12h4",
  steps: ["M4 6h1M9 6h11M4 12h1M9 12h11", "M4 18h1M9 18h11"],
  side: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  sel: "M9 4h6M9 20h6M12 4v16",
  op: "M3 7h18v10H3zM7 11h1M11 11h1M15 11h1M8 14h8M3 3l18 18",
  stroke: "M5 20l7-16 7 16M8 14h8",
  lang: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  "o-steps": "M8 3h12v14H8zM5 6v15h11",
  "o-all": "M5 3h14v18H5zM8 7h8M8 11h8M8 15h8",
  "o-html": "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14",
  go: "M12 3v12M7 10l5 5 5-5M4 20h16",
  plus: "M12 6v12M6 12h12", minus: "M6 12h12"
};
function svg(k) {
  /* an array icon: the first path is drawn solid, the second dashed and faded (not yet shown) */
  const [d, dim] = [].concat(ICON[k]);
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/>' +
    (dim ? '<path class="dim" d="' + dim + '"/>' : '') + '</svg>';
}
/* name: the tool (tool(name)); tip: the name and key, shown when the mouse rests on it */
function button(name, tip, icon, cls) {
  const el = $new("button", cls || "it");
  el.innerHTML = svg(icon || name);
  el.title = tip;
  el.setAttribute("aria-label", tip);
  el.addEventListener("click", function () { el.blur(); if (name) tool(name); });
  if (name) (lit[name] = lit[name] || []).push(el);
  return el;
}
const handle = $new("button", "handle");
handle.innerHTML = svg("up");
function openTools(open) {
  body.classList.toggle("tools-open", open);
  handle.innerHTML = svg(open ? "down" : "up");
  render();
  fit();
}
handle.addEventListener("click", function () { openTools(!body.classList.contains("tools-open")); handle.blur(); });
/* Stroke added to Japanese text (--ja-stroke), changed by 0.1pt; remembered by the browser */
const KEY = "kamishibai-ja-stroke";
const base = (function () {
  const v = cssVar("--ja-stroke"), n = parseFloat(v);
  return isNaN(n) ? 0.2 : (/px$/.test(v) ? n * 0.75 : n);
})();
let stroke = base;
function setStroke(pt, keep) {
  pt = Math.max(0, Math.round(pt * 10) / 10);
  root.style.setProperty("--ja-stroke", pt + "pt");
  vals.forEach(v => { v.textContent = pt.toFixed(1); });
  try { if (keep) localStorage.setItem(KEY, pt); else localStorage.removeItem(KEY); } catch (e) {}
  return pt;
}
/* the stroke button opens + / value / − in the same column */
function strokeTool() {
  const wrap = $new("div", "sk-wrap"), sk = $new("div", "sk");
  const b = button(null, "日本語の文字の太さ（+ と − で 0.1pt ずつ）", "stroke");
  b.addEventListener("click", function () { b.classList.toggle("on", sk.classList.toggle("open")); });
  [["plus", 0.1], [null, 0], ["minus", -0.1]].forEach(function (d) {
    const el = d[0] ? button(null, d[1] > 0 ? "太く" : "細く", d[0]) : $new("button", "it val");
    if (!d[0]) { vals.push(el); el.title = "日本語の文字に足す線の太さ（pt）。押すとテーマの値に戻る"; }
    el.addEventListener("click", function () {
      stroke = d[1] ? setStroke(stroke + d[1], true) : setStroke(base, false);
      el.blur();
    });
    sk.appendChild(el);
  });
  wrap.append(b, sk);
  return wrap;
}
function group(cls, items) {
  const g = $new("div", cls);
  items.forEach(el => g.appendChild(el));
  tools.appendChild(g);
  return g;
}
const sep = c => $new("div", "sep" + (c ? " " + c : ""));
const outBtn = button(null, "出力", "go", "it go");
outBtn.addEventListener("click", output);
group("grp g-edit", [button("side", "ページ一覧 " + mod + "B"), strokeTool()]);
group("grp g-show", [button("full", "全画面 " + mod + "F", "full", "it" + (canFull ? "" : " no")), button("ptr", "ポインター " + mod + "K", "ptr", "it nt"), button("steps", "段階表示 S"),
  button("side", "ページ一覧 " + mod + "B"), button("lang", "日本語 ⇄ English L"), sep("nt"), button("sel", "選択 " + mod + "I", "sel", "it nt"), button("op", "キー無効 " + mod + "U", "op", "it nt"), sep(), strokeTool()]);
group("grp g-out", [button("o-steps", "PDF：段階ごとに 1 枚"), button("o-all", "PDF：全段階を 1 枚に"), button("o-html", "HTML：1 ファイル"), outBtn]);
/* the modes and the handle sit on a card of their own, below the card of the current mode's tools */
const dock = $new("div", "dock");
dock.append(group("modes", [button("edit", "モード：編集 " + mod + "E（もう一度押すとプレゼンに戻る）"), button("show", "モード：プレゼン"),
  button("out", "モード：出力 " + mod + "P（もう一度押すとプレゼンに戻る）")]), handle);
tools.appendChild(dock);
try { const s = parseFloat(localStorage.getItem(KEY)); if (!isNaN(s)) stroke = s; } catch (e) {}
stroke = setStroke(stroke, stroke !== base);
body.appendChild(tools);
const badge = $new("div", "badge", mod + "U"), ptr = $new("div", "pointer"), toastEl = $new("div", "toast");
body.append(badge, ptr, toastEl);
/* page-edit hands over { enter, leave, exportHTML } (before the build as window.KamishibaiEditor, or later) */
Kamishibai.setEditor = function (ed) { editor = ed; render(); };
Kamishibai.mode = function (m) { if (m !== undefined) setMode(m); return st.mode; };
/* Language shown: "ja" or "en" (only in a deck that has English); event kamishibai:lang on a change */
function setLang(L) {
  if (!hasEn) { toast("このスライドには英語の文がありません", 2000); return; }
  if (L !== "ja" && L !== "en" || L === lang) return;
  lang = L;
  root.setAttribute("lang", L);
  try { localStorage.setItem(LKEY, L); } catch (e) {}
  render();
  toast(L === "en" ? "English" : "日本語");
  if (st.mode === "edit") { const n = langNote(); if (n) toast(n.trim(), 3000); }
  document.dispatchEvent(new CustomEvent("kamishibai:lang", { detail: L }));
}
Kamishibai.lang = function (L) { if (L !== undefined) setLang(L); return lang; };
/* in English, what is left to translate (shown on entering edit mode) */
function langNote() {
  if (!hasEn || lang !== "en") return "";
  const n = c => stage.querySelectorAll(c).length;
  const a = [["古い訳", n(".en-stale")], ["訳なし", n(".untr") + n(".L-ja.solo")], ["収まらない頁", n(".page.over-en")]].filter(x => x[1]);
  return a.length ? "　英語：" + a.map(x => x[0] + " " + x[1]).join("・") : "";
}
function toast(t, ms) {
  toastEl.textContent = t;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 1200);
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
render();
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
  render();
  toast("段階表示：" + (stepMode ? "オン" : "オフ"));
}

/* ===== Click: left quarter = back, elsewhere = forward.
   Not in select / keys-off mode, not on controls (buttons, inputs, bars, switches, the overview) nor on
   what a click does something to (links, video, audio, details, frames, editable text).
   Ignored: drags (> 4px), double and triple clicks, clicks while text is selected or that clear a
   selection. A single click waits 260 ms so that it can be told from a double click ===== */
function selecting() { const s = getSelection(); return !!s && !s.isCollapsed && s.toString().trim() !== ""; }
let pend = 0, down = null, hadSel = false;
addEventListener("mousedown", function (e) { down = [e.clientX, e.clientY]; hadSel = selecting(); });
addEventListener("click", function (e) {
  if (body.classList.contains("edit") || body.classList.contains("op") || body.classList.contains("mode-out") ||
      /* the path of the click, not e.target.closest: a control may replace what was clicked (the handle swaps its icon) */
      e.composedPath().some(n => n.matches && n.matches("button, input, select, textarea, label, a[href], video, audio, iframe, details, summary, [contenteditable], " +
                       ".bar, .sw, .ctrl, switch, body > .side, .tools"))) return;
  clearTimeout(pend); pend = 0;
  const moved = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4;
  if (moved || hadSel || selecting()) return;
  const back = e.clientX < innerWidth * 0.25;
  /* a tap turns the page at once: on a touch screen quick taps are not a double click */
  if (isTouch()) { if (back) prev(); else next(); return; }
  if (e.detail > 1) return;
  pend = setTimeout(function () { pend = 0; if (selecting()) return; if (back) prev(); else next(); }, 260);
});
/* Keys: ⌘ (Ctrl on Windows) + E P switch the mode, + B F K I U toggle; other ⌘ keys go to the browser.
   Select and edit mode turn pages with ← → only; keys-off and output mode never turn pages */
document.addEventListener("keydown", function (e) {
  const k = e.key, edit = body.classList.contains("edit");
  const keys = { KeyE: "edit", KeyP: "out", KeyB: "side", KeyF: "full", KeyK: "ptr", KeyI: "sel", KeyU: "op" };
  if ((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && keys[e.code]) { e.preventDefault(); tool(keys[e.code]); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || body.classList.contains("op") || st.mode === "out") return;
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
  else if (!edit && !e.shiftKey && (k === "l" || k === "L")) { e.preventDefault(); tool("lang"); }
});
/* sliders and buttons in a slide give the focus back once used, so keys turn pages again */
["change", "pointerup"].forEach(function (t) {
  stage.addEventListener(t, function (e) { if (e.target.matches("input, button")) e.target.blur(); });
});

/* Swipe: to the left = forward, to the right = back. Not in edit, select, keys-off or output mode, not on controls or
   on what follows the finger itself (touch-action: none), not while the screen is pinched larger */
let swipe = null;
document.addEventListener("touchstart", function (e) {
  swipe = null;
  if (e.touches.length !== 1 || (window.visualViewport && visualViewport.scale > 1.05)) return;
  if (["edit", "op", "mode-out"].some(c => body.classList.contains(c))) return;
  if (e.composedPath().some(n => n.matches && (n.matches("input, select, textarea, video, audio, iframe, [contenteditable], " +
      ".bar, .sw, .ctrl, switch, body > .side, .tools") || getComputedStyle(n).touchAction === "none"))) return;
  swipe = [e.touches[0].clientX, e.touches[0].clientY, Date.now()];
}, { passive: true });
document.addEventListener("touchmove", function (e) { if (e.touches.length !== 1) swipe = null; }, { passive: true });
document.addEventListener("touchcancel", function () { swipe = null; });
document.addEventListener("touchend", function (e) {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe[0], dy = t.clientY - swipe[1], ms = Date.now() - swipe[2];
  swipe = null;
  if (ms > 800 || Math.abs(dx) < 40 || Math.abs(dx) < 2 * Math.abs(dy) || selecting()) return;
  if (dx < 0) next(); else prev();
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
addEventListener("hashchange", function () { if (/^#s\d+$/.test(location.hash)) go(hashPage()); });
Kamishibai.go = go; Kamishibai.next = next; Kamishibai.prev = prev; Kamishibai.current = function () { return si; };
si = hashPage();
paint();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
else build();
})();
