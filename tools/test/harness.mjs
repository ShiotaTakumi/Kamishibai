// What the browser tests share: a runner, drafts in a temporary folder, and page-edit on them.
//
// page-edit writes through the File System Access API, whose folder picker cannot be driven by a test. Here
// showDirectoryPicker() hands out a folder made of the same calls (getDirectoryHandle, getFileHandle, getFile,
// createWritable) on the real files of the temporary folder; everything above that is page-edit as it is, injected
// into the page as Chrome does for a content script of world MAIN.
//
// The folders can be kept in IndexedDB as Chrome keeps real ones: put() stores a fake folder by its place and
// options, and reading it back (IDBRequest.result) makes the folder again. Options of a fake folder: hang (none of
// its methods ever settles, as a dead folder of an earlier Chrome), gone (isSameEntry fails with NotFoundError),
// perm (what queryPermission answers, "granted" when not given). window.__picked counts the folder pickers shown;
// window.__fail = {name, message} makes the next write fail with that DOMException.
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EDIT = readFileSync(join(ROOT, "page-edit", "edit.js"), "utf8");

const tests = [];
export const test = (name, fn) => tests.push({ name, fn });
export function eq(a, b, what) {
  if (a !== b) throw new Error((what ? what + ": " : "") + "got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
}
export function ok(v, what) { if (!v) throw new Error(what || "not true"); }

let browser;
export async function run(only) {
  browser = await chromium.launch();
  let bad = 0, n = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    n++;
    const open = [];
    try { await t.fn(o => draft(o, open)); console.log("ok    " + t.name); }
    catch (e) { bad++; console.log("FAIL  " + t.name + "\n      " + String(e.stack || e).split("\n").slice(0, 6).join("\n      ")); }
    for (const d of open) await d.close();
  }
  await browser.close();
  console.log(`${n - bad} of ${n} tests passed`);
  process.exitCode = bad || !n ? 1 : 0;
}

export const KEY = process.platform === "darwin" ? "Meta" : "Control";

// A draft: {text} or {bytes}, opened at page #s1; {edit: false} leaves page-edit out, {query: "?lang=en"}.
async function draft(o, open) {
  const dir = mkdtempSync(join(tmpdir(), "kamishibai-test-"));
  symlinkSync(join(ROOT, "engine"), join(dir, "engine"));
  const path = join(dir, "draft.html");
  writeFileSync(path, o.bytes || o.text);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const d = { dir, path, page, log: [], hook: null };
  open.push({ close: async () => { await ctx.close(); rmSync(dir, { recursive: true, force: true }); } });
  page.on("console", m => d.log.push(m.text()));
  page.on("pageerror", e => d.log.push("pageerror " + e.message));
  await page.exposeFunction("__fs", function (op, rel, data) {
    const f = join(dir, rel);
    if (op === "stat") { try { return statSync(f).isDirectory() ? "dir" : "file"; } catch (e) { return ""; } }
    if (op === "read") {
      const r = { data: readFileSync(f).toString("base64"), at: Math.floor(statSync(f).mtimeMs) };
      if (d.hook) d.hook("read");
      return r;
    }
    if (op === "write") { writeFileSync(f, Buffer.from(data, "base64")); return null; }
  });
  await page.addInitScript(name => {
    const b64 = u => { let s = ""; new Uint8Array(u).forEach(c => { s += String.fromCharCode(c); }); return btoa(s); };
    const file = (rel, n) => ({
      kind: "file", name: n,
      async getFile() {
        const r = await __fs("read", rel);
        return new File([Uint8Array.from(atob(r.data), c => c.charCodeAt(0))], n, { lastModified: r.at });
      },
      async createWritable() {
        const parts = [];
        return {
          async write(x) { parts.push(x); },
          async close() {
            const f = window.__fail;
            if (f) { window.__fail = null; throw new DOMException(f.message || "failed", f.name); }
            await __fs("write", rel, b64(await new Blob(parts).arrayBuffer()));
          }
        };
      }
    });
    const never = () => new Promise(() => {});
    const folder = (rel, n, o = {}) => ({
      kind: "directory", name: n, __rel: rel, __o: o,
      queryPermission() { return o.hang ? never() : Promise.resolve(o.perm || "granted"); },
      requestPermission() { if (o.hang) return never(); o.perm = "granted"; return Promise.resolve("granted"); },
      isSameEntry(x) {
        if (o.hang) return never();
        if (o.gone) return Promise.reject(new DOMException("gone", "NotFoundError"));
        return Promise.resolve(!!x && x.__rel === rel && x.name === n && !x.__o.gone);
      },
      async getDirectoryHandle(x) { if (o.hang) return never(); if (await __fs("stat", rel + x) !== "dir") throw new DOMException("no folder " + x, "NotFoundError"); return folder(rel + x + "/", x); },
      async getFileHandle(x, p) { if (o.hang) return never(); if (!(p && p.create) && await __fs("stat", rel + x) !== "file") throw new DOMException("no file " + x, "NotFoundError"); return file(rel + x, x); }
    });
    window.__folder = folder;
    window.__picked = 0;
    window.showDirectoryPicker = async () => { window.__picked++; return folder("", name); };
    const pack = v => Array.isArray(v) ? v.map(pack) : v && v.kind === "directory" && v.__rel !== undefined ? { __fake: 1, rel: v.__rel, name: v.name, o: v.__o } : v;
    const unpack = v => Array.isArray(v) ? v.map(unpack) : v && v.__fake ? folder(v.rel, v.name, v.o) : v;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) { return put.call(this, pack(v), k); };
    const res = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "result");
    Object.defineProperty(IDBRequest.prototype, "result", { configurable: true, get() { return unpack(res.get.call(this)); } });
  }, basename(dir));
  d.name = basename(dir);
  // Keep folders [rel, name, options] in store "dirs" of IndexedDB db (as page-edit does), and read the names kept.
  d.keep = (list, db = "page-edit") => page.evaluate(([l, n]) => new Promise(function (ok, no) {
    const r = indexedDB.open(n, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("dirs");
    r.onerror = () => no(r.error);
    r.onsuccess = function () {
      const x = r.result, tx = x.transaction("dirs", "readwrite");
      tx.objectStore("dirs").put(l.map(f => __folder(f[0], f[1], f[2] || {})), "list");
      tx.oncomplete = () => { x.close(); ok(); };
      tx.onabort = () => no(tx.error);
    };
  }), [list, db]);
  d.kept = (db = "page-edit") => page.evaluate(n => new Promise(function (ok, no) {
    const r = indexedDB.open(n);
    r.onupgradeneeded = () => r.transaction.abort();
    r.onerror = () => ok(null);
    r.onsuccess = function () {
      const x = r.result;
      if (!x.objectStoreNames.contains("dirs")) { x.close(); ok(null); return; }
      const q = x.transaction("dirs").objectStore("dirs").get("list");
      q.onsuccess = () => { x.close(); ok((q.result || []).map(f => f.name + (f.__rel ? ":" + f.__rel : ""))); };
      q.onerror = () => no(q.error);
    };
  }), db);
  d.dbs = () => page.evaluate(async () => (await indexedDB.databases()).map(x => x.name).sort());

  d.bytes = () => readFileSync(path);
  d.text = () => readFileSync(path, "utf8");
  // a change by another program; the time stamp moves on even within one millisecond
  d.outside = function (t) {
    writeFileSync(path, t);
    const at = new Date(Date.now() + 2000);
    utimesSync(path, at, at);
  };
  d.inject = () => page.evaluate(EDIT);
  d.goto = async function (q) {
    await page.goto(pathToFileURL(path).href + (q || o.query || ""), { waitUntil: "load" });
    await d.ready();
    if (o.edit !== false) await d.inject();
  };
  d.ready = () => page.waitForFunction(() => window.Kamishibai && Kamishibai.ready && document.querySelector(".tools .dock"));
  d.reload = async function () { await page.reload({ waitUntil: "load" }); await d.ready(); await d.inject(); };
  // the page rebuilt by page-edit, n builds in all (activation is the first)
  d.gen = () => page.evaluate(() => window.__pageEdit.gen);
  d.built = async function (n) {
    await page.waitForFunction(k => window.__pageEdit && __pageEdit.gen >= k && !__pageEdit.building && !__pageEdit.saving
      && document.querySelector(".sed-bar") && document.querySelector(".tools .sed-undo"), n);
  };
  d.rebuilt = async function (act) { const g = await d.gen(); await act(); await d.built(g + 1); };
  // the message line, then the note that stays until it is closed (when they are shown)
  d.msg = () => page.evaluate(function () {
    const m = document.querySelector(".sed-msg"), n = document.querySelector(".sed-note"), t = n && n.querySelector(".sed-note-text");
    return [m && m.style.display !== "none" ? m.textContent : "", n && n.style.display !== "none" && t ? t.textContent : ""].filter(Boolean).join(" ¦ ");
  });
  d.enter = async function () {
    if (await page.evaluate(() => document.body.classList.contains("sed-on"))) return;
    const g = await d.gen();
    await page.keyboard.press(KEY + "+e");
    await page.waitForFunction(() => document.body.classList.contains("sed-on"));
    if (!await page.evaluate(() => document.body.classList.contains("tools-open")))
      await page.evaluate(() => document.querySelector(".tools .handle").click());
  };
  d.leave = async function () {
    await page.keyboard.press(KEY + "+e");
    await page.waitForFunction(() => !document.body.classList.contains("sed-on"));
  };
  // the page shown, as in d.go
  d.on = () => page.evaluate(() => [].findIndex.call(document.querySelectorAll(".deck section.page"), s => s.classList.contains("on")) + 1);
  d.go = async n => { await page.evaluate(k => { location.hash = "#s" + k; }, n); await page.waitForFunction(k => location.hash === "#s" + k && document.querySelectorAll(".deck section.page")[k - 1].classList.contains("on"), n); };
  d.key = k => page.keyboard.press(k.replace("Mod", KEY));
  // open the text whose source contains old on the page shown, replace its whole source by neu
  const click = async function (old, sel) {
    const at = await page.evaluate(([t, s]) => {
      const el = [].find.call(document.querySelectorAll(s || ".page.on .sed-part, .page.on [data-sed]:not(.sed-parts), .page.on [data-sedt]:not(.sed-parts)"), e => e.textContent.includes(t) && e.getClientRects().length);
      if (!el) return null;
      const r = el.getClientRects()[0];
      return [r.left + Math.min(8, r.width / 2), r.top + r.height / 2];
    }, [old, sel]);
    if (!at) throw new Error("no editable text " + old);
    await page.mouse.click(at[0], at[1]);
    return page.waitForSelector(".sed-editing", { timeout: 1500 }).then(() => true, () => false);
  };
  // again when the page was laid out anew between the two (just after a build)
  d.start = async function (old, sel) {
    for (let k = 0; k < 4; k++) if (await click(old, sel)) return;
    throw new Error("the text does not open: " + old);
  };
  // key by key where it can be: insertText of several words over the whole of a heading loses the text (Chromium)
  d.type = async function (neu) { await page.keyboard.press(KEY + "+a"); await page.keyboard[neu.includes("\n") ? "insertText" : "type"](neu); };
  d.edit = async function (old, neu, sel) {
    await d.start(old, sel);
    const src = await page.evaluate(() => document.querySelector(".sed-editing").textContent);
    await d.type(src.replace(old, neu));
    await d.rebuilt(() => page.keyboard.press("Enter"));
  };
  d.undo = () => d.rebuilt(() => d.key("Mod+z"));
  d.redo = () => d.rebuilt(() => d.key("Mod+Shift+z"));
  d.lit = async () => page.evaluate(() => ["undo", "redo"].map(n => document.querySelector(".tools .sed-" + n).classList.contains("off") ? "-" : n).join(" "));
  await d.goto();
  return d;
}
