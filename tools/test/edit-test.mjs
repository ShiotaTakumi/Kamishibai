// Editing a text by its look in page-edit (page-edit/edit.js): what is shown, where the caret goes, marks, line
// breaks, and the source that comes out: node tools/test/edit-test.mjs [part of a name]
import { test, run, eq, ok, KEY } from "./harness.mjs";

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

run(process.argv[2]);
