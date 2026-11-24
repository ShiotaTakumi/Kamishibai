/* page-edit (formerly slide-edit): edit the text of a WebSlide slide or a draft of the Kamishibai engine (kamishibai.js) in the
   browser and write it back to the source HTML. A file packed by make pack (NAME.dist.html) is not edited:
   edit the draft it was made from.
   No server and no app: open the slide as a local file (file://) in a Chromium-based browser.
   Loaded by the page-edit extension (a content script on file:// pages). Reading and writing use the browser's File System Access API: the author allows, once, a folder
   that holds the draft (the project folder or one above it), and every draft below an allowed folder opens without
   choosing anything again.
   The slide itself is not changed in any other way and still opens in any browser.

   How it works
   - Engines with the three-mode panel (Kamishibai.setEditor): page-edit adds no button or key of its own. It hands the
     engine {enter, leave, exportHTML}; the engine's heading "編集 ⌘E" enters edit mode, its "出力" mode calls
     exportHTML for "HTML：1 ファイル" (NAME.dist.html next to the draft, in the order of pack_engine.py's pack(),
     read through the allowed folder; fonts are not subset and KaTeX is whole, and pack's checks are not run).
   - Older engines without the three modes (and WebSlide): page-edit puts its own "Edit ⌘E" button in the tool
     panel and takes ⌘E itself; where the engine still uses ⌘E for its select mode, ⌘E switches both together.
   - Also editable: text written straight in a slide (e.g. display math after a list), the attributes title,
     cite, label, short, and aff and sec (a name in several places: editing one rewrites every place with that
     name). A footer item without short="…" goes to the cover and edits the text it is taken from.
   - Activation: entering edit mode finds the draft inside an allowed folder (or asks for a folder, remembered in
     IndexedDB), then rebuilds the page from that source.
   - Rebuild: document.open/write the source with this script inserted before the engine, so that mark()
     runs before the engine's build() and every editable text segment is wrapped in <span data-sed=i>.
   - Save: re-read the file, check that the span still holds the old source, write, and rebuild.
   - The file is polled every second; a change made elsewhere (editor, AI) rebuilds the page.

   In edit mode every editable text shows its source (TeX, inline tags) and pages do not turn on click.
   click        edit that text (in edit mode)
   Enter        save            Shift+Enter  newline         Esc  cancel
   Cmd+E        leave edit mode (saves the text being edited); any tool of the show mode, or Cmd+P, leaves it too */
(function slideEdit() {
  "use strict";
  const S = window.__slideEdit || (window.__slideEdit = { gen: 0, edit: false });

  // WebSlide's tags, and the Kamishibai components (subtitle, proof, plan, later)
  const EDITABLE = ["p", "item", "note", "down", "headline", "subtitle", "author", "meeting", "date", "figcaption",
                    "td", "th", "block", "alertblock", "exampleblock", "divider", "column", "proof", "plan", "later"];
  // Child elements that end the editable text segment of their parent.
  const BLOCKS = new Set(["list", "item", "p", "block", "alertblock", "exampleblock", "note", "down", "columns",
                          "column", "figure", "table", "svg", "div", "img", "script", "style", "headline", "author",
                          "meeting", "date", "qr", "ul", "ol", "subtitle", "proof", "plan", "later", "nums",
                          "side", "flip", "switch", "button"]);
  const TITLED = ["slide", "block", "alertblock", "exampleblock", "proof", "plan", "later"];
  // Elements whose text runs are editable: the EDITABLE ones, and a slide (text written straight in it).
  const CONTAINER = new Set(EDITABLE.concat(["slide"]));
  // Editable attributes. all: one name used in several places (a section, an institute); editing one rewrites all.
  // short: what the footer shows instead of the cover's text.
  const ATTRS = [
    { attr: "title", tags: TITLED, all: false },
    { attr: "cite", tags: ["block", "alertblock", "exampleblock"], all: false },
    { attr: "aff", tags: ["author"], all: true },
    { attr: "sec", tags: ["slide"], all: true },
    { attr: "short", tags: ["author", "headline", "date"], all: false },
    { attr: "label", tags: ["item"], all: false }
  ];
  const VOID = new Set(["br", "img", "input", "wbr", "hr", "meta", "link", "source", "col", "area", "base", "embed", "track"]);
  const RAW = new Set(["script", "style"]);
  const WEBSLIDE_RE = /<script[^>]*(?:webslide|kamishibai)\.js[^>]*>/i;   // WebSlide, or its derived Kamishibai engine
  const EDIT_KEY = "slide-edit-on:" + location.pathname;   // edit mode survives a reload of the tab
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);    // as WebSlide decides between Cmd and Ctrl
  const mod = e => (MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
  // Edit mode has its own key, Cmd+E (Ctrl+E elsewhere). The engine's select mode is Cmd+I; an older engine
  // (and WebSlide) has it on Cmd+E too, read from its "Select ⌘X" button. Synthetic presses (pressSelect) are skipped.
  const selectCode = function () {
    const b = [].find.call(document.querySelectorAll(".tools button"), x => /^(?:Select|選択)\s/.test(x.textContent));
    const m = b && /([A-Z])\s*$/.exec(b.textContent);
    return "Key" + (m ? m[1] : "E");
  };
  const isSelectKey = e => mod(e) && e.code === selectCode();
  const isEditKey = e => mod(e) && e.code === "KeyE" && e.isTrusted;
  const EDIT_KEY_LABEL = MAC ? "⌘E" : "Ctrl+E";

  /* ===== Source parser: offsets of editable text segments and attribute values, in document order =====
     An element of EDITABLE (or a slide) holds one text segment per run of its content between BLOCKS children:
     the run before the first block, between two blocks, and after the last one (display math written straight
     in a slide, after a list, is such a run). Each segment is {tag, el, k, start, end}: el counts the elements in
     document order, k the runs of that element. Attribute values in ATTRS are {tag, attr, all, start, end}. */
  function parse(text) {
    const spans = [], els = [], attrs = [], stack = [];
    const START = /<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/y;
    const END = /<\/([a-zA-Z][^\s>]*)\s*>/y;
    const ATTR = /\s([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/dg;
    const open = (e, at) => { e.idx = spans.length; spans.push({ tag: e.tag, el: e.el, k: e.k++, start: at, end: null }); };
    const shut = (e, at) => { if (e.idx !== null) { spans[e.idx].end = at; e.idx = null; } };
    const top = () => stack[stack.length - 1];
    let i = 0;
    while (true) {
      i = text.indexOf("<", i);
      if (i < 0) break;
      if (text.startsWith("<!--", i)) {
        const j = text.indexOf("-->", i + 4);
        i = j < 0 ? text.length : j + 3;
        continue;
      }
      if (text[i + 1] === "!" || text[i + 1] === "?") {
        const j = text.indexOf(">", i);
        i = j < 0 ? text.length : j + 1;
        continue;
      }
      END.lastIndex = i;
      let m = END.exec(text);
      if (m) {
        const tag = m[1].toLowerCase();
        i += m[0].length;
        if (stack.some(e => e.tag === tag)) {
          while (stack.length) {
            const e = stack.pop();
            shut(e, i - m[0].length);
            if (e.tag === tag) break;
          }
          // back in an element whose run a block child ended: the next run starts here
          const p = top();
          if (p && p.el !== null && p.idx === null) open(p, i);
        }
        continue;
      }
      START.lastIndex = i;
      m = START.exec(text);
      if (!m) { i++; continue; }
      const raw = m[0], tag = m[1].toLowerCase(), selfClose = /\/\s*>$/.test(raw), after = i + raw.length;
      const p = top(), block = BLOCKS.has(tag);
      if (p && p.el !== null && block) shut(p, i);
      ATTR.lastIndex = 0;
      const body = m[2].replace(/\/\s*$/, "");
      let a;
      while ((a = ATTR.exec(body))) {
        const name = a[1].toLowerCase(), spec = ATTRS.find(x => x.attr === name && x.tags.indexOf(tag) >= 0);
        if (!spec) continue;
        const g = a[2] !== undefined ? 2 : a[3] !== undefined ? 3 : a[4] !== undefined ? 4 : 0;
        const off = i + 1 + m[1].length;   // where m[2] starts in text
        const at = g ? a.indices[g] : [a.indices[1][1], a.indices[1][1]];
        attrs.push({ tag: tag, attr: name, all: spec.all, start: off + at[0], end: off + at[1], bare: g === 4, none: !g });
      }
      if (RAW.has(tag) && !selfClose) {
        const close = text.toLowerCase().indexOf("</" + tag, after);
        i = close < 0 ? text.length : close;   // the end tag is read on the next turn
        stack.push({ tag: tag, el: null, idx: null });
        continue;
      }
      i = after;
      if (VOID.has(tag) || selfClose) {
        if (p && p.el !== null && block && p.idx === null) open(p, after);
        if (CONTAINER.has(tag)) { els.push(tag); const e = { tag: tag, el: els.length - 1, idx: null, k: 0 }; open(e, after); shut(e, after); }
        continue;
      }
      const e = { tag: tag, el: null, idx: null, k: 0 };
      if (CONTAINER.has(tag)) { els.push(tag); e.el = els.length - 1; open(e, after); }
      stack.push(e);
    }
    spans.forEach(s => { if (s.end === null) s.end = s.start; });
    return { spans: spans, els: els, attrs: attrs };
  }
  S.parse = parse;   // exposed for checks from the console

  /* ===== File access (File System Access API) ===== */
  // The author allows a folder once (one that holds the open draft, e.g. the project folder); the folders
  // are kept in IndexedDB, so every draft below an allowed folder opens without choosing anything again.
  function idb(mode, fn) {
    return new Promise(function (resolve, reject) {
      const r = indexedDB.open("slide-edit", 3);
      // A tab that still runs an older copy of this script can hold the store: work without the kept folders then.
      const late = setTimeout(() => reject(new Error("the store of kept folders does not answer")), 1500);
      r.onblocked = () => { clearTimeout(late); reject(new Error("the store of kept folders is in use by an older tab")); };
      r.onupgradeneeded = function () {
        if (r.result.objectStoreNames.contains("handles")) r.result.deleteObjectStore("handles");   // files picked one by one (before 2026-11-23)
        if (!r.result.objectStoreNames.contains("dirs")) r.result.createObjectStore("dirs");
      };
      r.onerror = () => { clearTimeout(late); reject(r.error); };
      r.onsuccess = function () {
        clearTimeout(late);
        const db = r.result;
        db.onversionchange = () => db.close();   // never in the way of a newer copy of this script
        let tx, q;
        try { tx = db.transaction("dirs", mode); q = fn(tx); }
        catch (e) { db.close(); reject(e); return; }
        tx.oncomplete = () => { db.close(); resolve(q && q.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const DIRS = "list";
  async function keptDirs() {
    try { return (await idb("readonly", tx => tx.objectStore("dirs").get(DIRS))) || []; }
    catch (e) { return []; }
  }
  async function keepDir(d) {
    const list = await keptDirs(), out = [d];
    for (const x of list) { try { if (!(await x.isSameEntry(d))) out.push(x); } catch (e) { /* stale handle */ } }
    try { await idb("readwrite", tx => tx.objectStore("dirs").put(out, DIRS)); } catch (e) { /* storage unavailable */ }
  }
  // the open file inside folder d: d's name is one of the folders on the page's path, and the rest of the path
  // leads from there to the file (when d's name occurs more than once, the file nearest the page's own date wins)
  async function findIn(d) {
    const ps = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const want = Date.parse(document.lastModified);
    let best = null, gap = Infinity;
    for (let i = 0; i < ps.length - 1; i++) {
      if (ps[i] !== d.name) continue;
      try {
        let h = d;
        for (let j = i + 1; j < ps.length - 1; j++) h = await h.getDirectoryHandle(ps[j]);
        const fh = await h.getFileHandle(ps[ps.length - 1]);
        const g = isNaN(want) ? 0 : Math.abs((await fh.getFile()).lastModified - want);
        // where it is inside d: the folders from d down to the draft (exportHTML reads the engine through d)
        if (g < gap) { best = fh; gap = g; fh.__loc = { root: d, dirs: ps.slice(i + 1, ps.length - 1) }; }
      } catch (e) { /* not this one */ }
    }
    return best;
  }
  // ask: called from a click or key (may show Chrome's prompt or the folder picker); else only a granted folder
  async function allowed(h, ask) {
    if (!h.queryPermission) return true;
    const o = { mode: "readwrite" };
    if (await h.queryPermission(o) === "granted") return true;
    return ask && await h.requestPermission(o) === "granted";
  }
  async function getHandle(ask) {
    if (ask === undefined) ask = true;
    if (S.handle && await allowed(S.handle, ask)) return S.handle;
    const above = location.pathname.split("/").filter(Boolean).slice(0, -1).map(decodeURIComponent);
    const kept = (await keptDirs()).filter(d => above.indexOf(d.name) >= 0);
    // A folder is read only once it is allowed: after Chrome is started again (or every tab of the folder is closed)
    // a kept folder has to be allowed again, and reading it before that fails. Allowed ones first, then ask.
    const asked = [];
    for (const d of kept) {
      try {
        if (!await allowed(d, false)) { asked.push(d); continue; }
        const fh = await findIn(d);
        if (fh) return fh;
      } catch (e) { /* folder moved: try the next */ }
    }
    if (!ask) return null;
    for (const d of asked) {
      msg("フォルダ「" + d.name + "」の編集を許可するか、Chrome が確認しています。許可すると編集が始まります");
      try { if (!await allowed(d, true)) throw new Error("フォルダ「" + d.name + "」の編集が許可されませんでした"); }
      catch (e) {
        if (e.name === "NotFoundError" || e.name === "SecurityError") continue;   // folder moved, or the click is too long ago
        throw e;
      }
      const fh = await findIn(d).catch(() => null);
      if (fh) return fh;
    }
    if (!window.showDirectoryPicker) {
      throw new Error("このブラウザは原稿への書き込みに対応していません。Chrome・Edge・Brave など Chromium 系のブラウザで開いてください");
    }
    msg("原稿を含むフォルダを選ぶ画面を開いています。フォルダを選ぶと編集が始まります");
    const d = await showDirectoryPicker({ id: "page-edit", mode: "readwrite" });
    msg("フォルダ「" + d.name + "」の編集を許可するか、Chrome が確認しています。許可すると編集が始まります");
    const fh = await findIn(d);
    const here = decodeURIComponent(location.pathname.split("/").pop());
    if (!fh) throw new Error("選んだフォルダ「" + d.name + "」の中に、開いている " + here + " がありません。この下書きを含むフォルダを選んでください");
    if (!await allowed(d, true)) throw new Error("書き込みが許可されませんでした");
    await keepDir(d);
    return fh;
  }

  /* ===== One HTML file, as make pack (tools/pack_engine.py) does it, written next to the draft as NAME.dist.html =====
     Through the allowed folder: the engine's files are read from it, so the engine has to be inside that folder.
     Unlike make pack, the math is not rendered beforehand (KaTeX itself goes in), the fonts are not cut down to
     the characters used, and the checks of boxes and figures do not run. */
  const unescape = function (t) { const x = document.createElement("textarea"); x.innerHTML = t; return x.value; };
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
  async function exportHTML() {
    try {
      msg("HTML を作っています…");
      const fh = await getHandle(true), loc = fh.__loc;
      if (!loc) throw new Error("許可したフォルダの中での原稿の場所がわかりません。一度ページを開き直してください");
      const text = await (await fh.getFile()).text();
      const join = function (dirs, ref) {
        const out = dirs.slice();
        ref.split("/").forEach(function (q) {
          if (!q || q === ".") return;
          if (q !== "..") { out.push(decodeURIComponent(q)); return; }
          if (!out.length) throw new Error("許可したフォルダ「" + loc.root.name + "」の外のファイルです：" + ref);
          out.pop();
        });
        return out;
      };
      const dirOf = async function (parts) { let h = loc.root; for (const q of parts) h = await h.getDirectoryHandle(q); return h; };
      const get = async function (parts) {
        try { return await (await (await dirOf(parts.slice(0, -1))).getFileHandle(parts[parts.length - 1])).getFile(); }
        catch (e) { throw new Error("ファイルがありません：" + parts.join("/")); }
      };
      const read = async parts => (await get(parts)).text();
      const has = async parts => { try { await get(parts); return true; } catch (e) { return false; } };
      const m = /<script\b[^>]*\ssrc=(["'])([^"']*?)kamishibai\.js\1[^>]*>\s*<\/script\s*>/i.exec(text);
      if (!m) throw new Error("この原稿には kamishibai.js の読み込みがありません");
      const eng = join(loc.dirs, unescape(m[2] || "./"));
      const t = /<html\b[^>]*\stheme=(["']?)([A-Za-z]+)\1/i.exec(text), theme = t ? t[2] : "Boadilla";
      if (!await has(eng.concat("themes", theme + ".css"))) throw new Error("テーマがありません：" + theme);
      const local = ref => /^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(ref) ? null : join(loc.dirs, unescape(ref));
      const dataURI = f => new Promise(function (ok, no) {
        const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(f);
      });
      const inline = async function (src) {
        src = await replaceAsync(src, /(<(?:img|qr|image|source)\b[^>]*?\s(?:src|href|xlink:href)=)(["'])([^"']*)\2/gi,
          async function (all, a, qt, ref) { const q = local(ref); return q ? a + qt + await dataURI(await get(q)) + qt : all; });
        src = await replaceAsync(src, /<script\b[^>]*?\ssrc=(["'])([^"']*)\1[^>]*>\s*<\/script\s*>/gi,
          async function (all, qt, ref) { const q = local(ref); return q ? "<script>" + (await read(q)).replace(/<\/script/gi, "<\\/script") + "<\/script>" : all; });
        return replaceAsync(src, /<link\b[^>]*>/gi, async function (all) {
          if (!/rel=["']?stylesheet/i.test(all)) return all;
          const h = /href=(["'])([^"']*)\1/i.exec(all), q = h && local(h[2]);
          return q ? "<style>" + await read(q) + "</style>" : all;
        });
      };
      let head = text.slice(0, m.index), tail = text.slice(m.index + m[0].length);
      head = head.replace(/(<html\b[^>]*\stheme=)(["']?)[A-Za-z]+\2/i, (all, a) => a + '"' + theme + '"');
      const own = /<script\b/i.test(head + tail);
      head = await inline(head); tail = await inline(tail);
      const fontFiles = { Madrid: ["fonts/ipa-pgothic.css", "fonts/cm-sans.css"] }[theme] || ["fonts/kamishibai-fonts.css"];
      let fonts = "", noFont = [];
      for (const f of fontFiles) {
        const q = eng.concat(f.split("/"));
        if (await has(q)) fonts += await read(q) + "\n"; else noFont.push(f);
      }
      const style = css => "<style data-kamishibai>\n" + css.replace(/\n+$/, "").replace(/<\/style/gi, "<\\/style") + "\n</style>\n";
      const script = (code, attr) => "<script" + (attr || "") + ">\n" + code.replace(/\n+$/, "").replace(/<\/script/gi, "<\\/script") + "\n<\/script>\n";
      const name = fh.name.replace(/\.html?$/i, "");
      const block = "<!-- Packed from " + fh.name + " by page-edit (theme " + theme + "). Edit the draft, not this file. -->\n"
        + style(await read(eng.concat("katex", "katex.css"))) + (fonts ? style(fonts) : "")
        + style(await read(eng.concat("base.css"))) + style(await read(eng.concat("themes", theme + ".css")))
        + script(await read(eng.concat("kamishibai.js")), ' data-packed="' + theme + '"')
        + script(await read(eng.concat("katex", "katex.js")))
        + (own ? script(await read(eng.concat("figure.js"))) : "");
      const out = head + block.replace(/\n+$/, "") + tail;
      const w = await (await (await dirOf(loc.dirs)).getFileHandle(name + ".dist.html", { create: true })).createWritable();
      await w.write(out);
      await w.close();
      msg(name + ".dist.html を書きました（" + Math.round(new Blob([out]).size / 1024 / 1024 * 10) / 10 + " MB）"
        + (noFont.length ? "。書体 " + noFont.join("・") + " が無いので手元の書体で出ます" : ""), 8000);
    } catch (e) { msg(e.name === "AbortError" ? "" : "HTML を書けませんでした：" + e.message, 10000); }
  }

  /* ===== Rebuild the page from source text, with this script inserted before webslide.js ===== */
  function rebuild(text, mtime) {
    const m = WEBSLIDE_RE.exec(text);
    if (!m) { msg("この原稿には webslide.js（または kamishibai.js）の読み込みがありません", 8000); return; }
    S.text = text;
    if (mtime !== undefined) S.mtime = mtime;
    S.building = true;
    // This same function, inline (file:// pages have no CSP).
    const inject = "<script>(" + slideEdit.toString().replace(/<\/script/gi, "<\\/script") + ")();<\/script>\n";
    document.open();
    document.write(text.slice(0, m.index) + inject + text.slice(m.index));
    document.close();
  }

  /* ===== UI helpers ===== */
  const gen = ++S.gen;   // listeners of an older build ignore events
  const live = () => S.gen === gen;

  function style() {
    const css = document.createElement("style");
    css.textContent = [
      "body.sed-on .deck [data-sed]:hover, body.sed-on .deck [data-sedt]:hover, body.sed-on .deck [data-sed-jump]:hover { outline: 2px dashed #e07000; outline-offset: 2px; cursor: text; }",
      ".deck .sed-editing { outline: 2px solid #e07000 !important; outline-offset: 2px; white-space: pre-wrap; background: #fff8ec; }",
      "body.sed-on .deck [data-sed], body.sed-on .deck [data-sedt] { white-space: pre-wrap; }",
      // Theme headers and footers pass clicks through (pointer-events: none); take them back while editing.
      "body.sed-on .deck [data-sed], body.sed-on .deck [data-sedt], body.sed-on .deck [data-sed-jump] { pointer-events: auto; }",
      "body.sed-on .deck .sed-src { font-family: ui-monospace, Menlo, monospace; font-size: .8em; color: #a04000; }",
      // The message line, just above the engine's tool panel (.tools, bottom left) while a message is up. A page
      // without that panel: the buttons are in this bar too, always there, faint until pointed at.
      ".sed-bar { position: fixed; left: 12px; bottom: 64px; z-index: 99999; display: flex; gap: 6px; align-items: center;",
      "  padding: 6px; background: #1e1e1e; border: 1px solid #444; border-radius: 10px; box-shadow: 0 6px 20px rgba(0, 0, 0, .45);",
      "  font: 600 13px/1 system-ui, sans-serif; opacity: 0; visibility: hidden; transition: opacity .3s, visibility .3s; }",
      ".sed-bar.show { opacity: 1; visibility: visible; }",
      ".sed-bar.free { opacity: .35; visibility: visible; bottom: 12px; }",
      ".sed-bar.free:hover, .sed-bar.free.show { opacity: 1; }",
      ".sed-bar button { font: inherit; color: #fff; background: #2e2e2e; border: 1px solid #555; border-radius: 6px; padding: 7px 10px; cursor: pointer; }",
      ".sed-bar button:hover { background: #3a3a3a; }",
      ".sed-btn.on, .tools button.sed-btn.on { background: #e07000; border-color: #e07000; }",
      // In edit mode the engine's panel stays up, so that the lit Edit button shows it.
      "body.sed-on .tools { opacity: 1 !important; visibility: visible !important; }",
      // folded panel: Edit stays inside ▷, except while editing, so that the lit button shows the mode
      "body.sed-on .tools .sed-btn { display: block; }",
      ".sed-msg { color: #fff; font-weight: 400; padding: 0 4px; white-space: nowrap; display: none; }",
      ".sed-bar:not(.free) .sed-msg { padding: 4px; }",
      "@media print { .sed-bar { display: none; } }"
    ].join("\n");
    document.head.appendChild(css);
  }

  function msg(text, ms) {
    const m = document.querySelector(".sed-msg");
    if (!m) { if (text) console.log("slide-edit:", text); return; }
    m.textContent = text;
    m.style.display = text ? "inline-block" : "none";
    S.msgOn = !!text;
    clearTimeout(S.msgTimer);
    if (ms) S.msgTimer = setTimeout(function () { m.style.display = "none"; S.msgOn = false; sync(); }, ms);
    sync();
  }

  // The message line sits just above the engine's tool panel; the buttons are inside that panel (bar()).
  // A page without the panel gets a panel of its own, faint until pointed at.
  function sync() {
    const b = document.querySelector(".sed-bar");
    if (!b) return;
    const tools = document.querySelector(".tools");
    b.classList.toggle("free", !tools);
    if (tools) {
      const top = tools.getBoundingClientRect().top;
      if (top > 0) b.style.bottom = (innerHeight - top + 8) + "px";
      b.classList.toggle("show", !!S.msgOn);
    } else b.classList.toggle("show", document.body.classList.contains("sed-on") || !!S.msgOn || b.matches(":hover"));
  }

  // Turn the engine's select mode on or off, as its key (Cmd+I, Cmd+E on an older engine) does.
  function pressSelect() {
    const code = selectCode();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: code.slice(3).toLowerCase(), code: code, metaKey: MAC, ctrlKey: !MAC, bubbles: true }));
  }

  function bar(buttons) {
    document.querySelectorAll(".sed-bar, .tools .sed-btn").forEach(e => e.remove());
    const b = document.createElement("div");
    b.className = "sed-bar";
    const m = document.createElement("span");
    m.className = "sed-msg";
    b.appendChild(m);
    const tools = document.querySelector(".tools");
    // In the engine's panel: first behind its ▷, folded away with the panel's other buttons (class "op").
    let at = tools && tools.firstElementChild ? tools.firstElementChild.nextSibling : null;
    buttons.forEach(function (d) {
      const t = document.createElement("button");
      t.className = "sed-btn " + d.cls + (tools ? " op" : "");
      t.textContent = d.text;
      t.title = d.title;
      t.addEventListener("click", function (e) { e.stopPropagation(); t.blur(); d.run(); });
      if (tools) tools.insertBefore(t, at); else b.appendChild(t);
    });
    document.body.appendChild(b);
    b.addEventListener("mouseenter", sync);
    b.addEventListener("mouseleave", sync);
    addEventListener("resize", sync);
    addEventListener("mousemove", sync);
    const watch = new MutationObserver(sync);
    watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    if (tools) watch.observe(tools, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  /* ===== Activation: the extension ran this script on a page built without it ===== */
  if (!S.building) {
    if (document.querySelector(".sed-bar")) { msg("page-edit はもう動いています", 3000); return; }
    if (!document.querySelector(".deck")) return;  // not a slide: do nothing
    try { S.edit = sessionStorage.getItem(EDIT_KEY) === "1"; } catch (e) { /* storage unavailable */ }
    const open = async function (h) {
      S.handle = h;
      const f = await h.getFile();
      rebuild(await f.text(), f.lastModified);
    };
    // Started by hand (button or key): the rebuilt page comes up in edit mode.
    // left: the author went back to another mode while Chrome was asking; the page is then rebuilt outside edit mode.
    let left = false, waitingFor = null;
    const begin = function () {
      left = false;
      if (!waitingFor) waitingFor = start().finally(() => { waitingFor = null; });   // asked again while Chrome is asking: the same one
      return waitingFor;
    };
    const start = async function () {
      try { msg("原稿を開いています…"); const h = await getHandle(); S.edit = !left; await open(h); return true; }
      catch (e) {
        S.edit = false;
        msg(e.name === "AbortError" ? "フォルダを選ばなかったので、編集を始めていません" : "開けませんでした：" + e.message, 8000);
        return false;
      }
    };
    style();
    // A Kamishibai engine with the three modes: its 編集 heading (and Cmd+E) starts editing, its 出力 writes the HTML.
    const K = window.Kamishibai;
    if (K && K.setEditor) {
      if (K.packed) return;   // a packed file is not edited
      let waiting = true;
      bar([]);
      K.setEditor({ enter: function () { waiting = false; begin().then(function (ok) { if (!ok) K.mode("show"); }); },
                    leave: function () { left = true; }, exportHTML: exportHTML });
      (async function () {
        try { const h = await getHandle(false); if (h && waiting) await open(h); }
        catch (e) { /* folder moved: the heading still asks */ }
      })();
      return;
    }
    bar([{ cls: "sed-start-btn", text: "Edit " + EDIT_KEY_LABEL, title: "Edit the text on the page and write it back to the draft. The first time, allow the folder that holds this draft (e.g. the project folder); every draft below it then opens without asking",
           run: begin }]);
    // Cmd+E (Ctrl+E elsewhere) does the same as the button; a key press counts as the user
    // gesture the folder picker needs.
    addEventListener("keydown", function (e) {
      if (!isEditKey(e)) return;
      if (!document.querySelector(".sed-start-btn")) return;   // already started, or the page was rebuilt
      e.preventDefault(); e.stopPropagation(); begin();
    }, true);
    // A folder allowed before that holds this page, with write access still granted: start at once, without the button.
    (async function () {
      try {
        const h = await getHandle(false);
        if (h && document.querySelector(".sed-start-btn")) await open(h);
      } catch (e) { /* folder moved: fall back to the button */ }
      // No startup hint on the slide: the button's tooltip explains the key.
    })();
    return;
  }

  /* ===== Editing mode: running inside the rebuilt page, before webslide.js ===== */
  S.building = false;
  const D = parse(S.text);
  let enabled = true, editing = null;

  // The runs of an element's content between BLOCKS children, as the parser cuts them in the source.
  function runs(el) {
    const out = [[]];
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && BLOCKS.has(n.tagName.toLowerCase())) out.push([]);
      else out[out.length - 1].push(n);
    }
    return out;
  }
  const blank = t => !t.replace(/<!--[\s\S]*?-->/g, "").trim();

  function mark() {
    const els = [].slice.call(document.querySelectorAll([...CONTAINER].join(",")));
    if (els.map(e => e.tagName.toLowerCase()).join() !== D.els.join()) {
      enabled = false;
      console.warn("slide-edit: element order differs from the source parse", els, D.els);
      return;
    }
    const byEl = els.map(() => []);
    D.spans.forEach((s, i) => byEl[s.el].push(i));
    els.forEach(function (el, n) {
      if (el.matches("figcaption[caps]")) return;   // Kamishibai replaces its text when the figure flips
      const dom = runs(el), src = byEl[n];
      // The browser may have cut the content otherwise (a <p> closed by a <div>): then only the first run.
      const k = dom.length === src.length ? src.length : 1;
      for (let j = 0; j < k; j++) {
        const s = D.spans[src[j]], seg = dom[j];
        if (!seg || !seg.length || blank(S.text.slice(s.start, s.end))) continue;
        const w = document.createElement("span");
        w.setAttribute("data-sed", String(src[j]));
        el.insertBefore(w, seg[0]);
        seg.forEach(x => w.appendChild(x));
      }
    });
    ATTRS.forEach(function (spec) {
      const sel = spec.tags.map(t => t + "[" + spec.attr + "]").join(",");
      const dom = [].slice.call(document.querySelectorAll(sel));
      const idx = [];
      D.attrs.forEach((a, i) => { if (a.attr === spec.attr) idx.push(i); });
      if (dom.map(e => e.tagName.toLowerCase()).join() !== idx.map(i => D.attrs[i].tag).join()) {
        console.warn("slide-edit: order of " + spec.attr + "= differs; it is not editable");
        return;
      }
      dom.forEach((el, j) => el.setAttribute("data-sed-" + spec.attr, String(idx[j])));
    });
  }

  // Where each attribute shows on the built page: data-sedt = its index in D.attrs.
  function afterBuild() {
    const put = (el, i) => { if (el && i !== null) el.setAttribute("data-sedt", i); };
    const deck = document.querySelector(".deck");
    if (deck) {
      deck.querySelectorAll("[data-sed-title]").forEach(function (el) {
        put(el.tagName === "SLIDE"
          ? el.closest("section.page").querySelector(":scope > .ttl > span")
          : el.querySelector(":scope > .bt > span, :scope > .pt > span"),   // .pt: Kamishibai's proof, plan, later
            el.getAttribute("data-sed-title"));
      });
      deck.querySelectorAll("[data-sed-label]").forEach(el => put(el.querySelector(":scope > .lb"), el.getAttribute("data-sed-label")));
      deck.querySelectorAll("[data-sed-cite]").forEach(el => put(el.querySelector(":scope > .bt > cite"), el.getAttribute("data-sed-cite")));
      // Institutes: one line per distinct aff on the cover, in the order of the authors.
      deck.querySelectorAll("cover").forEach(function (cov) {
        const seen = [], at = [];
        cov.querySelectorAll("author[aff]").forEach(function (a) {
          const f = a.getAttribute("aff");
          if (seen.indexOf(f) < 0) { seen.push(f); at.push(a.getAttribute("data-sed-aff")); }
        });
        cov.querySelectorAll(":scope > .insts > span").forEach((s, k) => put(s, k < at.length ? at[k] : null));
      });
      // Section names in every page's header: by name, to the first slide that sets it.
      const secs = Object.create(null);
      deck.querySelectorAll("slide[data-sed-sec]").forEach(function (sl) {
        const n = sl.getAttribute("sec");
        if (!(n in secs)) secs[n] = sl.getAttribute("data-sed-sec");
      });
      deck.querySelectorAll(".hn").forEach(h => { if (h.textContent in secs) put(h, secs[h.textContent]); });
      // Footer: taken from the cover. With short="…" it is that attribute, edited in place; else a click goes to
      // the cover and edits the text there.
      const cov = deck.querySelector("cover");
      if (cov) {
        const from = { who: cov.querySelector("author[presenter]") || cov.querySelector("author"),
                       title: cov.querySelector("headline"), date: cov.querySelector("date") };
        const where = { who: ".foot > .f1", title: ".foot > .f2", date: ".foot .fdate" };
        Object.keys(from).forEach(function (k) {
          const src = from[k];
          if (!src) return;
          deck.querySelectorAll(where[k]).forEach(function (f) {
            if (src.hasAttribute("data-sed-short")) put(f, src.getAttribute("data-sed-short"));
            else f.setAttribute("data-sed-jump", k);
          });
        });
      }
    }
    style();
    const K = window.Kamishibai;
    if (K && K.setEditor) {
      // The engine's 編集 mode is edit mode: its heading and Cmd+E enter and leave it.
      bar([]);
      K.setEditor({ enter: () => setEdit(true), leave: () => setEdit(false), exportHTML: exportHTML });
      if (S.edit) { S.edit = false; K.mode("edit"); }
      if (!enabled) msg("編集できません（要素の並びが読めない）。console を見てください");
      else if (S.notice) { msg(S.notice, S.noticeMs || 4000); S.notice = ""; S.noticeMs = 0; }
      poll();
      return;
    }
    bar([{ cls: "sed-toggle-btn", text: "Edit " + EDIT_KEY_LABEL, title: "Edit mode on or off. Click a text to edit it; Enter saves, Shift+Enter adds a line break, Esc cancels", run: toggleEdit }]);
    addEventListener("keydown", function (e) {
      if (!live() || !isEditKey(e)) return;
      e.preventDefault(); e.stopPropagation();
      if (editing) finish(true);
      toggleEdit();
    }, true);
    // Edit mode rides on the engine's select mode (body.edit: no page turn on click). Leaving select mode
    // (Cmd+I, its button, or Cmd+U) leaves edit mode; entering it by those stays plain select mode.
    new MutationObserver(function () {
      if (!live()) return;
      if (!document.body.classList.contains("edit")) { S.want = false; setEdit(false); }
      else if (S.want) { S.want = false; setEdit(true); }
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    // Back in edit mode after a rebuild (save, outside change, reload).
    if (S.edit) { S.edit = false; toggleEdit(); }
    if (!enabled) msg("編集できません（要素の並びが読めない）。console を見てください");
    else if (S.notice) { msg(S.notice, S.noticeMs || 4000); S.notice = ""; S.noticeMs = 0; }
    poll();
  }

  function info(el) {
    if (el.hasAttribute("data-sed")) {
      const s = D.spans[+el.getAttribute("data-sed")];
      return { kind: "span", i: +el.getAttribute("data-sed"), src: S.text.slice(s.start, s.end) };
    }
    const t = D.attrs[+el.getAttribute("data-sedt")];
    return { kind: "attr", i: +el.getAttribute("data-sedt"), src: S.text.slice(t.start, t.end) };
  }

  // A footer item without short="…": go to the cover and edit the text it is taken from.
  function jump(kind) {
    const cov = document.querySelector(".deck cover");
    const src = cov && { who: cov.querySelector("author[presenter]") || cov.querySelector("author"),
                         title: cov.querySelector("headline"), date: cov.querySelector("date") }[kind];
    const el = src && src.querySelector(":scope > [data-sed]");
    if (!el) { msg("表紙のこの文は編集できません", 4000); return; }
    const pages = [].slice.call(document.querySelectorAll(".deck section.page"));
    const k = pages.indexOf(el.closest("section.page"));
    if (k >= 0 && location.hash !== "#s" + (k + 1)) location.hash = "#s" + (k + 1);   // the engine turns to it (hashchange)
    setTimeout(function () { if (live()) start(el, -1, -1); }, 80);
  }

  /* ===== Edit mode: every editable text shows its source; leaving it shows the rendered page again ===== */
  const rendered = new WeakMap();
  function showSource(el) {
    el.innerHTML = "";
    const s = document.createElement("span");
    s.className = "sed-src";
    s.textContent = info(el).src.trim();
    el.appendChild(s);
  }
  // Enter or leave edit mode (the button and Cmd+E).
  function toggleEdit() {
    const b = document.body;
    if (b.classList.contains("sed-on")) { if (b.classList.contains("edit")) pressSelect(); else setEdit(false); return; }
    if (b.classList.contains("edit")) { setEdit(true); return; }
    S.want = true;
    pressSelect();
  }
  function setEdit(on) {
    if (on === document.body.classList.contains("sed-on")) return;
    if (!on && editing) finish(true);
    S.edit = on;
    try { sessionStorage.setItem(EDIT_KEY, on ? "1" : "0"); } catch (e) { /* storage unavailable */ }
    document.body.classList.toggle("sed-on", on);
    const t = document.querySelector(".sed-toggle-btn");
    if (t) t.classList.toggle("on", on);
    if (on && !enabled) msg("編集できません（要素の並びが読めない）。console を見てください");
    else msg("");
    document.querySelectorAll(".deck [data-sed], .deck [data-sedt]").forEach(function (el) {
      if (el === editing) return;
      if (on) {
        if (!rendered.has(el)) rendered.set(el, el.innerHTML);
        showSource(el);
      } else if (rendered.has(el)) {
        el.innerHTML = rendered.get(el);
        rendered.delete(el);
      }
    });
  }

  /* ===== Editing ===== */
  function start(el, x, y) {
    if (editing) finish(true);
    // Where the click landed in the shown source, so that the caret goes there (the source is shown as one text node).
    let at = -1;
    const cr = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    if (cr && cr.startContainer.nodeType === 3 && el.contains(cr.startContainer)) at = cr.startOffset;
    const it = info(el), src = it.src;
    const lead = src.match(/^\s*/)[0], trail = src.slice(lead.length).match(/\s*$/)[0];
    const core = src.slice(lead.length, src.length - trail.length);
    if (!rendered.has(el)) rendered.set(el, el.innerHTML);
    editing = el;
    S.editing = true;
    el._sed = { it: it, lead: lead, trail: trail, core: core };
    el.textContent = core;
    el.classList.add("sed-editing");
    try { el.contentEditable = "plaintext-only"; } catch (e) { el.contentEditable = "true"; }
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.focus();
    const r = document.createRange();
    if (at >= 0 && el.firstChild && at <= el.firstChild.length) { r.setStart(el.firstChild, at); r.collapse(true); }
    else { r.selectNodeContents(el); r.collapse(false); }
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function restore(el) {
    el.removeAttribute("contenteditable");
    el.classList.remove("sed-editing");
    if (S.edit) showSource(el);
    else if (rendered.has(el)) { el.innerHTML = rendered.get(el); rendered.delete(el); }
  }

  function finish(save) {
    const el = editing;
    if (!el) return;
    editing = null;
    S.editing = false;
    const st = el._sed;
    const text = el.innerText.replace(/ /g, " ").replace(/\n$/, "");
    if (!save || text === st.core) { restore(el); msg(""); return; }
    msg("保存中…");
    write(st.it, st.lead + text + st.trail).catch(async function (e) {
      S.saving = false;
      if (e.conflict) {
        // Show the current source, keep what was typed in the message so that it can be copied back.
        S.notice = "保存しませんでした（原稿のこの箇所が先に変わっていました）。入力した文：" + text;
        S.noticeMs = 30000;
        rebuild(e.conflict.text, e.conflict.mtime);
        return;
      }
      restore(el);
      msg("保存できませんでした：" + e.message, 8000);
    });
  }

  async function write(it, neu) {
    S.saving = true;
    const h = await getHandle();
    const file = await h.getFile(), cur = await file.text();
    const t = parse(cur), s = (it.kind === "attr" ? t.attrs : t.spans)[it.i];
    if (!s || cur.slice(s.start, s.end) !== it.src || (it.kind === "attr" && D.attrs[it.i] && s.attr !== D.attrs[it.i].attr)) {
      const err = new Error("原稿のこの箇所が先に変わっていました");
      err.conflict = { text: cur, mtime: file.lastModified };
      throw err;
    }
    let next = cur;
    if (it.kind === "attr") {
      // A name used in several places (sec, aff) is rewritten everywhere it has the same value.
      const all = s.all ? t.attrs.filter(a => a.attr === s.attr && cur.slice(a.start, a.end) === it.src) : [s];
      all.sort((x, y) => y.start - x.start).forEach(function (a) {
        const q = cur[a.start - 1], v = neu.replace(/\n/g, " ");
        const rep = a.none ? '="' + v.replace(/"/g, "&quot;") + '"'
                  : a.bare ? '"' + v.replace(/"/g, "&quot;") + '"'
                  : q === "'" ? v.replace(/'/g, "&#39;") : v.replace(/"/g, "&quot;");
        next = next.slice(0, a.start) + rep + next.slice(a.end);
      });
    } else next = cur.slice(0, s.start) + neu + cur.slice(s.end);
    // A change between the re-read above and the write is a conflict too: checked here just before writing.
    const base = file.lastModified;
    const changed = async function () {
      const f = await h.getFile(), err = new Error("原稿が先に変わっていました");
      err.conflict = { text: await f.text(), mtime: f.lastModified };
      return err;
    };
    if ((await h.getFile()).lastModified !== base) throw await changed();
    const w = await h.createWritable();
    await w.write(next);
    await w.close();
    S.saving = false;
    S.notice = "保存しました";
    rebuild(next, (await h.getFile()).lastModified);
  }

  function target(e) {
    const el = e.target.closest && e.target.closest("[data-sed], [data-sedt]");
    return el && el.closest(".deck") ? el : null;
  }

  // Capture phase on window: runs before WebSlide's handlers, so the page does not turn.
  addEventListener("click", function (e) {
    if (!live()) return;
    if (editing && editing.contains(e.target)) { e.stopPropagation(); return; }
    if (!S.edit || !enabled) return;
    const j = e.target.closest && e.target.closest(".deck [data-sed-jump]");
    if (j && !target(e)) { e.preventDefault(); e.stopPropagation(); jump(j.getAttribute("data-sed-jump")); return; }
    const el = target(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    start(el, e.clientX, e.clientY);
  }, true);
  addEventListener("mousedown", function (e) {
    if (!live()) return;
    if (editing && editing.contains(e.target)) e.stopPropagation();
  }, true);
  addEventListener("keydown", function (e) {
    if (!live()) return;
    if (editing && (e.target === editing || editing.contains(e.target))) {
      if (isEditKey(e)) return;                   // handled by the edit key's own listener
      if (isSelectKey(e)) { finish(true); return; }   // passes on to the engine, which leaves select (and edit) mode
      e.stopPropagation();   // keep WebSlide from turning pages while typing
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      else if ((e.metaKey || e.ctrlKey) && e.code === "KeyA") {
        e.preventDefault();   // select only the text being edited, not the whole page
        const r = document.createRange();
        r.selectNodeContents(editing);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
  }, true);
  document.addEventListener("focusout", function (e) { if (live() && editing && e.target === editing) finish(true); });

  /* ===== Rebuild when the source file changes elsewhere (editor, AI) ===== */
  function poll() {
    clearInterval(S.poll);
    S.poll = setInterval(async function () {
      if (!live() || !S.handle || S.building || S.editing || S.saving) return;
      try {
        const f = await S.handle.getFile();
        if (f.lastModified === S.mtime) return;
        const text = await f.text();
        S.mtime = f.lastModified;
        if (text !== S.text && !S.editing && !S.saving) { S.notice = "原稿が外で変わったので組み直しました"; rebuild(text); }
      } catch (e) { /* file moved or permission lost */ }
    }, 1000);
  }

  // Registered before webslide.js, so mark() runs before build(); afterBuild() runs after all DOMContentLoaded handlers.
  document.addEventListener("DOMContentLoaded", function () {
    mark();
    // after the engine has measured which pages to shrink: in edit mode it would measure the source texts
    setTimeout(function () {
      const K = window.Kamishibai, run = () => { if (live()) afterBuild(); };
      if (K && K.ready) K.ready.then(run, run); else run();
    }, 0);
  });
})();
