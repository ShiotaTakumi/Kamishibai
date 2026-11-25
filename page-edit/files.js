/* page-edit: reads and writes the drafts, in the extension's service worker.
   The page (edit.js) asks through bridge.js and gets texts, times and names, never a handle. It does not say which
   file either: that is the file of the page itself, sender.url, which Chrome fills in. So a page reaches its own
   draft (and NAME.dist.html beside it) and nothing else, and only when it lies in a folder the author allowed.

   Requests {op, ...} and what is answered, {ok} or {error: {name, message, conflict}}:
     open {ask, fresh, strict, when}  {text, mtime, size} | {none: true} | {wait: id, say}   (a window asks; see folder.js)
     front                            brings the window that asks to the front
     stat                             {mtime, size}
     read                             {text, mtime, size}
     write {text, was: {mtime, size}} {mtime}; was not what the file is now: a conflict {text, mtime}, nothing written
     export                           {name, size, noFont}
     dirs                             [{id, name}]
     forget {id}                      (null: all) */
"use strict";
importScripts("store.js");

// The source of the draft. A BOM stays in the text (file.text() drops it), so that a save writes it back.
// strict: a file that is not UTF-8 is refused, because writing it back would change its other bytes.
async function readText(file, strict) {
  const bytes = await file.arrayBuffer();   // a file that cannot be read fails with its own message
  try { return new TextDecoder("utf-8", { ignoreBOM: true, fatal: !!strict }).decode(bytes); }
  catch (e) { throw new Error("原稿の文字コードが UTF-8 ではないので、書き込めません"); }
}
const content = async function (fh, strict) {
  const f = await fh.getFile();
  return { text: await readText(f, strict), mtime: f.lastModified, size: f.size };
};
// The draft open in the page's tab, while its folder is allowed.
async function opened(c) {
  const at = await stored("open", c.tab);
  return at && at.path === c.path ? at : null;
}
async function current(c) {
  const at = await opened(c);
  if (!at || !await allowed(at.root)) throw named("NotAllowedError", "the folder is not allowed now");
  return at;
}
const setOpen = (c, at) => keep("open", c.tab, { path: c.path, root: at.root, dirs: at.dirs, name: at.name });

/* ===== Opening ===== */
async function open(c, m) {
  if (m.fresh) { await drop("open", c.tab); await unask(x => x.tab === c.tab); }
  const was = m.fresh ? null : await opened(c);
  if (was && await answer(allowed(was.root)).catch(() => false)) return content(await fileOf(was), m.strict);
  const ps = partsOf(c.url).slice(0, -1), kept = (await keptDirs()).filter(x => ps.indexOf(x.dir.name) >= 0);
  // A folder is read only once it is allowed: after Chrome is started again (or every window of the extension is
  // closed) a kept folder has to be allowed again, and reading it before that fails. Of all the allowed folders that
  // hold the page's file, the file whose date is nearest the page's.
  const state = await Promise.all(kept.map(x => answer(allowed(x.dir)).catch(e => e)));
  let best = null, dead = "";
  for (let i = 0; i < kept.length; i++) {
    if (state[i] === DEAD) dead = kept[i].dir.name;   // skipped for this load only; it stays in the list
    const f = state[i] === true ? await findIn(kept[i].dir, c.url, m.when) : null;
    if (f && (!best || f.gap < best.gap)) best = f;
  }
  if (best) { await setOpen(c, best); return content(await fileOf(best), m.strict); }
  if (!m.ask) return { none: true };
  return ask(c, m.when, kept.filter((x, i) => state[i] === false).map(x => x.id), dead);
}

/* ===== The window that asks for a folder =====
   The folder picker and Chrome's question need a click on a page of the extension's own, so a small window is opened. */
const front = id => chrome.windows.update(id, { focused: true, state: "normal" });
async function unask(which) {
  for (const x of (await storedAll("asks")).filter(which)) {
    await drop("asks", x.id);
    if (x.popup) await chrome.windows.remove(x.popup).catch(() => {});
  }
}
async function ask(c, when, kept, dead) {
  const name = kept.length && (await keptDirs()).find(x => x.id === kept[0]).dir.name;
  const say = name ? "フォルダ「" + name + "」の編集を許可する小窓を開きました。許可すると続けます"
    : dead ? "前に選んだフォルダ「" + dead + "」は、今の Chrome では使えなくなっています。開いた小窓でもう一度選ぶと続けます"
    : "原稿を含むフォルダを選ぶ小窓を開きました。フォルダを選ぶと続けます";
  const now = (await storedAll("asks")).find(x => x.tab === c.tab && x.url === c.url);
  if (now && await front(now.popup).then(() => true, () => false)) return { wait: now.id, say: say };
  await unask(x => x.tab === c.tab);
  const a = { id: crypto.randomUUID(), tab: c.tab, win: c.win, popup: null, url: c.url, when: when, kept: kept, dead: dead };
  await keep("asks", a.id, a);
  const W = 460, H = 420, o = { url: "folder.html#" + a.id, type: "popup", width: W, height: H, focused: true };
  const w = await chrome.windows.get(c.win).catch(() => null);
  if (w && w.width) { o.left = Math.max(0, Math.round(w.left + (w.width - W) / 2)); o.top = Math.max(0, Math.round(w.top + (w.height - H) / 3)); }
  const p = await chrome.windows.create(o);
  a.popup = p.id;
  if (await stored("asks", a.id)) await keep("asks", a.id, a);   // not when it has been answered already
  return { wait: a.id, say: say };
}
chrome.windows.onRemoved.addListener(async function (id) {
  const a = (await storedAll("asks")).find(x => x.popup === id);
  if (!a) return;
  await drop("asks", a.id);
  chrome.tabs.sendMessage(a.tab, { ask: a.id, done: false }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(async function (id) {
  await drop("open", id);
  await unask(x => x.tab === id);
});
chrome.runtime.onStartup.addListener(() => { drop("open"); drop("asks"); });
chrome.runtime.onInstalled.addListener(() => { drop("asks"); });

/* ===== Writing ===== */
async function write(c, m) {
  if (typeof m.text !== "string" || !m.was) throw new Error("bad request");
  const fh = await fileOf(await current(c)), now = await fh.getFile();
  if (now.lastModified !== m.was.mtime || now.size !== m.was.size) {
    const e = new Error("原稿が先に変わっていました");
    e.conflict = { text: await readText(now), mtime: now.lastModified };
    throw e;
  }
  const w = await fh.createWritable();
  await w.write(m.text);
  await w.close();
  return { mtime: (await fh.getFile()).lastModified };
}

/* ===== One HTML file, as make pack (tools/pack_engine.py) does it, written next to the draft as NAME.dist.html =====
   Through the allowed folder: the engine's files are read from it, so the engine has to be inside that folder.
   Unlike make pack, the math is not rendered beforehand (KaTeX itself goes in), the fonts are not cut down to
   the characters used, and the checks of boxes and figures do not run. */
const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescape = t => t.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, function (all, hex, dec, name) {
  const n = hex ? parseInt(hex, 16) : dec ? +dec : 0;
  return n ? (n <= 0x10ffff ? String.fromCodePoint(n) : all) : ENTITY[name] || all;
});
async function replaceAsync(str, re, fn) {
  const parts = [], ms = [];
  let at = 0;
  str.replace(re, function () {
    const a = [].slice.call(arguments), m = a[0], off = a[a.length - 2];
    parts.push(str.slice(at, off)); ms.push(a); at = off + m.length; return m;
  });
  const done = await Promise.all(ms.map(a => fn.apply(null, a)));
  let out = "";
  parts.forEach((t, k) => { out += t + done[k]; });
  return out + str.slice(at);
}
async function exportHTML(c, m) {
  const r = await open(c, m);   // asks for the folder when it is not allowed now
  if (r.wait || r.none) return r;
  const at = await current(c), text = await (await (await fileOf(at)).getFile()).text();
  // what the comments hide is not read (a reference in a comment stays as it is); same offsets as text
  const COMMENT = /<!--[\s\S]*?-->/g, seen = text.replace(COMMENT, q => " ".repeat(q.length));
  const decode = q => { try { return decodeURIComponent(q); } catch (e) { return q; } };   // a "%" of the name itself
  const join = function (dirs, ref) {
    const out = dirs.slice();
    ref.split("/").forEach(function (q) {
      if (!q || q === ".") return;
      if (q !== "..") { out.push(decode(q)); return; }
      if (!out.length) throw new Error("許可したフォルダ「" + at.root.name + "」の外のファイルです：" + ref);
      out.pop();
    });
    return out;
  };
  const get = async function (parts) {
    try { return await (await (await dirOf(at.root, parts.slice(0, -1))).getFileHandle(parts[parts.length - 1])).getFile(); }
    catch (e) { throw new Error("ファイルがありません：" + parts.join("/")); }
  };
  const read = async parts => (await get(parts)).text();
  const has = async parts => { try { await get(parts); return true; } catch (e) { return false; } };
  const tag = /<script\b[^>]*\ssrc=(["'])([^"']*?)kamishibai\.js\1[^>]*>\s*<\/script\s*>/i.exec(seen);
  if (!tag) throw new Error("この原稿には kamishibai.js の読み込みがありません");
  const eng = join(at.dirs, unescape(tag[2] || "./"));
  const t = /<html\b[^>]*\stheme=(["']?)([A-Za-z]+)\1/i.exec(seen), theme = t ? t[2] : "Boadilla";
  if (!await has(eng.concat("themes", theme + ".css"))) throw new Error("テーマがありません：" + theme);
  // a file beside the draft: not a URL with a scheme, not "#…", not a path from the top ("/…" stays as it is);
  // "?…" and "#…" after the name are not part of the file's name
  const local = function (ref) {
    ref = unescape(ref).trim();
    if (/^(?:[a-z][\w+.-]*:|[#\/?\\])/i.test(ref)) return null;
    ref = ref.replace(/[?#][\s\S]*$/, "");
    return ref ? join(at.dirs, ref) : null;
  };
  const dataURI = f => new Promise(function (ok, no) {
    const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(f);
  });
  // each pattern starts with a comment, which is given back unchanged
  const inline = async function (src) {
    src = await replaceAsync(src, /<!--[\s\S]*?-->|(<(?:img|qr|image|source)\b[^>]*?\s(?:src|href|xlink:href)=)(["'])([^"']*)\2/gi,
      async function (all, a, qt, ref) { const q = a && local(ref); return q ? a + qt + await dataURI(await get(q)) + qt : all; });
    src = await replaceAsync(src, /<!--[\s\S]*?-->|<script\b[^>]*?\ssrc=(["'])([^"']*)\1[^>]*>\s*<\/script\s*>/gi,
      async function (all, qt, ref) { const q = qt && local(ref); return q ? "<script>" + (await read(q)).replace(/<\/script/gi, "<\\/script") + "<\/script>" : all; });
    return replaceAsync(src, /<!--[\s\S]*?-->|<link\b[^>]*>/gi, async function (all) {
      if (/^<!--/.test(all) || !/rel=["']?stylesheet/i.test(all)) return all;
      const h = /href=(["'])([^"']*)\1/i.exec(all), q = h && local(h[2]);
      return q ? "<style>" + (await read(q)).replace(/<\/style/gi, "<\\/style") + "</style>" : all;
    });
  };
  let head = text.slice(0, tag.index), tail = text.slice(tag.index + tag[0].length);
  head = head.replace(/(<html\b[^>]*\stheme=)(["']?)[A-Za-z]+\2/i, (all, a) => a + '"' + theme + '"');
  const own = /<script\b/i.test(seen.slice(0, tag.index) + seen.slice(tag.index + tag[0].length));
  head = await inline(head); tail = await inline(tail);
  const fontFiles = { Madrid: ["fonts/ipa-pgothic.css", "fonts/cm-sans.css"] }[theme] || ["fonts/kamishibai-fonts.css"];
  let fonts = "", noFont = [];
  for (const f of fontFiles) {
    const q = eng.concat(f.split("/"));
    if (await has(q)) fonts += await read(q) + "\n"; else noFont.push(f);
  }
  const style = css => "<style data-kamishibai>\n" + css.replace(/\n+$/, "").replace(/<\/style/gi, "<\\/style") + "\n</style>\n";
  const script = (code, attr) => "<script" + (attr || "") + ">\n" + code.replace(/\n+$/, "").replace(/<\/script/gi, "<\\/script") + "\n<\/script>\n";
  const name = at.name.replace(/\.html?$/i, "");
  const block = "<!-- Packed from " + at.name + " by page-edit (theme " + theme + "). Edit the draft, not this file. -->\n"
    + style(await read(eng.concat("katex", "katex.css"))) + (fonts ? style(fonts) : "")
    + style(await read(eng.concat("base.css"))) + style(await read(eng.concat("themes", theme + ".css")))
    + script(await read(eng.concat("kamishibai.js")), ' data-packed="' + theme + '"')
    + script(await read(eng.concat("katex", "katex.js")))
    + (own ? script(await read(eng.concat("figure.js"))) : "");
  const out = head + block.replace(/\n+$/, "") + tail;
  const w = await (await (await dirOf(at.root, at.dirs)).getFileHandle(name + ".dist.html", { create: true })).createWritable();
  await w.write(out);
  await w.close();
  return { name: name, size: new Blob([out]).size, noFont: noFont };
}

/* ===== Requests ===== */
const OPS = {
  open: open,
  front: async function (c) {
    for (const x of (await storedAll("asks")).filter(x => x.tab === c.tab)) await front(x.popup).catch(() => {});
    return {};
  },
  stat: async function (c) {
    const f = await (await fileOf(await current(c))).getFile();
    return { mtime: f.lastModified, size: f.size };
  },
  read: async (c, m) => content(await fileOf(await current(c)), m.strict),
  write: write,
  export: exportHTML,
  dirs: async () => (await keptDirs()).map(x => ({ id: x.id, name: x.dir.name })),
  forget: async function (c, m) { await forgetDir(m.id === undefined ? "" : m.id); return {}; }
};
// The requests of one tab, one after another.
const last = new Map();
function inTurn(tab, run) {
  const p = (last.get(tab) || Promise.resolve()).then(run, run);
  const tail = p.catch(() => {}).then(() => { if (last.get(tab) === tail) last.delete(tab); });
  last.set(tab, tail);
  return p;
}
chrome.runtime.onMessage.addListener(function (m, s, reply) {
  // only the page in the tab itself (no frame in it), opened from file://
  if (s.id !== chrome.runtime.id || !s.tab || s.frameId !== 0 || !/^file:/.test(s.url || "")) return false;
  if (!m || !Object.hasOwn(OPS, m.op)) return false;
  const url = s.url.replace(/[?#][\s\S]*$/, "");
  const c = { tab: s.tab.id, win: s.tab.windowId, url: url, path: new URL(url).pathname };
  inTurn(c.tab, () => OPS[m.op](c, m)).then(ok => reply({ ok: ok }),
    e => reply({ error: { name: (e && e.name) || "", message: String((e && e.message) || e), conflict: e && e.conflict } }));
  return true;
});
