// Editing a text by its look in page-edit (page-edit/edit.js): what is shown, where the caret goes, marks, line
// breaks, and the source that comes out: node tools/test/edit-test.mjs [part of a name]
import { test, run, eq, ok, KEY, ROOT } from "./harness.mjs";
import { mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const doc = (attrs, body) => `<!DOCTYPE html>
<html lang="ja" theme="Boadilla"${attrs}>
<head><meta charset="utf-8"><title>t</title><script src="engine/kamishibai.js"></script></head>
<body>
${body}
</body></html>
`;
const TEXT = doc("", `<slide title="木幅 $tw$ の話" sec="一">
<p>集合 $V$ の辺を<alert>赤い辺</alert>と呼び、<br>
  $k\\le n$ とする。</p>
<itemize><item>次の項目</item><item>二つ目の話</item></itemize></slide>`);
const NUM = doc(' numbering="deck"', `<slide title="始め" sec="一"><block title="定義（連結）" name="def"><p>連結とする。</p></block>
<p class="t">本文では \\ref{def}と\\num{def}から従う。</p></slide>
<slide title="\\ref{def} の証明" sec="二"><p>$x$ と \\ref{def}の話。</p></slide>`);
const BOTH = doc(' numbering="deck"', `<slide title="始め" title-en="Start" sec="一" sec-en="One"><block title="定義（連結）" title-en="Definition (connected)" name="def"><p><ja>連結。</ja><en>Connected.</en></p></block>
<p class="t"><ja>次は \\ref{def} から。</ja><en>Next by \\ref{def}.</en></p></slide>`);

// click on the left edge of the character at str + off of the text as it is typeset
async function clickAt(d, str, off = 0) {
  const at = () => d.page.evaluate(([s, k]) => {
    const w = document.createTreeWalker(document.querySelector(".deck .page.on"), NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const x = w.currentNode, i = x.data.replace(/\u00a0/g, " ").indexOf(s);
      if (i < 0 || !x.parentElement.closest("[data-sed], [data-sedt]") || x.parentElement.closest(".katex")) continue;
      const r = document.createRange();
      r.setStart(x, i + k); r.setEnd(x, i + k + 1);
      const b = r.getBoundingClientRect();
      if (b.width) return [b.left + 1, b.top + b.height / 2];
    }
    return null;
  }, [str, off]);
  for (let n = 0; n < 4; n++) {
    const p = await at();
    if (!p) throw new Error("not on the page: " + str);
    await d.page.mouse.click(...p);
    if (await d.page.waitForSelector(".sed-editing", { timeout: 1500 }).then(() => true, () => false)) return;
  }
  throw new Error("the text does not open: " + str);
}
const keys = async (d, ...k) => { for (const x of k) await d.page.keyboard.press(x.replace("Mod", KEY)); };
const select = async (d, n) => { for (let i = 0; i < n; i++) await keys(d, "Shift+ArrowRight"); };
const save = d => d.rebuilt(() => keys(d, "Enter"));
const src = d => d.page.evaluate(() => document.querySelector(".sed-editing").textContent);
const look = d => d.page.evaluate(() => [...document.querySelectorAll(".deck .stage :is(.ttl, .bt, .pt, p, li)")].filter(e => e.getClientRects().length).map(e => e.innerText.replace(/[\u00a0\u200b]/g, " ").replace(/\s+/g, " ").trim()).join(" | "));

const op = (name, act, from, to, text = TEXT) => test(name, async draft => {
  const d = await draft({ text });
  await d.enter();
  await act(d);
  await save(d);
  eq(d.text(), text.replace(from, () => to));
  ok(!d.log.some(l => l.startsWith("pageerror")), d.log.join());
});

op("typing at the click", async d => { await clickAt(d, "の辺を", 1); await d.page.keyboard.type("XY"); }, "の辺を", "のXY辺を");
op("typing after a math", async d => { await clickAt(d, "とする。"); await d.page.keyboard.type("Z"); }, "$ とする", "$ Zとする");
for (const [k, tag] of [["Mod+k", "alert"], ["Mod+Shift+k", "navy"], ["Mod+b", "b"]])
  op("mark " + tag, async d => { await clickAt(d, "二つ目"); await select(d, 3); await keys(d, k); }, "二つ目", `<${tag}>二つ目</${tag}>`);
op("a mark over a math", async d => { await clickAt(d, "とする。"); await keys(d, "ArrowLeft"); for (let i = 0; i < 8; i++) await keys(d, "Shift+ArrowLeft"); await keys(d, "Mod+k"); },
  "$k\\le n$", "<alert>$k\\le n$</alert>");
op("the mark at the caret off", async d => { await clickAt(d, "赤い辺", 1); await keys(d, "Mod+k"); }, "<alert>赤い辺</alert>", "赤い辺");
op("one colour for another", async d => { await clickAt(d, "赤い辺"); await select(d, 3); await keys(d, "Mod+Shift+k"); }, "<alert>赤い辺</alert>", "<navy>赤い辺</navy>");
op("typing in a mark", async d => { await clickAt(d, "赤い辺", 2); await d.page.keyboard.type("Q"); }, "赤い辺", "赤いQ辺");
op("a line break", async d => { await clickAt(d, "次の項目", 2); await keys(d, "Shift+Enter"); }, "次の項目", "次の<br>項目");
op("a line break taken out", async d => { await clickAt(d, "と呼び、", 3); await keys(d, "ArrowRight", "Delete"); }, "呼び、<br>\n", "呼び、\n");
op("undo and redo of a mark", async d => { await clickAt(d, "次の項目"); await select(d, 2); await keys(d, "Mod+k", "Mod+z", "Mod+Shift+z"); }, "次の項目", "<alert>次の</alert>項目");
op("the button of the bubble", async d => { await clickAt(d, "次の項目"); await select(d, 2); await d.page.click(".sed-fmt button[data-tag=alert]"); }, "次の項目", "<alert>次の</alert>項目");
op("< in a math typed in", async d => { await clickAt(d, "二つ目"); await d.page.keyboard.type("$a<b$"); }, "二つ目", "$a&lt;b$二つ目");
op("typing before a reference", async d => { await clickAt(d, "本文では", 3); await d.page.keyboard.type("Q"); }, "本文では", "本文でQは", NUM);
op("typing after a reference", async d => { await clickAt(d, "から従う", 2); await d.page.keyboard.type("Q"); }, "から従う", "からQ従う", NUM);
op("typing in a title with its number", async d => { await clickAt(d, "（連結）", 2); await d.page.keyboard.type("Q"); }, "（連結）", "（連Q結）", NUM);
op("a click on the number of a title", async d => { await clickAt(d, "定義 1（連結）", 3); await d.page.keyboard.type("Q"); }, 'title="定義（', 'title="定義Q（', NUM);
op("a heading with a reference", async d => { await d.go(2); await clickAt(d, " の証明", 2); await d.page.keyboard.type("Q"); }, " の証明", " のQ証明", NUM);
op("after a math and a reference", async d => { await d.go(2); await clickAt(d, "の話。", 1); await d.page.keyboard.type("Q"); }, "の話", "のQ話", NUM);

test("edit mode shows the page as it is, and a text that is closed unchanged comes back", async draft => {
  for (const [text, q] of [[TEXT, ""], [NUM, ""], [BOTH, "?lang=ja"], [BOTH, "?lang=en"]]) {
    const d = await draft({ text, query: q });
    const was = await look(d);
    await d.enter();
    eq(await look(d), was, "in edit mode");
    const n = await d.page.locator(".page.on .sed-part, .page.on [data-sed]:not(.sed-parts), .page.on [data-sedt]:not(.sed-parts)").count();
    ok(n > 0, "texts");
    for (let i = 0; i < n; i++) {
      const e = d.page.locator(".page.on .sed-part, .page.on [data-sed]:not(.sed-parts), .page.on [data-sedt]:not(.sed-parts)").nth(i);
      if (!await e.isVisible()) continue;
      await e.click();
      await d.page.waitForSelector(".sed-editing");
      await keys(d, "Escape");
      eq(await look(d), was, "closed again");
    }
    eq(d.text(), text);
    await d.leave();
    eq(await look(d), was, "out of edit mode");
  }
});

test("the text open shows the source of its references and not the tags", async draft => {
  const d = await draft({ text: NUM });
  await d.enter();
  await clickAt(d, "から従う");
  eq(await src(d), "本文では \\ref{def}と\\num{def}から従う。");
  await keys(d, "Escape");
  const e = await draft({ text: TEXT });
  await e.enter();
  await clickAt(e, "赤い辺");
  ok(!/[<>]/.test(await src(e)), await src(e));
  ok((await src(e)).includes("$k\\le n$"), await src(e));
});

test("one language: the other is left, the reference is set in the language shown", async draft => {
  const d = await draft({ text: BOTH, query: "?lang=en" });
  await d.enter();
  ok((await look(d)).includes("Next by Definition 1."), await look(d));
  await clickAt(d, "Next", 4);
  await d.page.keyboard.type("Q");
  await save(d);
  eq(d.text(), BOTH.replace("Next by", "NextQ by"));
});

test("a text that moved while it was open is not saved into another text with the same source", async draft => {
  const text = doc("", `<slide title="s"><p>Z</p><p>X</p><p>X</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("X");
  await d.page.keyboard.press("End");
  await d.page.keyboard.type("NEW");
  const gone = text.replace("<p>Z</p>", "");
  d.outside(gone);
  await d.rebuilt(() => d.page.keyboard.press("Enter"));
  eq(d.text(), gone, "the file");
  ok((await d.msg()).includes("XNEW"), await d.msg());
});

test("a change after the text that is open does not stop its save", async draft => {
  const text = doc("", `<slide title="s"><p>first</p><p>last</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("first");
  await d.page.keyboard.press("End");
  await d.page.keyboard.type("Q");
  d.outside(text.replace("last", "LAST"));
  await d.rebuilt(() => d.page.keyboard.press("Enter"));
  eq(d.text(), text.replace("last", "LAST").replace("first", "firstQ"));
});

test("an engine tag inside a comment is not taken for the engine", async draft => {
  const text = doc("", `<slide title="s"><p>first</p></slide>`).replace("<head>", `<head><!-- <script src="old/kamishibai.js"></script> -->`);
  const d = await draft({ text });
  await d.enter();
  await d.edit("first", "firstQ");
  eq(d.text(), text.replace("first", "firstQ"));
});

/* ===== Folders kept, saving, rebuilding ===== */
const shown = d => d.page.evaluate(() => document.body.classList.contains("sed-on"));
// page-edit put on the page after prepare(d) ran (folders kept, keys set, ...)
async function fresh(draft, o, prepare) {
  const d = await draft(Object.assign({ edit: false }, o));
  if (prepare) await prepare(d);
  await d.inject();
  return d;
}
const plain = body => doc("", `<slide title="s" sec="一">${body}</slide>`);
const SIMPLE = plain("<p>次の項目</p>\n<p>二つ目の話</p>");

test("H2: of two kept folders that hold the draft's path, the file with the page's date", async draft => {
  const d = await fresh(draft, { text: SIMPLE }, async function (d) {
    mkdirSync(join(d.dir, "copy"));
    const c = join(d.dir, "copy", "draft.html"), old = new Date(Date.now() - 86400000);
    writeFileSync(c, SIMPLE); utimesSync(c, old, old);
    await d.keep([["copy/", d.name], ["", d.name]]);
  });
  await d.built(1);
  await d.enter();
  await d.edit("次の項目", "直した項目");
  eq(d.text(), SIMPLE.replace("次の項目", "直した項目"));
  eq(readFileSync(join(d.dir, "copy", "draft.html"), "utf8"), SIMPLE, "the copy");
  eq(d.picked, 0, "folder pickers");
});

test("L8: a kept folder that does not answer stays after the folder picker; one that is gone does not", async draft => {
  const d = await fresh(draft, { text: SIMPLE }, d => d.keep([["", "elsewhere", { hang: true }], ["gone/", "gone", { gone: true }]]));
  await d.enter();
  eq(d.picked, 1, "folder pickers");
  await d.page.waitForFunction(() => !__pageEdit.saving);
  eq(JSON.stringify(await d.kept()), JSON.stringify([d.name, "elsewhere"]));
});

test("U4: the kept folders are listed and forgotten", async draft => {
  const d = await fresh(draft, { text: SIMPLE }, d => d.keep([["", "other"], ["", d.name]]));
  await d.built(1);
  await d.enter();
  await d.page.click(".tools .sed-dirs");
  await d.page.waitForSelector(".sed-note li");
  const m = await d.msg();
  ok(m.includes("file://") && m.includes("chrome://settings/content/filesystem"), m);
  await d.page.locator(".sed-note li", { hasText: "other" }).locator("button").click();
  await d.page.waitForFunction(() => document.querySelectorAll(".sed-note li").length === 1);
  eq(JSON.stringify(await d.kept()), JSON.stringify([d.name]));
  await d.page.locator(".sed-note button", { hasText: "全て忘れる" }).click();
  await d.page.waitForFunction(() => !document.querySelector(".sed-note li"));
  eq(JSON.stringify(await d.kept()), "[]");
  await d.page.locator(".sed-note button", { hasText: "閉じる" }).click();
  eq(await d.msg(), "");
});

test("C5: the edit mode kept under the old name moves over; the folders kept in the page's own storage are removed", async draft => {
  const d = await fresh(draft, { text: SIMPLE }, async function (d) {
    await d.keep([["", d.name]]);
    await d.page.evaluate(() => Promise.all(["page-edit", "slide-edit"].map(n => new Promise(function (ok, no) {
      const r = indexedDB.open(n, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("dirs").put("x", "list");
      r.onsuccess = () => { r.result.close(); ok(); };
      r.onerror = () => no(r.error);
    }))));
    await d.page.reload({ waitUntil: "load" });
    await d.ready();
    await d.page.evaluate(() => sessionStorage.setItem("slide-edit-on:" + location.pathname, "1"));
  });
  await d.page.waitForFunction(() => document.body?.classList.contains("sed-on"));
  eq(d.picked, 0, "folder pickers");
  await d.page.waitForFunction(async () => !(await indexedDB.databases()).length);
  eq(JSON.stringify(await d.page.evaluate(() => [sessionStorage.getItem("slide-edit-on:" + location.pathname), sessionStorage.getItem("page-edit-on:" + location.pathname)])), '[null,"1"]');
  await d.edit("次の項目", "直した項目");
  eq(d.text(), SIMPLE.replace("次の項目", "直した項目"));
});

test("M3: a < that HTML reads as a tag is not saved; the text stays open with the reason", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  await clickAt(d, "二つ目");
  await d.page.keyboard.type("x<y ");
  await keys(d, "Enter");
  await d.page.waitForTimeout(300);
  ok(await d.page.locator(".sed-editing").count(), "still open");
  ok((await d.msg()).includes("&lt;"), await d.msg());
  eq(d.text(), SIMPLE);
  await keys(d, "Escape");
  // a plain & and a < before a space are written as typed
  await clickAt(d, "二つ目");
  await d.page.keyboard.type("A & B < C ");
  await save(d);
  eq(d.text(), SIMPLE.replace("二つ目", "A & B < C 二つ目"));
});

test("M3: in a text edited as plain text a < that makes a tag is not saved; a closed tag is", async draft => {
  const text = doc("", `<slide title="s"><p>first\u200b</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("first");
  await keys(d, "End"); await d.page.keyboard.type(" a<b");
  await keys(d, "Enter");
  await d.page.waitForTimeout(300);
  ok(await d.page.locator(".sed-editing").count(), "still open");
  eq(d.text(), text);
  await keys(d, "Escape");
  await d.edit("first", "<b>first</b>");
  eq(d.text(), text.replace("first", "<b>first</b>"));
});

test("M3: a paste that HTML would read as a tag is refused", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  await clickAt(d, "二つ目");
  const was = await src(d);
  await d.page.evaluate(function () {
    const t = new DataTransfer();
    t.setData("text/plain", "a<b c");
    document.querySelector(".sed-editing").dispatchEvent(new ClipboardEvent("paste", { clipboardData: t, bubbles: true, cancelable: true }));
  });
  ok((await d.msg()).includes("貼り付けませんでした"), await d.msg());
  eq(await src(d), was);
});

test("M4: an end tag that HTML implies ends the text there", async draft => {
  const text = doc("", `<slide title="s"><table><tr><td>セル一<td>セル二</table><p>後の文<p>次の文</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("セル一");
  eq(await src(d), "セル一");
  await keys(d, "Escape");
  await d.start("後の文");
  eq(await src(d), "後の文");
  await d.type("後の段落");
  await save(d);
  eq(d.text(), text.replace("後の文", "後の段落"));
});

test("M5: a rebuild that fails says so and is not left half done", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  await d.page.evaluate(() => { document.open = function () { throw new Error("blocked"); }; });
  await d.start("次の項目");
  await d.type("直した項目");
  await keys(d, "Enter");
  await d.page.waitForFunction(() => /組み直せませんでした/.test(document.querySelector(".sed-bar").textContent));
  eq(await d.page.evaluate(() => [__pageEdit.building, __pageEdit.saving].join()), "false,false");
});

test("M5: a draft whose Content-Security-Policy stops the rebuilt page-edit says so", async draft => {
  const text = TEXT.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="script-src file:">`);
  const d = await draft({ text });
  await d.page.keyboard.press(KEY + "+e");
  await d.page.waitForFunction(() => /Content-Security-Policy/.test((document.querySelector(".sed-bar") || document.body)?.textContent), null, { timeout: 8000 });
  eq(await d.page.evaluate(() => __pageEdit.building), false);
});

test("M6/C8: the one HTML file: comments, ?query and #hash, %, /paths and URLs, </style in CSS", async draft => {
  const text = doc("", `<slide title="s"><p>first</p>
<!-- <img src="gone.png"> -->
<img src="pic.png?v=1#x"><img src="100%.png"><img src="/abs.png"><img src="https://example.com/a.png">
</slide>`).replace("</head>", `<link rel="stylesheet" href="s.css?v=2"><!-- <link rel="stylesheet" href="gone.css"> --></head>`);
  const d = await draft({ text });
  writeFileSync(join(d.dir, "pic.png"), "P1"); writeFileSync(join(d.dir, "100%.png"), "P2");
  writeFileSync(join(d.dir, "s.css"), "p { color: red } /* </style><script>bad()</script> */");
  await d.enter();
  await d.page.evaluate(() => { document.querySelector('.tools [title="HTML：1 ファイル"]').click(); document.querySelector(".tools .g-out .go").click(); });
  await d.page.waitForFunction(() => /dist\.html を書きました|できませんでした|ありません/.test(document.querySelector(".sed-bar").textContent), null, { timeout: 20000 });
  const m = await d.msg();
  ok(m.includes("を書きました"), m);
  const out = readFileSync(join(d.dir, "draft.dist.html"), "utf8");
  ok(out.includes('<!-- <img src="gone.png"> -->') && out.includes('<!-- <link rel="stylesheet" href="gone.css"> -->'), "comments");
  ok(out.includes(';base64,' + Buffer.from("P1").toString("base64") + '"'), "?query and #hash");
  ok(out.includes(';base64,' + Buffer.from("P2").toString("base64") + '"'), "%");
  ok(out.includes('<img src="/abs.png">') && out.includes('<img src="https://example.com/a.png">'), "/paths and URLs");
  ok(out.includes("<\\/style><script>bad()") && !out.includes("</style><script>bad()"), "</style");
});

const TOUCH = d => readFileSync(d.path);
test("L1: a no-break space of the source stays; undo gives back the same bytes", async draft => {
  const text = doc("", `<slide title="木\u00a0幅の話"><p>本\u00a0文\u200b</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("幅の話", ".page.on .ttl [data-sedt], .page.on [data-sedt]");
  await keys(d, "End"); await d.page.keyboard.type(" Q");
  await save(d);
  eq(d.text(), text.replace("幅の話", "幅の話 Q"));
  await d.start("文");
  await keys(d, "End"); await d.page.keyboard.type(" R");
  await save(d);
  eq(d.text(), text.replace("幅の話", "幅の話 Q").replace("\u200b</p>", "\u200b R</p>"));
  await d.undo(); await d.undo();
  ok(TOUCH(d).equals(Buffer.from(text)), "undone:\n" + d.text());
});

test("L2: typing just before a line end of the source keeps the line end and its indent; undo gives back the same bytes", async draft => {
  const text = plain(`<p>一行目\n    二行目</p>`);
  const d = await draft({ text });
  await d.enter();
  for (const [at, typed, want] of [[0, "X", "一行目X\n    二行目"], [1, "Y", "一行目X\n    Y二行目"]]) {
    await clickAt(d, "二行目");
    await d.page.evaluate(k => { const w = document.querySelector(".sed-editing .sed-ws"); getSelection().collapse(w.firstChild, k); }, at);
    await d.page.keyboard.type(typed);
    await save(d);
    ok(d.text().includes(want), d.text());
  }
  await d.undo(); await d.undo();
  ok(TOUCH(d).equals(Buffer.from(text)), "undone:\n" + d.text());
  // after a <br> there is no text before the line end: Chrome types into it
  const text2 = plain(`<p>一行目<br>\n    二行目</p>`);
  const d2 = await draft({ text: text2 });
  await d2.enter();
  await clickAt(d2, "二行目");
  await d2.page.evaluate(() => { const w = document.querySelector(".sed-editing .sed-ws"); getSelection().collapse(w.firstChild, 0); });
  await d2.page.keyboard.type("X");
  await save(d2);
  ok(d2.text().includes("一行目<br>X\n    二行目"), d2.text());
  await d2.undo();
  ok(TOUCH(d2).equals(Buffer.from(text2)), "undone:\n" + d2.text());
});

test("L3: a line end in an attribute value stays; one typed there is a space", async draft => {
  const text = doc("", `<slide title="一行目\n二行目"><p>本文</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("一行目", ".page.on [data-sedt]");
  await keys(d, "End"); await d.page.keyboard.type("Q"); await keys(d, "Shift+Enter"); await d.page.keyboard.type("R");
  await save(d);
  eq(d.text(), text.replace("一行目\n", "一行目Q R\n"));
  await d.undo();
  ok(TOUCH(d).equals(Buffer.from(text)), "undone:\n" + d.text());
});

test("L4: an English section name is rewritten only where its Japanese is the same too", async draft => {
  const text = doc(' numbering="deck"', `<slide title="a" title-en="A" sec="序" sec-en="Intro"><p>一</p></slide>
<slide title="b" title-en="B" sec="序" sec-en="Intro"><p>二</p></slide>
<slide title="c" title-en="C" sec="本論" sec-en="Intro"><p>三</p></slide>`);
  const d = await draft({ text, query: "?lang=en" });
  await d.enter();
  await d.edit("Intro", "Start", ".page.on .hn.on, .page.on .hn [data-sedt], .page.on .hn");
  eq(d.text(), text.replace(/sec="序" sec-en="Intro"/g, 'sec="序" sec-en="Start"'));
});

test("L5: a draft that cannot be read any more is said once", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  unlinkSync(d.path);
  await d.page.waitForFunction(() => /原稿を読めなくなりました/.test(document.querySelector(".sed-msg").textContent), null, { timeout: 5000 });
  await d.page.evaluate(() => { const m = document.querySelector(".sed-msg"); m.textContent = ""; });
  await d.page.waitForTimeout(2500);
  eq(await d.page.evaluate(() => document.querySelector(".sed-msg").textContent), "", "said again");
  const g = await d.gen();
  writeFileSync(d.path, SIMPLE.replace("次の項目", "外の項目"));
  const at = new Date(Date.now() + 2000); utimesSync(d.path, at, at);
  await d.built(g + 1);
  ok((await look(d)).includes("外の項目"), "read again");
});

test("L9: a packed file of an engine without the three modes is not edited", async draft => {
  const d = await fresh(draft, { text: SIMPLE }, d => d.page.evaluate(() => { delete Kamishibai.setEditor; Kamishibai.packed = true; }));
  await d.page.waitForTimeout(500);
  eq(await d.page.locator(".sed-bar").count(), 0);
});

test("C9: an engine without the three modes gets a Japanese button; a failed write says why in Japanese", async draft => {
  const d = await fresh(draft, { text: SIMPLE }, d => d.page.evaluate(() => { delete Kamishibai.setEditor; }));
  eq(await d.page.evaluate(() => document.querySelector(".sed-start-btn").textContent), "編集 " + (KEY === "Meta" ? "⌘E" : "Ctrl+E"));
  const e = await draft({ text: SIMPLE });
  await e.enter();
  e.fail = { name: "NoModificationAllowedError", message: "locked" };
  await e.start("次の項目"); await e.type("直した項目"); await keys(e, "Enter");
  await e.page.waitForFunction(() => /保存できませんでした/.test(document.querySelector(".sed-bar").textContent));
  ok((await e.msg()).includes("ほかのプログラムが使っているか") && (await e.msg()).includes("直した項目"), await e.msg());
  eq(e.text(), SIMPLE);
});

test("L10: Japanese and English are paired as the engine pairs them, text between them aside", async draft => {
  const text = doc("", `<slide title="s"><p><ja>日本語の文</ja> と <en>English text</en></p></slide>`);
  for (const q of ["?lang=en", "?lang=ja"]) {
    const d = await draft({ text, query: q });
    const was = await look(d);
    await d.enter();
    // the parts of a text sit apart in edit mode: the words are the same
    eq((await look(d)).replace(/\s/g, ""), was.replace(/\s/g, ""), "in edit mode " + q);
  }
});

test("L11: the script put into the rebuilt page has no <!-- and no <script or </script", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  const t = await d.page.evaluate(() => [].find.call(document.scripts, s => s.textContent.includes("__pageEdit")).textContent);
  ok(t.length > 1000 && !/<!--|<\/?script/i.test(t), "escaped");
});

test("L12: undo keys made by a script of the page do nothing", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  await d.edit("次の項目", "直した項目");
  const t = d.text();
  await d.page.evaluate(m => document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", metaKey: m, ctrlKey: !m, bubbles: true })), KEY === "Meta");
  await d.page.waitForTimeout(500);
  eq(d.text(), t);
});

test("L13: a history in the tab's storage that is not of page-edit is dropped; redo is trimmed too", async draft => {
  const d = await draft({ text: SIMPLE, edit: false });
  await d.page.evaluate(() => sessionStorage.setItem("page-edit-undo:" + location.pathname, JSON.stringify({ undo: [{ before: 1, parts: "x" }], redo: [] })));
  await d.inject();
  await d.enter();
  eq(await d.lit(), "- -");
  await d.edit("次の項目", "直した項目");
  await d.edit("二つ目", "2番目");
  await d.undo();
  await d.page.evaluate(() => { const r = __pageEdit.hist.redo; while (r.length < 130) r.unshift(r[0]); });
  await d.undo();
  eq(await d.page.evaluate(() => __pageEdit.hist.redo.length), 100);
  eq(d.text(), SIMPLE);
});

test("C6: the version in edit.js is that of the manifest", async () => {
  const v = JSON.parse(readFileSync(join(ROOT, "page-edit", "manifest.json"), "utf8")).version;
  const m = /const VERSION = "([^"]+)"/.exec(readFileSync(join(ROOT, "page-edit", "edit.js"), "utf8"));
  eq(m && m[1], v);
});

test("C7: the engine's key of select mode (in the button's title) saves the open text", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  await d.start("次の項目"); await d.type("直した項目");
  await d.rebuilt(() => keys(d, "Mod+i"));
  eq(d.text(), SIMPLE.replace("次の項目", "直した項目"));
});

test("U1: a text edited as plain text says why; the keys of marks say they are not there", async draft => {
  const text = doc("", `<slide title="s"><p>first\nsecond</p></slide>`).replace(/\n/g, "\r\n");
  const d = await draft({ text });
  await d.enter();
  await d.start("first");
  ok((await d.msg()).includes("CRLF"), await d.msg());
  await keys(d, "Mod+a", "Mod+k");
  ok((await d.msg()).includes("使えません"), await d.msg());
  eq(await src(d), "first\r\nsecond");
});

test("U2: a save that meets a change outside leaves a note until it is closed", async draft => {
  const text = doc("", `<slide title="s"><p>Z</p><p>X</p></slide>`);
  const d = await draft({ text });
  await d.enter();
  await d.start("X");
  await keys(d, "End"); await d.page.keyboard.type("NEW");
  d.outside(text.replace("<p>X</p>", "<p>Y</p>"));
  await d.rebuilt(() => keys(d, "Enter"));
  await d.page.waitForTimeout(500);
  ok((await d.msg()).includes("XNEW"), await d.msg());
  await d.page.locator(".sed-note button", { hasText: "閉じる" }).click();
  ok(!(await d.msg()).includes("XNEW"), await d.msg());
});

test("U3: undo while saving or rebuilding says why nothing happened", async draft => {
  const d = await draft({ text: SIMPLE });
  await d.enter();
  await d.edit("次の項目", "直した項目");
  for (const [k, re] of [["saving", /保存か読み込みの途中/], ["building", /組み直している途中/]]) {
    await d.page.evaluate(k => { __pageEdit[k] = true; }, k);
    await keys(d, "Mod+z");
    ok(re.test(await d.msg()), await d.msg());
    await d.page.evaluate(k => { __pageEdit[k] = false; }, k);
  }
  eq(d.text(), SIMPLE.replace("次の項目", "直した項目"));
});

op("a \\$ is one character on the page", async d => { await clickAt(d, "の差", 1); await d.page.keyboard.type("Q"); },
  "の差", "のQ差", plain(`<p>価格 \\$5 と \\$6 の差</p>`));
op("a \\$ before a math", async d => { await clickAt(d, "の差", 1); await d.page.keyboard.type("Q"); },
  "の差", "のQ差", plain(`<p>価格 \\$5 と $x$ の差</p>`));

run(process.argv[2]);
