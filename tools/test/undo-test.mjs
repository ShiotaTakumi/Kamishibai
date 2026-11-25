// Undo and redo of page-edit (page-edit/edit.js).   node tools/test/undo-test.mjs [part of a test's name]
import { test, run, eq, ok } from "./harness.mjs";

const HEAD = '<!DOCTYPE html>\n<html lang="ja" theme="Boadilla">\n<head><meta charset="utf-8"><title>t</title>\n<script src="engine/kamishibai.js"></script></head>\n<body>\n';
const PLAIN = HEAD + `<cover><headline>題目</headline><author aff="大学A">著者1</author><author aff="大学A">著者2</author><author aff='研究所B'>著者3</author><date>2026 年</date></cover>
<slide title="導入 &amp; 動機" sec="はじめに">
  <list><item>一つ目の項目</item><item>二つ目 $x^2$ の項目</item></list>
</slide>
<slide title="定義" sec="はじめに">
  <block title="定義 1（集合）">本文の一文目。</block>
  <p>段落の文</p>
</slide>
<!-- <slide title="書かない頁"> -->
<slide title="まとめ" sec=終わり>
  <p>段落の文</p>
  <p>最後の文</p>
</slide>
</body></html>
`;
const BI = HEAD + `<cover><headline>題目</headline><author>著者</author></cover>
<slide title="導入" title-en="Introduction" sec="序" sec-en="Intro">
  <p><ja>日本語の文</ja><en>English text</en></p>
</slide>
<slide title="次" title-en="Next" sec="序" sec-en="Intro"><p>共通 $x$</p></slide>
</body></html>
`;
const opened = async (draft, text, page) => { const d = await draft({ text }); await d.enter(); if (page) await d.go(page); return d; };
const same = (d, t, what) => ok(d.bytes().equals(Buffer.from(t)), (what || "file") + " differs:\n" + d.text());

test("a save, undo and redo give back the same bytes", async draft => {
  const d = await opened(draft, PLAIN, 2);
  eq(await d.lit(), "- -");
  await d.edit("一つ目の項目", "直した項目");
  const saved = d.text();
  ok(saved.includes("<item>直した項目</item>"));
  eq(await d.lit(), "undo -");
  await d.undo();
  same(d, PLAIN);
  eq(await d.lit(), "- redo");
  ok((await d.msg()).startsWith("取り消しました"), await d.msg());
  await d.redo();
  same(d, saved);
  ok((await d.msg()).startsWith("やり直しました"), await d.msg());
  eq(await d.lit(), "undo -");
});

test("several steps go back and forth in order", async draft => {
  const d = await opened(draft, PLAIN, 2), texts = [PLAIN];
  await d.edit("導入", "始まり"); texts.push(d.text());
  await d.edit("二つ目", "2番目"); texts.push(d.text());
  await d.go(4);
  await d.edit("最後の文", "終わりの文\\(y\\)"); texts.push(d.text());
  for (let k = 2; k >= 0; k--) { await d.undo(); same(d, texts[k]); }
  for (let k = 1; k <= 3; k++) { await d.redo(); same(d, texts[k]); }
  await d.undo(); await d.undo();
  await d.go(3);
  await d.edit("本文の一文目", "新しい本文");
  eq(await d.lit(), "undo -", "a new save drops the steps to redo");
});

test("a section or institute renamed in several places is one step", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("はじめに", '序論 "A"', ".page.on .hn");
  eq((d.text().match(/sec="序論 &quot;A&quot;"/g) || []).length, 2);
  await d.undo(); same(d, PLAIN);
  await d.redo();
  eq((d.text().match(/sec="序論 &quot;A&quot;"/g) || []).length, 2);
  await d.undo(); same(d, PLAIN);
  await d.go(1);
  await d.edit("大学A", "大学X", ".page.on .insts [data-sedt]");
  eq((d.text().match(/aff="大学X"/g) || []).length, 2);
  await d.undo(); same(d, PLAIN);
  await d.go(4);
  await d.edit("終わり", "結び", ".page.on .hn");
  ok(d.text().includes('sec="結び"'), "unquoted value");
  await d.undo(); same(d, PLAIN);
});

test("undo goes to the page of the text and marks it", async draft => {
  const d = await opened(draft, PLAIN, 4);
  await d.edit("最後の文", "別の文");
  await d.go(1);
  await d.undo();
  eq(await d.page.evaluate(() => location.hash), "#s4");
  ok(await d.page.evaluate(() => document.querySelectorAll(".deck section.page")[3].classList.contains("on")));
  eq(await d.page.evaluate(() => [].map.call(document.querySelectorAll(".sed-flash"), e => e.textContent).join("|")), "最後の文");
  await d.go(2);
  await d.redo();
  eq(await d.page.evaluate(() => location.hash), "#s4");
});

test("the buttons do the same as the keys", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  const saved = d.text();
  await d.rebuilt(() => d.page.click(".tools .sed-undo")); same(d, PLAIN);
  await d.rebuilt(() => d.page.click(".tools .sed-redo")); same(d, saved);
  eq(await d.page.evaluate(() => location.hash), "#s2", "a click on a button does not turn the page");
});

test("a BOM and CRLF line ends are kept", async draft => {
  const bytes = Buffer.from("﻿" + PLAIN.replace(/\n/g, "\r\n"));
  const d = await draft({ bytes });
  await d.enter(); await d.go(2);
  eq(await d.page.evaluate(() => document.compatMode), "CSS1Compat");
  await d.edit("一つ目の項目", "直した項目");
  ok(d.bytes().equals(Buffer.from("﻿" + PLAIN.replace(/\n/g, "\r\n").replace("一つ目の項目", "直した項目"))), "saved bytes");
  await d.undo();
  ok(d.bytes().equals(bytes), "undone bytes");
});

test("a file that is not UTF-8 is not written", async draft => {
  const bytes = Buffer.concat([Buffer.from(PLAIN), Buffer.from([0x3c, 0x21, 0x2d, 0x2d, 0xff, 0xfe, 0x2d, 0x2d, 0x3e])]);
  const d = await draft({ bytes });
  await d.enter(); await d.go(2);
  await d.start("一つ目の項目"); await d.type("x"); await d.key("Enter");
  await d.page.waitForFunction(() => /UTF-8/.test(document.querySelector(".sed-msg").textContent));
  ok(d.bytes().equals(bytes));
});

test("while a text is edited, the keys undo the typing", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  const saved = d.text();
  await d.start("二つ目");
  const was = await d.page.evaluate(() => document.querySelector(".sed-editing").textContent);
  await d.key("End"); await d.page.keyboard.type("abc");
  eq(await d.page.evaluate(() => document.querySelector(".sed-editing").textContent), was + "abc");
  await d.key("Mod+z");
  const back = await d.page.evaluate(() => document.querySelector(".sed-editing").textContent);
  ok(back.length < (was + "abc").length, back);
  await d.page.click(".tools .sed-redo");
  eq(await d.page.evaluate(() => document.querySelector(".sed-editing").textContent), was + "abc", "the button too");
  await d.page.click(".tools .sed-undo");
  await d.key("Mod+z"); await d.key("Mod+z");
  eq(await d.page.evaluate(() => document.querySelector(".sed-editing").textContent), was);
  same(d, saved, "nothing is written while typing");
  await d.key("Escape");
  await d.undo();
  same(d, PLAIN);
});

test("a change elsewhere in the file is kept", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  await d.rebuilt(() => d.outside(d.text().replace("最後の文", "外で長く直した最後の文").replace("題目", "外の題目")));
  await d.undo();
  same(d, PLAIN.replace("最後の文", "外で長く直した最後の文").replace("題目", "外の題目"));
  await d.rebuilt(() => d.outside(d.text().replace("外の題目", "題")));
  await d.redo();
  same(d, PLAIN.replace("最後の文", "外で長く直した最後の文").replace("題目", "題").replace("一つ目の項目", "直した項目"));
});

test("a change not yet read by the page is kept", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  await d.page.evaluate(() => clearInterval(__slideEdit.poll));
  d.outside(d.text().replace("最後の文", "外の文"));
  await d.undo();
  same(d, PLAIN.replace("最後の文", "外の文"));
});

for (const [name, change] of [["the same text", t => t.replace("直した項目", "外で直した項目")],
                              ["right beside it", t => t.replace("<item>直した項目", "<item>直した項目と外の追記")],
                              ["removed", t => t.replace("<item>直した項目</item>", "")]])
  test("changed outside (" + name + "): nothing is written, with the reason", async draft => {
    const d = await opened(draft, PLAIN, 2);
    await d.edit("一つ目の項目", "直した項目");
    const t = change(d.text());
    await d.page.evaluate(() => clearInterval(__slideEdit.poll));
    d.outside(t);
    await d.rebuilt(() => d.key("Mod+z"));
    same(d, t);
    const m = await d.msg();
    ok(/取り消しできませんでした.*外での変更.*何も書いていません/.test(m), m);
    eq(await d.lit(), "undo -");
    await d.key("Mod+z");
    await d.page.waitForTimeout(300);
    same(d, t, "still nothing");
  });

test("changed outside so that the place is not unique: nothing is written", async draft => {
  const d = await opened(draft, PLAIN, 4);
  await d.edit("最後の文", "別の文");
  const s = d.text(), slide = s.slice(s.lastIndexOf("<slide"), s.indexOf("</body>"));
  const t = s.replace("</body>", slide + slide + "</body>");
  await d.page.evaluate(() => clearInterval(__slideEdit.poll));
  d.outside(t);
  await d.rebuilt(() => d.key("Mod+z"));
  same(d, t);
});

test("one of several places changed outside: none is written", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("はじめに", "序論", ".page.on .hn");
  const t = d.text().replace('title="定義" sec="序論"', 'title="定義" sec="第一部"');
  await d.rebuilt(() => d.outside(t));
  await d.key("Mod+z");
  await d.page.waitForFunction(() => /できませんでした/.test(document.querySelector(".sed-msg").textContent));
  same(d, t);
});

test("a change between reading and writing is not overwritten", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  const t = d.text().replace("最後の文", "間に入った文");
  await d.page.evaluate(() => clearInterval(__slideEdit.poll));
  d.hook = () => { d.hook = null; d.outside(t); };
  await d.rebuilt(() => d.key("Mod+z"));
  same(d, t);
  ok(/できませんでした/.test(await d.msg()), await d.msg());
  await d.undo();   // and now it can
  same(d, PLAIN.replace("最後の文", "間に入った文"));
});

test("the steps survive a reload of the tab", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  await d.edit("二つ目", "2番目");
  await d.undo();
  const t = d.text();
  await d.reload();
  await d.enter();
  eq(await d.lit(), "undo redo");
  await d.undo(); same(d, PLAIN);
  await d.redo(); same(d, t);
});

test("at most 100 steps are kept", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  await d.page.evaluate(() => { const u = __slideEdit.hist.undo; while (u.length < 130) u.unshift(u[0]); });
  await d.edit("二つ目", "2番目");
  eq(await d.page.evaluate(() => __slideEdit.hist.undo.length), 100);
  await d.page.evaluate(() => { const u = __slideEdit.hist.undo; u.forEach(g => { g.pad = "x".repeat(50000); }); });
  await d.edit("2番目", "二番目");
  ok(await d.page.evaluate(() => JSON.stringify(__slideEdit.hist).length) <= 1000000, "size");
  await d.undo(); await d.undo();
  same(d, PLAIN.replace("一つ目の項目", "直した項目"));
});

test("outside edit mode the keys are left alone", async draft => {
  const d = await opened(draft, PLAIN, 2);
  await d.edit("一つ目の項目", "直した項目");
  const t = d.text();
  await d.leave();
  await d.page.evaluate(() => { window.__got = 0; document.addEventListener("keydown", e => { if (e.key.toLowerCase() === "z" && !e.defaultPrevented) window.__got++; }); });
  await d.key("Mod+z"); await d.key("Mod+Shift+z");
  eq(await d.page.evaluate(() => window.__got), 2);
  await d.page.waitForTimeout(300);
  same(d, t);
});

test("in a field of the page the keys are the field's", async draft => {
  const d = await opened(draft, BI, 3);
  await d.edit("次", "つぎ");
  const t = d.text();
  await d.page.evaluate(() => { const i = document.createElement("input"); document.querySelector(".page.on").appendChild(i); i.focus(); });
  await d.page.keyboard.type("xyz");
  await d.key("Mod+z");
  eq(await d.page.evaluate(() => document.activeElement.value === "xyz"), false, "undone in the field");
  await d.page.waitForTimeout(300);
  same(d, t);
});

test("one language: undo brings the language back and leaves the other", async draft => {
  const d = await opened(draft, BI, 2);
  await d.page.click(".tools .sed-lang >> nth=1");
  await d.edit("English text", "Better text");
  await d.edit("Introduction", "Opening");
  const t = d.text();
  ok(t.includes("<ja>日本語の文</ja><en>Better text</en>") && t.includes('title="導入" title-en="Opening"'), t);
  await d.page.click(".tools .sed-lang >> nth=0");
  await d.go(3);
  await d.undo();
  eq(await d.page.evaluate(() => Kamishibai.lang()), "en");
  eq(await d.page.evaluate(() => location.hash), "#s2");
  await d.undo();
  same(d, BI);
  await d.redo(); await d.redo();
  same(d, t);
});

test("both languages at once, with a section in both", async draft => {
  const d = await opened(draft, BI, 2);
  await d.page.click(".tools .sed-lang >> nth=2");
  await d.edit("日本語の文", "直した文");
  await d.edit("Intro", "Start", ".page.on .hn .sed-part");
  eq((d.text().match(/sec-en="Start"/g) || []).length, 2);
  await d.undo(); await d.undo();
  same(d, BI);
  await d.page.click(".tools .sed-lang >> nth=0");
});

run(process.argv[2]);
