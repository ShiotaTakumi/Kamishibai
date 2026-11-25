// page-edit as the real extension in a real browser: run `node test/extension-test.mjs` in tools/. A folder picker
// cannot be driven by a test, so the folder is dropped on the extension's window (Chrome then hands out the same kind
// of handle) and given back by showDirectoryPicker; the browser's questions are answered by a setting of the profile.
// Everything else is real: the extension's parts, its storage, its window, the folder and the files.
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, run, eq, ok, KEY, ROOT } from "./harness.mjs";

const ID = "ffghpaoabifdechnglinhlknnlgiadch";   // from the key in manifest.json
const EXT = join(ROOT, "page-edit");
// what a script of a page can do by itself, before anything is clicked. A draft in an allowed folder is built again as
// soon as it is opened, and the script runs again in the same window, where the bridge takes no new port: what the first
// run began stays, and its port with it
const ATTEMPT = `<script>
if (!window.tried) {
  const c = new MessageChannel(), waiting = new Map();
  const port = new Promise(function (ok) {
    c.port1.onmessage = function (e) {
      const d = e.data;
      if (d.hello) ok(c.port1); else if (!d.say) { waiting.get(d.id)(d); waiting.delete(d.id); }
    };
  });
  postMessage({ pageEdit: "link" }, "*", [c.port2]);
  let n = 0;
  window.request = req => new Promise(async function (done) {
    setTimeout(() => done({ timeout: true }), 10000);
    const p = await port, id = ++n;
    waiting.set(id, done);
    p.postMessage({ id: id, req: req });
  });
  window.tried = Promise.all([{ op: "dirs" }, { op: "forget", id: null }, { op: "export", ask: true }, { op: "open", ask: true, fresh: true }].map(request));
}
<\/script>`;
const doc = (text, more = "") => `<!DOCTYPE html>
<html lang="ja" theme="Boadilla"><head><meta charset="utf-8"><title>t</title>
<script src="engine/kamishibai.js"></script>${more}
</head><body>
<slide title="s" sec="一"><p>${text}</p></slide>
</body></html>
`;

async function chrome(fn) {
  const dir = mkdtempSync(join(tmpdir(), "kamishibai-test-")), prof = mkdtempSync(join(tmpdir(), "kamishibai-prof-"));
  const root = join(dir, "project");
  mkdirSync(root);
  symlinkSync(join(ROOT, "engine"), join(root, "engine"));
  mkdirSync(join(prof, "Default"));
  writeFileSync(join(prof, "Default", "Preferences"), JSON.stringify({ profile: { content_settings: { exceptions: {
    file_system_write_guard: { ["chrome-extension://" + ID + "/,*"]: { setting: 1, last_modified: "13300000000000000" } } } } } }));
  const ctx = await chromium.launchPersistentContext(prof, { channel: "chromium", headless: true, viewport: { width: 1280, height: 720 },
    args: ["--disable-extensions-except=" + EXT, "--load-extension=" + EXT] });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const h = { ctx, sw, dir, root };
    h.show = async function (name, text, page) {
      if (text) writeFileSync(join(root, name), text);
      page = page || await ctx.newPage();
      await page.goto(pathToFileURL(join(root, name)).href);
      await page.waitForFunction(() => window.Kamishibai && Kamishibai.ready && window.__pageEdit);
      return page;
    };
    // press the keys on the page and wait for the extension's window
    h.asked = async function (act) {
      const w = ctx.waitForEvent("page", { timeout: 8000 });
      await act();
      const win = await w;
      await win.waitForLoadState();
      await win.waitForSelector("#buttons button");
      return win;
    };
    // the folder for the picker of the extension's window
    h.give = async function (win, path) {
      await win.evaluate(() => {
        window.showDirectoryPicker = () => got;
        window.got = new Promise(ok => {
          addEventListener("dragover", e => e.preventDefault());
          addEventListener("drop", e => { e.preventDefault(); ok(e.dataTransfer.items[0].getAsFileSystemHandle()); });
        });
      });
      const cdp = await ctx.newCDPSession(win), data = { items: [], files: [path], dragOperationsMask: 1 };
      for (const type of ["dragEnter", "dragOver", "drop"]) await cdp.send("Input.dispatchDragEvent", { type, x: 50, y: 50, data });
    };
    h.on = page => page.waitForFunction(() => document.body && document.body.classList.contains("sed-on") && !__pageEdit.building && !__pageEdit.asking && document.querySelector(".sed-bar"));
    h.edit = async function (page, old, neu) {
      await page.locator(".page.on [data-sed], .page.on .sed-part").filter({ hasText: old }).first().click();
      await page.waitForSelector(".sed-editing");
      await page.keyboard.press(KEY + "+a");
      await page.keyboard.type(neu);
      await page.keyboard.press("Enter");
    };
    h.until = async function (name, text) {
      for (let k = 0; k < 50 && readFileSync(join(root, name), "utf8") !== text; k++) await new Promise(r => setTimeout(r, 100));
      eq(readFileSync(join(root, name), "utf8"), text, name);
    };
    await fn(h);
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(prof, { recursive: true, force: true });
  }
}

test("a folder chosen in the extension's window: the draft is edited, the window stays minimized, the next draft is not asked for", () => chrome(async h => {
  const a = await h.show("a.html", doc("first"));
  const win = await h.asked(() => a.keyboard.press(KEY + "+e"));
  ok((await win.textContent("body")).includes("a.html"), "the window names the draft");
  await h.give(win, h.root);
  await win.click("button.main");
  await h.on(a);
  await h.edit(a, "first", "second");
  await h.until("a.html", doc("second"));
  eq(await h.sw.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ["popup"] })).map(w => w.state).join()), "minimized");
  // the empty page of the extension that keeps it awake, once and unseen, also after the rebuilds
  const awake = async p => { await p.waitForTimeout(2500); return p.frames().map(f => f.url()).filter(u => /^chrome-ext/.test(u)).join(); };
  eq(await awake(a), `chrome-extension://${ID}/awake.html`, "while editing");
  await h.edit(a, "second", "third");
  await h.until("a.html", doc("third"));
  eq(await awake(a), `chrome-extension://${ID}/awake.html`, "after a save");
  eq(await a.evaluate(() => { const f = document.querySelector("html > iframe"), c = getComputedStyle(f); return [f.tabIndex, f.ariaHidden, c.position, c.opacity, c.pointerEvents, f.offsetWidth].join(); }), "-1,true,fixed,0,none,1");

  const b = await h.show("b.html", doc("other"));
  await b.keyboard.press(KEY + "+e");
  await h.on(b);
  await h.edit(b, "other", "more");
  await h.until("b.html", doc("more"));
  eq(h.ctx.pages().filter(p => p.url().startsWith("chrome-extension:")).length, 1, "windows of the extension");

  // closed with its drafts
  await a.close(); await b.close();
  await h.ctx.newPage();
  await win.waitForEvent("close", { timeout: 35000 });
}));

test("the window closed: the next save asks again and loses nothing", () => chrome(async h => {
  const a = await h.show("a.html", doc("first"));
  let win = await h.asked(() => a.keyboard.press(KEY + "+e"));
  await h.give(win, h.root);
  await win.click("button.main");
  await h.on(a);
  await win.close();
  await a.waitForTimeout(1500);   // Chrome takes the permission back
  win = await h.asked(() => h.edit(a, "first", "second"));
  eq(readFileSync(join(h.root, "a.html"), "utf8"), doc("first"), "nothing written yet");
  ok((await win.textContent("button.main")).includes("project"), "the kept folder is offered");
  await h.give(win, h.root);
  await win.getByText("別のフォルダを選ぶ").click();
  await h.until("a.html", doc("second"));
}));

test("a folder without the draft is not taken; the window closed without an answer leaves the page as it was", () => chrome(async h => {
  const a = await h.show("a.html", doc("first"));
  mkdirSync(join(h.dir, "x", "project"), { recursive: true });
  writeFileSync(join(h.dir, "x", "project", "a.html"), doc("a copy"));   // same folder name, another draft
  const win = await h.asked(() => a.keyboard.press(KEY + "+e"));
  await h.give(win, join(h.dir, "x", "project"));
  await win.click("button.main");
  await win.waitForFunction(() => /ありません/.test(document.getElementById("say").textContent));
  await win.close();
  await a.waitForFunction(() => !__pageEdit.asking);
  ok(!await a.evaluate(() => document.body.classList.contains("sed-on")), "not editing");
  await h.asked(() => a.keyboard.press(KEY + "+e"));   // and it can be asked again
}));

test("a script of the page gets no handle, no other file, no list, and shows no window", () => chrome(async h => {
  const a = await h.show("a.html", doc("first"));
  const win = await h.asked(() => a.keyboard.press(KEY + "+e"));
  await h.give(win, h.root);
  await win.click("button.main");
  await h.on(a);

  const b = await h.show("b.html", doc("other", ATTEMPT)), n = h.ctx.pages().length;
  const tried = await b.evaluate(() => tried);
  ok(tried.slice(0, 3).every(x => x.error), JSON.stringify(tried));
  eq(h.ctx.pages().length, n, "windows");
  eq(await h.sw.evaluate(async () => (await keptDirs()).length), 1, "the folders kept");
  // it reaches its own draft, whatever it says about another
  const url = pathToFileURL(join(h.root, "a.html")).href;
  const r = await b.evaluate(u => request({ op: "read", url: u, path: new URL(u).pathname, name: "a.html", tab: 1, dirs: [] }), url);
  eq(r.ok && r.ok.text, doc("other", ATTEMPT), "its own draft");
  eq(r.error, undefined);
  // before a folder is allowed for it, nothing: a draft outside
  writeFileSync(join(h.dir, "out.html"), doc("out", ATTEMPT).replace("engine/", "project/engine/"));
  await b.goto(pathToFileURL(join(h.dir, "out.html")).href);
  const o = await b.evaluate(() => Promise.all([{ op: "read" }, { op: "write", text: "x", was: {} }].map(request)));
  ok(o.every(x => x.error && x.error.name === "NotAllowedError"), JSON.stringify(o));
  await b.waitForFunction(() => !document.querySelector("html > iframe"));   // and it keeps nothing of the extension

  await b.goto(pathToFileURL(join(h.root, "b.html")).href);
  await b.waitForFunction(() => window.__pageEdit);
  for (const p of [a, b]) {
    eq(JSON.stringify(await p.evaluate(async () => (await indexedDB.databases()).map(x => x.name))), "[]", "databases");
    // nothing reachable from what page-edit leaves in the page is a handle
    eq(await p.evaluate(function () {
      const seen = new Set(), todo = [__pageEdit];
      let n = 0;
      while (todo.length) {
        const x = todo.pop();
        if (!x || (typeof x !== "object" && typeof x !== "function") || seen.has(x) || x === window || x instanceof Node) continue;
        seen.add(x);
        if (x instanceof FileSystemHandle) n++;
        if (x instanceof Map || x instanceof Set) for (const y of x) todo.push(y);
        for (const k of Reflect.ownKeys(x)) { try { todo.push(x[k]); } catch (e) { /* a getter of another object */ } }
      }
      return n;
    }), 0, "handles");
    eq(await p.evaluate(u => fetch(u).then(() => "read", () => "refused"), `chrome-extension://${ID}/store.js`), "refused");
    eq(await p.evaluate(() => typeof window.chrome + " " + (window.chrome && typeof chrome.runtime)), "object undefined", "chrome.runtime");
  }
  // a frame in the page has no way in
  const f = await b.evaluate(() => new Promise(function (done) {
    const x = document.createElement("iframe");
    x.srcdoc = "<script>const c = new MessageChannel(); c.port1.onmessage = () => parent.postMessage('answered', '*');"
      + "parent.postMessage({ pageEdit: 'link' }, '*', [c.port2]); postMessage({ pageEdit: 'link' }, '*', [new MessageChannel().port2]);<\/script>";
    addEventListener("message", e => { if (e.data === "answered") done("answered"); });
    setTimeout(() => done("nothing"), 1500);
    document.body.appendChild(x);
  }));
  eq(f, "nothing");
}));

test("a page's own storage of 3.11 is removed", () => chrome(async h => {
  const a = await h.show("a.html", doc("first"));
  await a.evaluate(() => new Promise((ok, no) => {
    const r = indexedDB.open("page-edit", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("dirs").put("x", "list");
    r.onsuccess = () => { r.result.close(); ok(); };
    r.onerror = no;
  }));
  await a.reload();
  await a.waitForFunction(async () => window.__pageEdit && !(await indexedDB.databases()).length);
}));

run(process.argv[2]);
