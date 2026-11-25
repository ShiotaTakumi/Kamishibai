// Screenshot pages of a Kamishibai deck: node tools/shot.mjs DECK.html OUTDIR 4 61 62  (1280x720, page n = #s<n>)
import { chromium } from "playwright";
import { pathToFileURL } from "url";
const [src, out, ...pages] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
for (const n of pages) { await p.goto(pathToFileURL(src).href + "#s" + n, { waitUntil: "load" }); await p.reload({ waitUntil: "load" });
  /* the page as the engine has built it (math, fonts, fitting), then the steps and figures of that page */
  await p.waitForFunction(() => window.Kamishibai && Kamishibai.ready, null, { timeout: 30000 }).then(() => p.evaluate(() => Kamishibai.ready)).catch(() => {});
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/p${n}.png` }); }
await b.close();
