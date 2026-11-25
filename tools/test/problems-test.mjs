// The list of what the draft has wrong (engine/kamishibai.js, page-edit/edit.js).   node tools/test/problems-test.mjs [part of a test's name]
import { test, run, eq, ok, KEY, ROOT } from "./harness.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const head = a => '<!DOCTYPE html>\n<html lang="ja" theme="Boadilla"' + (a || "") + '>\n<head><meta charset="utf-8"><title>t</title>\n<script src="engine/kamishibai.js"></script></head>\n<body>\n';
const TAIL = "</body></html>\n";
const CLEAN = head() + `<cover><headline>題目</headline><author>著者</author></cover>
<slide title="一"><p>文 \\(x^2\\) と $y$ の項</p><p>値段は ￥5 です</p><block title="定義 1（集合）">本文 \\[a+b\\]</block></slide>
` + TAIL;
const BAD = head(' numbering="deck"') + `<cover><headline>題目</headline><author>著者</author></cover>
<slide title="数式"><p>始め</p><p>式 \\(\\frac{1}\\) の文</p><p>式 \\(\\nosuch+1\\) の文</p><p>式 \\(x + 1 の文</p></slide>
<slide title="参照"><block title="定理" id="a">本文</block><p>\\ref{nai} による</p><block title="主張でない題">本文</block></slide>
<slide title="画像"><img src="nai.png" style="width:300px"><p>画像の文</p></slide>
<slide title="収まり">${Array.from({ length: 40 }, (_, k) => "<p>" + (k + 1) + " 行目の文</p>").join("")}</slide>
<slide title="おわり"><p>終わりの文</p></slide>
` + TAIL;
const BI = head() + `<cover><headline>題目</headline><author>著者</author></cover>
<slide title="導入" title-en="Introduction"><p><ja>日本語の文</ja><en>English \\(\\frac{1\\) text</en></p></slide>
<slide title="長い" title-en="Long"><p><ja>短い</ja><en>${"<b>x</b><br>".repeat(45)}</en></p></slide>
<slide title="終" title-en="End"><p><ja>終わり</ja><en>the end</en></p></slide>
` + TAIL;

const all = d => d.page.evaluate(async () => { await Kamishibai.ready; return Kamishibai.problems().map(p => [p.page == null ? 0 : p.page + 1, p.lang, p.type, p.text]); });
const settle = async (d, n) => { await d.page.waitForFunction(k => Kamishibai.problems().length >= k, n); await d.page.evaluate(() => Kamishibai.ready); };
const shown = (d, sel) => d.page.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"; }, sel);
const BTN = ".tools button.wrong", LIST = ".wrongs";
const rows = d => d.page.locator(LIST + " .wl button");
const marked = d => d.page.evaluate(() => { const e = document.querySelector(".wrong-here"); return e ? e.tagName.toLowerCase() + " " + e.textContent.trim().slice(0, 20) : ""; });

test("a draft with nothing wrong has no list and no sign", async draft => {
  const d = await draft({ text: CLEAN });
  eq((await all(d)).length, 0, JSON.stringify(await all(d)));
  await d.enter();
  ok(!await shown(d, BTN), "sign"); ok(!await shown(d, LIST), "list");
});

test("each kind of mistake is found once, with its page", async draft => {
  const d = await draft({ text: BAD, edit: false });
  await settle(d, 6);
  const got = await all(d), has = (k, t) => ok(got.some(p => p[2] === k && p[3].includes(t)), k + " " + t + "\n" + JSON.stringify(got, null, 1));
  has("math", "組めない数式「\\frac{1}」"); has("math", "知らない命令「\\nosuch」"); has("math", "\\nosuch"); has("math", "\\(");
  has("ref", "nai"); has("block", "主張でない題"); has("image", "nai.png"); has("fit", "85%");
  eq(got.filter(p => p[2] === "math").length, 3, JSON.stringify(got));
  eq(got.filter(p => p[2] === "math").every(p => p[0] === 2), true, "pages of the math");
  eq(got.find(p => p[2] === "ref")[0], 3); eq(got.find(p => p[2] === "image")[0], 4); eq(got.find(p => p[2] === "fit")[0], 5);
  eq(got.map(p => p[0]).join(), got.map(p => p[0]).sort().join(), "in the order of the pages");
});

test("with page-edit: the sign with the count, the list, a choice turns to the place", async draft => {
  const d = await draft({ text: BAD });
  await settle(d, 7);
  await d.enter(); await d.built(1); await settle(d, 7);
  const n = (await all(d)).length;
  await d.page.waitForSelector(BTN, { state: "visible" }); ok(!await shown(d, LIST), "closed at first");
  eq(await d.page.locator(BTN + " .n").textContent(), String(n));
  await d.page.click(BTN);
  ok(await shown(d, LIST), "list"); eq(await rows(d).count(), n);
  await rows(d).filter({ hasText: "\\nosuch" }).click();
  eq(await d.on(), 2); eq(await marked(d), "span \\nosuch");
  await rows(d).filter({ hasText: "nai" }).filter({ hasText: "参照" }).click();
  eq(await d.on(), 3); ok((await marked(d)).startsWith("span ??"), await marked(d));
  await rows(d).filter({ hasText: "主張でない題" }).click();
  eq(await marked(d), "block 主張でない題本文");
  await rows(d).filter({ hasText: "nai.png" }).click();
  eq(await d.on(), 4); ok((await marked(d)).startsWith("img"), await marked(d));
  await rows(d).filter({ hasText: "収まり" }).click();
  eq(await d.on(), 5); ok((await marked(d)).startsWith("section"), await marked(d));
  await d.page.click(LIST + " .wh button");
  ok(!await shown(d, LIST), "closed");
});

test("a click in the list does not turn the page, and the list does not hide the place", async draft => {
  const d = await draft({ text: head(' numbering="deck"') + '<cover><headline>題目</headline></cover><slide title="下"><p>上の文</p><div style="position:absolute;left:55%;right:20px;bottom:30px"><p>\\ref{nai} 右下の文</p></div></slide><slide title="次"><p>文</p></slide>' + TAIL });
  await d.enter(); await d.built(1); await settle(d, 1);
  await d.page.click(BTN);
  await rows(d).first().click();
  eq(await d.on(), 2);
  const over = await d.page.evaluate(() => {
    const a = document.querySelector(".wrong-here").getBoundingClientRect(), b = document.querySelector(".wrongs").getBoundingClientRect();
    return a.right > b.left && a.bottom > b.top && a.left < b.right && a.top < b.bottom;
  });
  ok(!over, "the list lies over the place");
  await d.page.click(LIST + " .wh span");
  eq(await d.on(), 2);
});

test("a mistake of one language: its side, and the choice shows that language", async draft => {
  const d = await draft({ text: BI });
  await d.enter(); await d.built(1); await settle(d, 2);
  const got = await all(d);
  eq(got.map(p => p[0] + p[1] + p[2]).join(" "), "2enmath 3enfit", JSON.stringify(got));
  await d.page.click(BTN);
  eq(await d.page.evaluate(() => Kamishibai.lang()), "ja");
  await rows(d).first().click();
  eq(await d.page.evaluate(() => Kamishibai.lang()), "en"); eq(await d.on(), 2);
  ok((await marked(d)).includes("English"), await marked(d));
});

test("a save brings the list up to date, which stays open over it and a reload", async draft => {
  const d = await draft({ text: BAD });
  await d.enter(); await d.built(1); await settle(d, 7);
  const n = (await all(d)).length;
  await d.page.click(BTN);
  await rows(d).filter({ hasText: "\\nosuch" }).click();
  await d.edit("\\nosuch+1", "\\alpha+1");
  await settle(d, 6);
  await d.page.waitForTimeout(300);
  eq((await all(d)).length, n - 1, "one less");
  ok(await shown(d, LIST), "open after the save"); eq(await d.on(), 2);
  eq(await d.page.locator(BTN + " .n").textContent(), String(n - 1));
  await d.edit("始め", "始め \\(\\badname\\)");
  await settle(d, n);
  ok((await all(d)).some(p => p[3].includes("\\badname")), "a new mistake");
  await d.undo(); await d.page.waitForTimeout(300);
  ok(!(await all(d)).some(p => p[3].includes("\\badname")), "undo takes it back");
  await d.reload();
  await d.enter(); await settle(d, 6);
  ok(await shown(d, LIST), "open after a reload");
});

test("the last mistake put right: the list and the sign go away", async draft => {
  const d = await draft({ text: head() + '<cover><headline>題目</headline></cover><slide title="一"><p>式 \\(\\nosuch\\)</p></slide>' + TAIL });
  await d.enter(); await d.built(1); await settle(d, 1);
  await d.page.click(BTN); await rows(d).first().click();
  await d.edit("\\nosuch", "\\alpha");
  await d.page.waitForTimeout(300);
  eq((await all(d)).length, 0); ok(!await shown(d, BTN), "sign"); ok(!await shown(d, LIST), "list");
});

test("a choice while a text is open saves it and then shows the place", async draft => {
  const d = await draft({ text: BAD });
  await d.enter(); await d.built(1); await settle(d, 7);
  await d.page.click(BTN);
  await d.go(6);
  await d.start("終わりの文");
  await d.type("直した終わりの文");
  await d.rebuilt(() => rows(d).filter({ hasText: "\\nosuch" }).click());
  ok(d.text().includes("直した終わりの文"), "saved");
  eq(await d.on(), 2);
});

test("why nothing, or not all, can be edited", async draft => {
  const d = await draft({ text: head() + '<cover><headline>題目</headline></cover>\n<slide title="一"><p>文</p></slide>\n<slide title="二">\n<table><tr><td>欄</td><p>表の外へ出る文</p></tr></table>\n<p>後</p></slide>' + TAIL });
  await d.page.keyboard.press(KEY + "+e");
  await settle(d, 1);
  const got = await all(d);
  eq(got.length, 1, JSON.stringify(got)); eq(got[0][2], "edit"); eq(got[0][0], 3, JSON.stringify(got));
  ok(/原稿の 9 行目/.test(got[0][3]), got[0][3]);
  await d.page.waitForFunction(() => document.body.classList.contains("mode-edit"));
  await d.page.waitForSelector(BTN, { state: "visible" });
  ok((await d.msg()).includes("誤りの一覧"), await d.msg());
});

test("not in プレゼン, not in 出力, not on paper", async draft => {
  const d = await draft({ text: BAD });
  await d.enter(); await d.built(1); await settle(d, 7);
  await d.page.click(BTN);
  await d.leave();
  ok(!await shown(d, BTN) && !await shown(d, LIST), "show");
  await d.page.evaluate(() => Kamishibai.mode("out"));
  ok(!await shown(d, BTN) && !await shown(d, LIST), "out");
  await d.page.evaluate(() => Kamishibai.mode("edit"));
  await d.page.waitForFunction(() => document.body.classList.contains("sed-on"));
  ok(await shown(d, LIST), "edit");
  await d.page.emulateMedia({ media: "print" });
  ok(!await shown(d, BTN) && !await shown(d, LIST), "print");
});

test("without page-edit: ⌘E shows the list when there is something wrong, else what it did before", async draft => {
  const d = await draft({ text: BAD, edit: false });
  await settle(d, 7);
  await d.key("Mod+e");
  eq(await d.page.evaluate(() => Kamishibai.mode()), "edit");
  ok(await shown(d, LIST), "list"); await d.page.waitForSelector(BTN, { state: "visible" });
  await rows(d).filter({ hasText: "\\frac" }).click();
  eq(await d.on(), 2); ok((await marked(d)).startsWith("span"), await marked(d));
  await d.page.mouse.click(400, 300);
  eq(await d.on(), 2, "a click turns no page");
  await d.key("Mod+e");
  eq(await d.page.evaluate(() => Kamishibai.mode()), "show"); ok(!await shown(d, LIST), "gone");
  const c = await draft({ text: CLEAN, edit: false });
  await c.key("Mod+e");
  eq(await c.page.evaluate(() => Kamishibai.mode()), "show");
  ok(await c.page.evaluate(() => document.querySelector(".tools button.off") !== null), "gray");
});

test("page-edit coming while the list alone is shown starts as always", async draft => {
  const d = await draft({ text: BAD, edit: false });
  await settle(d, 7);
  await d.key("Mod+e");
  await d.inject();
  eq(await d.page.evaluate(() => Kamishibai.mode()), "show");
  await d.enter(); await d.built(1);
  ok(await d.page.evaluate(() => document.body.classList.contains("sed-on")), "editing");
});

test("a list given from outside replaces what its source gave before", async draft => {
  const d = await draft({ text: CLEAN, edit: false });
  const n = l => d.page.evaluate(x => { Kamishibai.setProblems("t", x); return Kamishibai.problems().length; }, l);
  eq(await n([{ type: "edit", page: 1, text: "一" }, { page: null, text: "二" }]), 2);
  eq((await all(d))[0][3], "二", "what is of no page comes first");
  eq(await n([{ type: "edit", page: 1, text: "三" }]), 1);
  eq(await n([]), 0);
});

test("a packed file says nothing of it", async draft => {
  const d = await draft({ text: BAD.replace(/<img[^>]*>|<block title="主張でない題">.*?<\/block>/g, ""), edit: false });
  const py = [join(ROOT, ".venv", "bin", "python")].find(existsSync) || "python3";
  execFileSync(py, [join(ROOT, "tools", "pack_engine.py"), d.path, "-o", join(d.dir, "packed.html"), "--allow", ROOT], { stdio: "pipe" });
  await d.page.goto(pathToFileURL(join(d.dir, "packed.html")).href); await d.ready();
  await d.page.waitForTimeout(300);
  eq((await all(d)).length, 0);
  await d.key("Mod+e");
  ok(!await shown(d, BTN) && !await shown(d, LIST));
});

test("a figure switch whose id holds a quote works, and a qr with no src is listed", async draft => {
  const d = await draft({ edit: false, text: head() + `<cover><headline>題目</headline><author>著者</author><qr>読む</qr></cover>
<slide title="図"><flip id='a"b'><svg width="10" height="10"></svg><svg width="10" height="10"></svg></flip><switch for='a"b'><button>一</button><button>二</button></switch><p>文</p></slide>
` + TAIL });
  eq(JSON.stringify(await all(d)), JSON.stringify([[1, null, "image", "qr に src（画像のファイル）がありません"]]));
  await d.page.evaluate(() => Kamishibai.go(1));
  await d.page.click(".stage .page.on [data-flip] button:nth-child(2)");
  eq(await d.page.evaluate(() => [...document.querySelectorAll(".stage .page.on .flip > svg")].map(g => g.classList.contains("cur")).join()), "false,true");
  eq(d.log.filter(m => m.startsWith("pageerror")).length, 0, d.log.join(" | "));
});

test("a button of a slide that holds the focus takes Space itself", async draft => {
  const d = await draft({ edit: false, text: head() + `<slide title="一"><p>文</p><button id="bt" onclick="window.hit = (window.hit || 0) + 1">押す</button></slide>
<slide title="二"><p>文</p></slide>
` + TAIL });
  await d.page.focus("#bt");
  await d.page.keyboard.press("Space");
  eq(await d.page.evaluate(() => (window.hit || 0) + "," + Kamishibai.current()), "1,0");
  await d.page.evaluate(() => document.activeElement.blur());
  await d.page.keyboard.press("Space");
  eq(await d.page.evaluate(() => Kamishibai.current()), 1);
});

const ONE = '<slide title="一"><p>文</p><input id="f"></slide>\n<slide title="二"><p>文</p></slide>\n' + TAIL;
const themeNow = async d => {
  await d.page.waitForFunction(() => window.Kamishibai && Kamishibai.theme === "Boadilla" && Kamishibai.ready);
  return d.page.evaluate(async () => { await Kamishibai.ready; return Kamishibai.problems().filter(p => p.type === "theme").map(p => p.text).join("|") + " " + getComputedStyle(document.documentElement).getPropertyValue("--W").trim(); });
};

test("a theme with no file in ?theme= opens with the theme of the draft and is listed", async draft => {
  const d = await draft({ edit: false, text: head() + ONE, query: "?theme=Nope" }).catch(() => null);
  if (d) eq(await themeNow(d), "テーマ「Nope」が themes/ にありません（Boadilla で表示しています） 1280px");
  else ok(false, "the draft did not open");
});

test("a theme with no file in <html theme> opens with Boadilla and stays listed", async draft => {
  const d = await draft({ edit: false, text: head().replace('theme="Boadilla"', 'theme="Nope"') + ONE });
  eq(await themeNow(d), "テーマ「Nope」が themes/ にありません（Boadilla で表示しています） 1280px");
  await d.page.reload();
  eq(await themeNow(d), "テーマ「Nope」が themes/ にありません（Boadilla で表示しています） 1280px");
});

test("in a field of a slide the keys of the modes stay the field's", async draft => {
  const d = await draft({ edit: false, text: head() + ONE });
  await d.page.focus("#f");
  await d.page.keyboard.press(KEY + "+p");
  eq(await d.page.evaluate(() => document.body.classList.contains("mode-out")), false);
  await d.page.evaluate(() => document.activeElement.blur());
  await d.page.keyboard.press(KEY + "+p");
  eq(await d.page.evaluate(() => document.body.classList.contains("mode-out")), true);
});

test("the stroke of Japanese text stops at 1pt", async draft => {
  const d = await draft({ edit: false, text: head() + ONE });
  await d.page.evaluate(() => localStorage.setItem("kamishibai-ja-stroke", "7"));
  await d.page.reload();
  await d.page.waitForFunction(() => window.Kamishibai && Kamishibai.ready);
  eq(await d.page.evaluate(() => document.documentElement.style.getPropertyValue("--ja-stroke")), "1pt");
});

await run(process.argv[2]);
