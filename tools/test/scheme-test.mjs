// Dark mode (engine/kamishibai.js, base.css, themes/).   node tools/test/scheme-test.mjs [part of a test's name]
import { test, run, eq, ok } from "./harness.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const deck = (theme, attr = "") => `<!DOCTYPE html>\n<html lang="ja" theme="${theme}"${attr}>\n<head><meta charset="utf-8"><title>t</title>
<script src="engine/kamishibai.js"></script></head>
<body>
<cover><headline>題目</headline><author>著者</author></cover>
<slide title="導入" sec="序">
  <list><item>文 <alert>強調</alert> <navy>色</navy> <orange>橙</orange> <blue>青</blue> <green>緑</green> $x^2$</item></list>
  <block title="定義 1">文 <i>斜体</i></block>
  <alertblock title="注意">文</alertblock>
  <exampleblock title="例">文</exampleblock>
  <note>覚え書き</note>
  <figure><svg class="a" width="80" height="40"><rect width="80" height="40" fill="#fff" stroke="#000"/></svg>
  <svg class="b" light width="80" height="40"><rect width="80" height="40" fill="#fff" stroke="#000"/></svg>
  <img class="c" src="${PNG}" width="80" height="40"></figure>
</slide>
</body></html>
`;
const isDark = d => d.page.evaluate(() => document.documentElement.classList.contains("dark"));
const css = (d, q, p) => d.page.evaluate(([q, p]) => getComputedStyle(document.querySelector(".page.on " + q) || document.querySelector(q))[p], [q, p]);
const plain = async (draft, text, query) => { const d = await draft({ text, edit: false, query }); await d.goto(); return d; };
const go = (d, n) => d.page.evaluate(n => { location.hash = "#s" + n; }, n).then(() => d.page.waitForTimeout(200));

test("light unless asked; D and the button switch; the browser remembers", async draft => {
  const d = await plain(draft, deck("Boadilla"));
  eq(await isDark(d), false);
  await d.page.keyboard.press("d");
  eq(await isDark(d), true);
  eq(await d.page.evaluate(() => Kamishibai.scheme()), "dark");
  eq(await d.page.evaluate(() => localStorage.getItem("kamishibai-scheme")), "dark");
  eq(await d.page.evaluate(() => localStorage.getItem("kamishibai-steps")), null, "what is remembered of the steps");
  ok(await d.page.evaluate(() => [...document.querySelectorAll('.tools button[title^="ダークモード"]')].every(b => b.classList.contains("on"))), "not lit");
  await d.goto();
  eq(await isDark(d), true, "after a reload");
  await d.page.evaluate(() => document.querySelector('.tools .g-show button[title^="ダークモード"]').click());
  eq(await isDark(d), false);
});

test("?scheme and <html scheme>; the event", async draft => {
  const d = await plain(draft, deck("Boadilla"), "?scheme=dark");
  eq(await isDark(d), true);
  await d.goto("?scheme=light");
  eq(await isDark(d), false);
  const e = await plain(draft, deck("Madrid", ' scheme="dark"'));
  eq(await isDark(e), true);
  const got = await e.page.evaluate(() => { const l = []; document.addEventListener("kamishibai:scheme", x => l.push(x.detail)); Kamishibai.scheme("light"); Kamishibai.scheme("light"); Kamishibai.scheme("dark"); return l.join(); });
  eq(got, "light,dark");
});

test("printing and the output mode are light", async draft => {
  for (const t of ["Boadilla", "Madrid"]) {
    const d = await plain(draft, deck(t));
    const look = () => d.page.evaluate(() => [".ttl", "item", "alert", ".bt", ".bb", "note", "svg.a"].map(q => { const c = getComputedStyle(document.querySelector(".ppage " + q) || document.querySelector(".page " + q)); return [c.color, c.backgroundColor, c.filter].join(" "); }).join("\n"));
    await d.page.emulateMedia({ media: "print" });
    const light = await look();
    await d.page.emulateMedia({ media: "screen" });
    await d.page.evaluate(() => Kamishibai.scheme("dark"));
    await d.page.emulateMedia({ media: "print" });
    eq(await look(), light, t);
    await d.page.emulateMedia({ media: "screen" });
    ok(await look() !== light, t + ": the screen is not dark");
    await d.page.keyboard.press((process.platform === "darwin" ? "Meta" : "Control") + "+p");
    eq(await isDark(d), false, t + " output mode");
    await d.page.evaluate(() => document.querySelector('.tools button[title^="モード：プレゼン"]').click());
    eq(await isDark(d), true, t + " back");
  }
});

// WCAG contrast of the text with the nearest ground painted behind it
const CONTRAST = () => {
  const num = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = c => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const out = [];
  const walk = document.createTreeWalker(document.querySelector(".page.on"), NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) {
    const e = n.parentElement;
    if (!n.data.trim() || e.closest("svg, .katex-mathml, .hl, .foot") || !e.getClientRects().length) continue;
    let g = e, b;
    for (;;) { b = num(getComputedStyle(g).backgroundColor); if (b.length === 3 || b[3] > .9) break; g = g.parentElement; if (!g) { b = [255, 255, 255]; break; } }
    const x = lum(num(getComputedStyle(e).color)), y = lum(b);
    out.push([e.localName + ":" + n.data.trim().slice(0, 8), (Math.max(x, y) + .05) / (Math.min(x, y) + .05)]);
  }
  return out;
};
test("the text reads on its ground in the dark (contrast 4.5 or more)", async draft => {
  for (const t of ["Boadilla", "Madrid"]) {
    const d = await plain(draft, deck(t), "?scheme=dark");
    for (const p of [1, 2]) {
      await go(d, p);
      const l = await d.page.evaluate(CONTRAST);
      ok(l.length > 1, "no text");
      for (const [what, c] of l) ok(c >= 4.5, `${t} p.${p} ${what}: ${c.toFixed(2)}`);
    }
  }
});

test("figures: SVG is turned, light and pictures are kept on white", async draft => {
  const d = await plain(draft, deck("Boadilla"), "?scheme=dark");
  await go(d, 2);
  ok((await css(d, "svg.a", "filter")).includes("invert"), "SVG not turned");
  eq(await css(d, "svg.b", "filter"), "none");
  eq(await css(d, "svg.b", "backgroundColor"), "rgb(255, 255, 255)");
  eq(await css(d, "img.c", "filter"), "none");
  eq(await css(d, "img.c", "backgroundColor"), "rgb(255, 255, 255)");
});

test("edit mode: D switches, is a letter in a text being edited, and the draft is not changed", async draft => {
  const t = deck("Boadilla"), d = await draft({ text: t });
  await d.enter();
  await d.go(2);
  await d.key("d");
  eq(await isDark(d), true);
  ok(await d.page.evaluate(() => document.body.classList.contains("sed-on")), "left edit mode");
  eq(d.text(), t);
  await d.start("覚え書き");
  await d.type("d");
  eq(await isDark(d), true, "a letter");
});

run(process.argv[2]);
