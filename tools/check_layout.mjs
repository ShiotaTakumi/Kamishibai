// Check the layout of a slide file in several browser engines.
//
//   node tools/check_layout.mjs [slide.html] [--engines=chromium,webkit,firefox,safari]
//
// Two kinds of file:
// - a page of the Kamishibai engine (engine/kamishibai.js, as a draft or packed by make pack):
//   every page with all steps shown and every card of each flip figure (layout/engine_probe.js),
//   the printed sheets (one per step, as for the PDF button), and in Chromium the PDF itself
//   (number of pages and paper size). Reports text or boxes outside the content area or the canvas,
//   text wider than its block, clipped text, and line breaks that differ between the engines or
//   between screen and print.
// - the old slide.html (make html): every slide with all .reveal steps shown (layout/measure.js);
//   line breaks between the engines and boxes outside the 1280x720 canvas.
// A deck with English (<ja>…</ja><en>…</en>, lang="en", title-en=… ; see engine/kamishibai.js) is
// checked in Japanese and then in English. A page the engine had to draw smaller to fit is listed
// with its factor (not a problem); a page that overflows even at the smallest factor is a problem.
// Exit status 0 when the engines agree and nothing overflows.
//
// Engines (default chromium,webkit): chromium, webkit and firefox are the builds pinned by
// Playwright, the same on every machine; install them once with
//   make browsers      (on Linux the first time: tools/node_modules/.bin/playwright install --with-deps chromium webkit)
// Playwright's WebKit is a recent WebKit, not the Safari of a given Mac. safari is the system
// WebKit of this Mac (macOS only, needs swiftc from the Xcode command-line tools; screen only).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, webkit, firefox } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINES = { chromium, webkit, firefox };
const args = process.argv.slice(2);
const opt = args.find(a => a.startsWith("--engines="));
const names = opt ? opt.slice(10).split(",") : ["chromium", "webkit"];
const src = resolve(args.find(a => !a.startsWith("--")) || resolve(HERE, "..", "slide.html"));
const html = readFileSync(src, "utf8");
const ENGINE = /kamishibai\.js|data-packed=/.test(html);
const probe = readFileSync(resolve(HERE, "layout", ENGINE ? "engine_probe.js" : "measure.js"), "utf8");
const BI = ENGINE && /<en[\s>]|\blang=["']?en\b|\b(?:title|cite|label|sec|aff|short)-en=/i.test(html);
let LANG = BI ? "ja" : "";
const probeFor = () => (LANG ? `window.__layoutLang=${JSON.stringify(LANG)};\n` : "") + probe;
const withProbe = () => html.replace(/<\/html>\s*$|$/, m => `<script>${probeFor()}</script>${m}`);
const label = { chromium: "Chromium", webkit: "WebKit", firefox: "Firefox", safari: "Safari (system)" };

function safari() {
  if (process.platform !== "darwin") { console.error("safari: macOS only"); process.exit(2); }
  const tmp = mkdtempSync(join(tmpdir(), "layout-"));
  // an engine draft loads kamishibai.js and its parts by relative paths: put the page next to it
  const page = ENGINE ? join(dirname(src), `.${basename(src, ".html")}.probe.html`) : join(tmp, "probe.html");
  try {
    const exe = join(tmp, "webkit_probe");
    execFileSync("swiftc", ["-O", "-o", exe, resolve(HERE, "layout", "webkit_probe.swift")], { stdio: "inherit" });
    writeFileSync(page, withProbe());
    return JSON.parse(execFileSync(exe, [page], { encoding: "utf8", timeout: 300000, maxBuffer: 1 << 28 }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (ENGINE) rmSync(page, { force: true });
  }
}

/* PDF facts: number of pages and the size of each (MediaBox, pt) */
function pdfPages(buf) {
  const s = buf.toString("latin1");
  const boxes = [...s.matchAll(/\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/g)]
    .map(m => [+m[3] - +m[1], +m[4] - +m[2]]);
  const n = [...s.matchAll(/\/Type\s*\/Page(?!s)/g)].length;
  return { n, boxes };
}

/* the engine measures how small to draw each page on screen: open in screen media, wait for that,
   then switch to print when the printed sheets are measured */
async function load(page, print) {
  await page.goto(pathToFileURL(src).href, { waitUntil: "load" });
  await page.waitForFunction(() => window.Kamishibai && window.Kamishibai.size, null, { timeout: 300000 });
  await page.evaluate(() => window.Kamishibai.ready);
  if (print) await page.emulateMedia({ media: "print" });
  await page.addScriptTag({ content: probeFor() });
  await page.waitForSelector("#__layout", { state: "attached", timeout: 300000 });
  return JSON.parse(await page.$eval("#__layout", e => e.textContent));
}

async function measure(name) {
  if (name === "safari") return safari();
  const engine = ENGINES[name];
  if (!engine) { console.error(`unknown engine: ${name}`); process.exit(2); }
  const browser = await engine.launch();
  try {
    const ctx = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
    if (!ENGINE) {
      const page = await browser.newPage(ctx);
      await page.setContent(withProbe(), { waitUntil: "load" });
      await page.waitForSelector("#__layout", { state: "attached", timeout: 60000 });
      return JSON.parse(await page.$eval("#__layout", e => e.textContent));
    }
    const screen = await load(await browser.newPage(ctx));
    const pp = await browser.newPage(ctx);
    const print = await load(pp, true);
    screen.sheets = print.sheets; screen.count = print.count;
    screen.problems = screen.problems.concat(print.problems);
    if (name === "chromium") {
      const [W, H] = screen.size, want = [W * 0.75, H * 0.75];
      for (const steps of [false, true]) {
        await pp.evaluate(s => document.body.classList.toggle("print-steps", s), steps);
        const { n, boxes } = pdfPages(await pp.pdf({ preferCSSPageSize: true, printBackground: true }));
        const expect = steps ? print.count.sheets : print.count.pages, what = steps ? "with steps" : "plain";
        if (n !== expect) screen.problems.push(`PDF (${what}): ${n} pages, not ${expect}`);
        const off = boxes.find(b => Math.abs(b[0] - want[0]) > 1 || Math.abs(b[1] - want[1]) > 1);
        if (off) screen.problems.push(`PDF (${what}): a page is ${off[0]}x${off[1]} pt, not ${want[0]}x${want[1]}`);
      }
    }
    return screen;
  } finally {
    await browser.close();
  }
}

const [ref, ...rest] = names;
let bad = 0;
const say = s => { console.log(s); bad++; };
const where = r => `#${r.slide}${r.state ? " (" + r.state + ")" : ""}`;
function compare(A, B, la, lb) {
  const key = r => r.slide + "|" + r.state, mb = new Map(B.map(r => [key(r), r]));
  if (A.length !== B.length) say(`${A.length} states in ${la}, ${B.length} in ${lb}`);
  for (const a of A) {
    const b = mb.get(key(a)); if (!b) continue;
    if (a.blocks.length !== b.blocks.length) say(`${where(a)}: ${a.blocks.length} text blocks in ${la}, ${b.blocks.length} in ${lb}`);
    a.blocks.forEach((x, j) => {
      const y = b.blocks[j];
      if (y && JSON.stringify(x.lines) !== JSON.stringify(y.lines))
        say(`${where(a)}: line breaks differ\n  ${la} (${x.w} px): ${x.lines.join(" / ")}\n  ${lb} (${y.w} px): ${y.lines.join(" / ")}`);
    });
  }
}

if (!ENGINE) {
  const res = {};
  for (const n of names) res[n] = await measure(n);
  for (const other of rest) compare(res[ref], res[other], label[ref], label[other]);
  for (const n of names) for (const r of res[n]) for (const o of r.overflow) say(`#${r.slide}: ${label[n]}: outside the canvas: ${o}`);
  const R = res[ref];
  console.log(`${R.length} slides, ${R.reduce((s, r) => s + r.blocks.length, 0)} text blocks, ${names.map(n => label[n]).join(" + ")}: ` +
              (bad ? `${bad} problem(s)` : "the engines agree, nothing overflows"));
  process.exit(bad ? 1 : 0);
}

let total = 0;
for (const L of BI ? ["ja", "en"] : [""]) {
  LANG = L;
  const res = {};
  for (const n of names) res[n] = await measure(n);
  const before = bad, tag = L ? `[${L}] ` : "";
  if (L) console.log(`== ${L === "ja" ? "Japanese" : "English"} ==`);
  for (const other of rest) compare(res[ref].pages, res[other].pages, label[ref], label[other]);
  for (const n of names) {
    const r = res[n], Lb = label[n];
    if (L && r.lang && r.lang !== L) say(`${Lb}: measured in ${r.lang}, not ${L}`);
    for (const p of r.pages) for (const o of p.overflow) say(`${where(p)}: ${Lb}: ${o}`);
    for (const p of r.pages) if (!p.state && p.over) say(`${where(p)}: ${Lb}: overflows even when drawn at ${Math.round(p.fit * 100)}%`);
    for (const o of r.problems) say(`print: ${Lb}: ${o}`);
    if (!r.sheets || !r.sheets.length) continue;
    for (const p of r.sheets) for (const o of p.overflow) say(`${where(p)}: ${Lb} print: ${o}`);
    compare(r.pages.filter(p => !p.state), r.sheets, `${Lb} screen`, `${Lb} print`);
  }
  const R = res[ref], pages = R.pages.filter(p => !p.state).length;
  const small = R.pages.filter(p => !p.state && p.fit != null && p.fit < 1 && !p.over);
  if (small.length) console.log(`drawn smaller to fit (${label[ref]}): ` + small.map(p => `#${p.slide} ${Math.round(p.fit * 100)}%`).join(", "));
  console.log(`${tag}${pages} pages (${R.pages.length - pages} more flip states, ${R.count ? R.count.sheets : "?"} printed sheets), ` +
              `${R.size.join("x")}, ${names.map(n => label[n]).join(" + ")}: ` +
              (bad > before ? `${bad - before} problem(s)` : "the engines agree, screen and print agree, nothing overflows"));
  total = bad;
}
process.exit(total ? 1 : 0);
