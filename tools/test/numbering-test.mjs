// The numbers of the statements and the references (<html numbering="…">, engine/kamishibai.js and
// tools/numbering.py): node tools/test/numbering-test.mjs [part of a name]
import { test, run, eq, ok, ROOT } from "./harness.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const venv = join(ROOT, ".venv/bin/python");
const PY = existsSync(venv) ? venv : process.env.PY || "python3";   // packing needs the one of make deps
const doc = (attrs, body) => `<!DOCTYPE html>
<html lang="ja" theme="Boadilla"${attrs ? " " + attrs : ""}>
<head><meta charset="utf-8"><title>t</title><script src="engine/kamishibai.js"></script></head>
<body>
${body}
</body></html>
`;
const py = (tool, ...a) => {
  const r = spawnSync(PY, [join(ROOT, "tools", tool), ...a], { encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout + r.stderr };
};
// what is read on the pages, in the shown language (non-breaking spaces as spaces)
const read = (d, sel) => d.page.$$eval(".deck .stage " + sel, es => es.filter(e => e.getClientRects().length).map(e => e.innerText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()));
const all = (d, sel) => d.page.$$eval(".deck .stage " + sel, es => es.map(e => e.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()));
const titles = d => all(d, ":is(.bt, .pt)");
const same = (a, b, what) => eq(JSON.stringify(a), JSON.stringify(b), what);
// the numbers of the page are those of tools/numbering.py
async function agree(d) {
  const js = await d.page.evaluate(() => Kamishibai.numbers.map(e => [e.page + 1, e.ja, e.number || "-", e.name]));
  const out = py("numbering.py", d.path).out.split("\n").map(l => l.match(/^page +(\d+)  (\S+) (\S+)(?:  \((.*)\))?$/)).filter(Boolean)
    .map(m => [+m[1], m[2], m[3], m[4] || ""]);
  same(js, out, "engine and numbering.py");
}
const open = async (draft, attrs, body, o) => { const d = await draft({ text: doc(attrs, body), edit: false, ...o }); await d.page.evaluate(() => Kamishibai.ready); return d; };

const DECK = `
<slide title="始め" sec="一"><block title="定義（CONN）" name="def:conn"><p>連結。</p></block>
<p class="t">\\ref{thm:upper} は後の頁、\\ref{def:conn}（番号だけなら \\num{def:conn}）。$x$ と \\ref{lem:a}・\\num{thm:upper}。</p>
<later title="補題（後で証明）" name="lem:a"><p>主張。</p></later></slide>
<slide title="\\ref{thm:upper} の証明" sec="二"><alertblock title="定理（上界）" name="thm:upper" step><p>上界。</p></alertblock>
<proof title="\\ref{thm:upper} の証明" step><p step>\\ref{lem:a} による。</p></proof></slide>
<slide title="三"><block title="補題" same="lem:a"><p>主張。</p></block><block title="問題" number="none" name="q"><p>問い。</p></block>
<block title="補題 [文献]" number="8"><p>八。</p></block><exampleblock title="系"><p>九。</p></exampleblock>
<p class="u">\\ref{q}</p><p><code>\\ref{x}</code></p></slide>`;

test("a deck that does not ask for numbers is as it is written", async draft => {
  const d = await open(draft, "", DECK);
  same(await titles(d), ["定義（CONN）", "補題（後で証明）", "定理（上界）", "\\ref{thm:upper} の証明", "補題", "問題", "補題 [文献]", "系"], "titles");
  ok((await all(d, ".t"))[0].includes("\\ref{thm:upper} は"), "text");
  eq(await d.page.evaluate(() => Kamishibai.numbers.length), 0);
  ok(d.log.some(l => l.includes("numbering がありません")), "warned");
});

test("one series over the kinds, references to earlier and later pages, again, none, restart", async draft => {
  const d = await open(draft, 'numbering="deck"', DECK);
  same(await titles(d), ["定義 1（CONN）", "補題 2（後で証明）", "定理 3（上界）", "定理 3 の証明", "補題 2", "問題", "補題 8 [文献]", "系 9"], "titles");
  eq((await all(d, ".t"))[0].replace(/ x|x /, " x "), "定理 3 は後の頁、定義 1（番号だけなら 1）。 x と 補題 2・3。".replace("。 x", "。 x"));
  same(await all(d, ".ttl"), ["始め", "定理 3 の証明", "三"], "headings");
  same(await all(d, ".u"), ["問題"], "a statement with no number");
  eq((await all(d, "code"))[0], "\\ref{x}", "code is left alone");
  same(d.log, [], "no message");
  await agree(d);
});

test("a series for each kind, and kinds with no number", async draft => {
  const d = await open(draft, 'numbering="deck each" unnumbered="主定理 問題"', `<slide title="a"><block title="定理"><p>a</p></block>
<block title="定義"><p>a</p></block><block title="主定理（大域）" name="m"><p>a</p></block><block title="定理"><p>a</p></block>
<block title="問題" number="auto"><p>a</p></block><p class="t">\\ref{m}</p></slide>`);
  same(await titles(d), ["定理 1", "定義 1", "主定理（大域）", "定理 2", "問題 1"]);
  same(await all(d, ".t"), ["主定理"]);
  await agree(d);
});

test("numbers with the number of the section", async draft => {
  const b = (t, a) => `<block title="${t}" ${a || ""}><p>a</p></block>`;
  const d = await open(draft, 'numbering="section"', `<slide title="a" sec="はじめに" secno="none">${b("問題", 'number="none"')}</slide>
<slide title="b" sec="準備">${b("定義")}${b("定義")}</slide><slide title="c" sec="準備">${b("補題", 'name="l"')}</slide>
<slide title="d" sec="主結果" secno="4">${b("定理", 'name="t"')}</slide><slide title="e" sec="主結果（続き）" secno="4">${b("系")}</slide>
<slide title="f" sec="次">${b("定理")}</slide><divider>参考</divider><slide title="g" sec="付録" secno="A">${b("補題")}${b("補題", 'number="B.7"')}</slide>
<slide title="h" sec="付録二">${b("補題")}<p class="t">\\ref{l}、\\ref{t}</p></slide>`);
  same(await titles(d), ["問題", "定義 1.1", "定義 1.2", "補題 1.3", "定理 4.1", "系 4.2", "定理 5.1", "補題 A.1", "補題 B.7", "補題 B.1"]);
  same(await all(d, ".t"), ["補題 1.3、定理 4.1"]);
  await agree(d);
});

test("numbers written by hand stay and are not counted", async draft => {
  const d = await open(draft, 'numbering="deck"', `<slide title="a"><block title="定理 7（既知）" name="k"><p>a</p></block><block title="定理"><p>a</p></block>
<block title="補題２"><p>a</p></block><p class="t">\\ref{k}</p></slide>`);
  same(await titles(d), ["定理 7（既知）", "定理 1", "補題２"]);
  same(await all(d, ".t"), ["定理 7"]);
  await agree(d);
});

test("wrong names: a red ??, a message, and the check says so too", async draft => {
  const d = await open(draft, 'numbering="deck"', `<slide title="a"><block title="定理" name="t"><p>a</p></block><block title="補題" name="t"><p>a</p></block>
<block title="系" same="zz"><p>a</p></block><block title="問題" number="none" name="q"><p>a</p></block><p class="t">\\ref{no} と \\num{q}</p></slide>`);
  same(await titles(d), ["定理 1", "補題 2", "系 ??", "問題"]);
  same(await all(d, ".t"), ["?? と ??"]);
  eq(await d.page.$$eval(".deck .ref-bad", es => es.length), 2);
  for (const t of ["「t」が二度", "「zz」の主張がありません", "\\ref{no}", "\\num{q}"]) ok(d.log.some(l => l.includes("page 1") && l.includes(t)), t);
  const r = py("numbering.py", d.path);
  eq(r.code, 1);
  for (const t of ['"t" is given twice', 'same="zz"', "\\ref{no}", "\\num{q}"]) ok(r.out.includes(t), t + "\n" + r.out);
  await agree(d);
});

test("the same number twice, one of them given by the engine", async draft => {
  const d = await open(draft, 'numbering="deck" unnumbered="問題"', `<slide title="a"><block title="定理２"><p>手</p></block><block title="系"><p>a</p></block>
<block title="定理（自）" name="t"><p>a</p></block><block title="定理" same="t"><p>b</p></block><block title="問題 1"><p>a</p></block><block title="問題 1"><p>手で二度</p></block></slide>`);
  const said = t => d.log.filter(l => l.includes(t)).length;
  eq(said("「定理 2」が二つあります"), 1);
  eq(said("が二つあります"), 1);
  const r = py("numbering.py", d.path);
  eq(r.code, 1);
  eq(r.out.split("is there twice").length, 2, r.out);
  await agree(d);
});

const BI = `
<slide title="始め" title-en="Start" sec="一" sec-en="One"><block title="定義（CONN）" title-en="Definition (CONN)" name="d"><p><ja>連結。\\ref{t} で使う。</ja><en>Connected; used in \\ref{t}.</en></p></block>
<block title="主定理（日英）" title-en="Main theorem (both)" name="t"><p><ja>甲</ja><en>A</en></p></block>
<p class="neutral"><b>\\ref{d}</b>, \\ref{t}</p><p class="untranslated">\\ref{t} より</p>
<svg width="200" height="40"><text y="20" class="s">\\ref{t}</text><text y="35" lang="ja">\\ref{d}</text><text y="35" lang="en">see \\ref{d}</text></svg></slide>
<slide title="\\ref{t} の証明" title-en="Proof of \\ref{t}"><later lang="ja" title="補題（後で）" name="l"><p>あ</p></later><later lang="en" title="Lemma (later)"><p>a</p></later>
<block title="補題" same="l"><p><ja>い</ja><en>b</en></p></block><proof title="\\ref{l} の証明" title-en="Proof of \\ref{l}"><p><ja>\\ref{l}</ja><en>\\ref{l}</en></p></proof></slide>`;

test("Japanese and English: titles, text, neither, figures, and switching", async draft => {
  const d = await open(draft, 'numbering="deck"', BI);
  same(await read(d, ".page:nth-child(1) .bt"), ["定義 1（CONN）", "主定理 2（日英）"]);
  same(await read(d, ".neutral"), ["定義 1, 主定理 2"]);
  same(await read(d, ".untranslated"), ["主定理 2 より"]);
  const svg = () => d.page.$$eval(".deck svg text", ts => ts.filter(t => getComputedStyle(t).display !== "none").map(t => {
    const w = [].filter.call(t.childNodes, c => true).map(function f(c) { return c.nodeType === 3 ? c.nodeValue : getComputedStyle(c).display === "none" ? "" : [].map.call(c.childNodes, f).join(""); });
    return w.join("").replace(/\u00a0/g, " ");
  }));
  same(await svg(), ["主定理 2", "定義 1"]);
  await d.page.keyboard.press("l");
  same(await read(d, ".page:nth-child(1) .bt"), ["Definition 1 (CONN)", "Main theorem 2 (both)"]);
  same(await read(d, ".neutral"), ["Definition 1, Main theorem 2"]);
  same(await svg(), ["Main theorem 2", "see Definition 1"]);
  eq(await d.page.evaluate(() => Kamishibai.ref("d")), "Definition\u00a01");
  await d.page.keyboard.press("ArrowRight");
  same(await read(d, ".page:nth-child(2) .ttl"), ["Proof of Main theorem 2"]);
  same(await read(d, ".page:nth-child(2) :is(.bt, .pt)"), ["Lemma 3 (later)", "補題 3", "Proof of Lemma 3"]);
  same(await read(d, ".page:nth-child(2) .pf p"), ["Lemma 3"]);
  same(d.log, [], "no message");
  await agree(d);
  // the record of the translations is made from the source, so the numbers do not make it stale
  eq(py("lang_pairs.py", "stamp", d.path).code, 0);
  const t = d.text();
  writeFileSync(d.path, t.replace('<slide title="始め"', '<slide title="前"><block title="公理"><p>a</p></block></slide>\n<slide title="始め"'));
  await d.page.reload();
  await d.page.evaluate(() => Kamishibai.ready);
  eq(await d.page.$$eval(".en-stale", es => es.length), 0);
  eq((await titles(d))[1].slice(0, 4), "定義 2");
});

test("an English draft, with Japanese-free titles", async draft => {
  const d = await draft({ text: doc('numbering="deck"', `<slide title="a"><block title="Theorem (bound)" name="t"><p>a</p></block><p class="t">By \\ref{t}.</p></slide>`).replace('lang="ja"', 'lang="en"'), edit: false });
  await d.page.evaluate(() => Kamishibai.ready);
  same(await titles(d), ["Theorem 1 (bound)"]);
  same(await all(d, ".t"), ["By Theorem 1."]);
});

test("captions, footer, sections, steps, print and overview copies", async draft => {
  const d = await open(draft, 'numbering="deck"', `<cover><headline short="\\ref{t} について">題</headline><author short="著者">あ</author><date>今日</date></cover>
<slide title="a" sec="\\ref{t}"><block title="定理" name="t" step><p>a</p></block>
<switch for="f"><button>甲</button><button>乙</button></switch><flip id="f"><svg width="9" height="9"></svg><svg width="9" height="9"></svg></flip>
<figcaption for="f" caps="\\ref{t} の図|\\num{t} だけ"></figcaption></slide>`);
  same(await all(d, ".page:nth-child(1) .f2"), ["定理 1 について"]);
  same(await all(d, ".hn"), ["定理 1"]);
  await d.page.evaluate(() => { location.hash = "#s2"; });
  await d.page.waitForSelector(".page.on >> text=a");
  eq((await all(d, "figcaption"))[0], "甲：定理 1 の図");
  await d.page.click(".page.on switch button:nth-child(2)");
  eq((await all(d, "figcaption"))[0], "乙：1 だけ");
  ok(await d.page.$$eval("body .bt", es => es.every(e => e.textContent === "定理 1")), "every copy of the box");
  const pdf = await d.page.$$eval(".print .bt", es => es.length);
  ok(pdf >= 1, "the print copies");
});

test("the packed file shows the same", async draft => {
  const d = await open(draft, 'numbering="deck"', BI.replace(/<svg[^]*?<\/svg>/, "").replace("sec=\"一\"", "sec=\"一\""));
  const want = [await titles(d), await all(d, "p"), await all(d, ".ttl")];
  // pack a draft in the engine's neighbourhood: the engine's folder of the test is a link out of the draft's folder
  const r = py("pack_engine.py", d.path, "--allow", ROOT);
  eq(r.code, 0, r.out);
  ok(!r.out.includes("warning: page"), r.out);
  const p = await d.page.context().newPage();
  await p.goto(pathToFileURL(d.path.replace(/\.html$/, ".dist.html")).href);
  await p.evaluate(() => Kamishibai.ready);
  const got = await p.evaluate(() => [":is(.bt, .pt)", "p", ".ttl"].map(s => [].map.call(document.querySelectorAll(".deck .stage " + s), e => e.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())));
  same(got, want);
});

test("check_order reads the numbers the engine gives", async draft => {
  const d = await open(draft, 'numbering="section"', `<slide title="a" sec="一"><block title="補題" name="l"><p>a</p></block><block title="定理" name="t"><p>a</p></block></slide>
<slide title="\\ref{t} の証明"><proof><p>\\ref{l} と 定理 2.5 による。</p></proof></slide><slide title="b"><proof title="\\ref{l} の証明"><p>a</p></proof></slide>`);
  const out = py("check_order.py", d.path).out;
  ok(/定理 1\.2 +1 +- +2/.test(out), out);
  ok(/補題 1\.1 +1 +2 +3/.test(out), out);
  ok(out.includes("DEFERRED 補題 1.1"), out);
});

test("page-edit keeps the names: the text, titles, headings and section names", async draft => {
  const text = doc('numbering="deck"', DECK.replace('sec="二"', 'sec="\\ref{lem:a} のため"'));
  const d = await draft({ text });
  await d.enter();
  const swap = async (from, to, page, old, neu) => {
    await d.go(page);
    const t0 = d.text();
    await d.edit(old, neu);
    eq(d.text(), t0.replace(from, to), from);
  };
  await swap("（番号だけなら \\num{def:conn}）", "（番号は \\num{def:conn}）", 1, "（番号だけなら", "（番号は");
  await swap('title="定義（CONN）"', 'title="定義（連結）"', 1, "（CONN）", "（連結）");
  await swap('title="\\ref{thm:upper} の証明" sec', 'title="\\ref{thm:upper} を示す" sec', 2, " の証明", " を示す");
  await swap("\\ref{lem:a} による。", "\\ref{lem:a} から従う。", 2, "による", "から従う");
  await swap('<proof title="\\ref{thm:upper} の証明"', '<proof title="\\ref{thm:upper} の残り"', 2, " の証明", " の残り");
  await swap('sec="\\ref{lem:a} のため"', 'sec="\\ref{lem:a} の準備"', 2, "のため", "の準備");
  // a new reference written while editing is set at once
  await swap("<p>上界。</p>", "<p>上界。\\ref{def:conn} による。</p>", 2, "上界。", "上界。\\ref{def:conn} による。");
  const end = d.text();
  await d.leave();
  same(await all(d, ".page.on :is(.ttl, .bt, .pt, .bb p)"), ["定理 3 を示す", "定理 3（上界）", "上界。定義 1 による。", "定理 3 の残り"], "set again");
  same((await all(d, ".page.on .hn")).slice(1, 2), ["補題 2 の準備"]);
  eq((await titles(d))[0], "定義 1（連結）");
  await d.enter();
  for (let i = 0; i < 7; i++) await d.undo();
  eq(d.text(), text, "all undone");
  for (let i = 0; i < 7; i++) await d.redo();
  eq(d.text(), end, "all redone");
});

test("page-edit: a statement put in above moves the numbers after it", async draft => {
  const d = await draft({ text: doc('numbering="deck"', DECK) });
  await d.enter();
  await d.go(1);
  d.outside(d.text().replace("<block title", '<block title="公理"><p>先</p></block><block title'));
  await d.edit("主張。", "主張！");
  await d.leave();
  eq((await titles(d)).slice(0, 4).join(), "公理 1,定義 2（CONN）,補題 3（後で証明）,定理 4（上界）");
});

run(process.argv[2]);
