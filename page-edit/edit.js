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

   In edit mode every text stays typeset and pages do not turn on click. The text being edited shows its math as TeX;
   emphasis, color, bold and line breaks keep their look and are put on and taken off with a small bar or keys.
   A deck with Japanese and English: only the language shown is edited (its part of each pair, and text without a
   pair); the engine's panel gets three buttons, 日本語, English and both at once. Saving one language leaves the
   other as it is. In English, Japanese text that has no English is shown grey and is not edited.
   click        edit that text (in edit mode)
   Enter        save            Shift+Enter  line break      Esc  cancel
   Cmd+K        emphasis        Cmd+Shift+K  blue            Cmd+B  bold    (on the selection)
   Cmd+E        leave edit mode (saves the text being edited); any tool of the show mode, or Cmd+P, leaves it too */
(function slideEdit() {
  "use strict";
  const S = window.__slideEdit || (window.__slideEdit = { gen: 0, edit: false });

  // WebSlide's tags, and the Kamishibai components (subtitle, proof, plan, later)
  const EDITABLE = ["p", "item", "note", "down", "headline", "subtitle", "author", "meeting", "date", "figcaption",
                    "td", "th", "block", "alertblock", "exampleblock", "divider", "column", "proof", "plan", "later",
                    "box", "to", "boxed", "io", "ln", "credit"];
  // Child elements that end the editable text segment of their parent.
  const BLOCKS = new Set(["list", "item", "p", "block", "alertblock", "exampleblock", "note", "down", "columns",
                          "column", "figure", "table", "svg", "div", "img", "script", "style", "headline", "author",
                          "meeting", "date", "qr", "ul", "ol", "subtitle", "proof", "plan", "later", "nums",
                          "side", "flip", "switch", "button", "flow", "box", "to", "boxed", "algo", "io", "ln", "credit"]);
  const TITLED = ["slide", "block", "alertblock", "exampleblock", "proof", "plan", "later", "box", "boxed", "algo"];
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
  ATTRS.push(...ATTRS.map(x => ({ attr: x.attr + "-en", tags: x.tags, all: x.all })));   // the English of each
  const VOID = new Set(["br", "img", "input", "wbr", "hr", "meta", "link", "source", "col", "area", "base", "embed", "track"]);
  const RAW = new Set(["script", "style"]);
  const WEBSLIDE_RE = /<script[^>]*(?:webslide|kamishibai)\.js[^>]*>/i;   // WebSlide, or its derived Kamishibai engine
  const EDIT_KEY = "slide-edit-on:" + location.pathname;   // edit mode survives a reload of the tab
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);    // as WebSlide decides between Cmd and Ctrl
  const BOTH_KEY = "page-edit-both";   // "1": Japanese and English are edited at once
  const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;
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
  // A folder kept by an earlier Chrome can come back dead after an update: none of its methods ever settles (seen in
  // Chrome 158, 2026-11-24). So the first call on a kept folder is given up after a while. Not for calls that show a
  // prompt, and short enough that the click still allows the folder picker afterwards (5 s in Chrome).
  const DEAD = {};
  const answer = p => Promise.race([p, new Promise((ok, no) => setTimeout(() => no(DEAD), 1500))]);
  async function keepDir(d) {
    const list = await keptDirs(), out = [d];
    // the others stay, except this same folder and those that no longer answer
    const same = await Promise.all(list.map(x => answer(x.isSameEntry(d)).catch(() => true)));
    list.forEach((x, i) => { if (!same[i]) out.push(x); });
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
    let dead = "";
    const state = await Promise.all(kept.map(d => answer(allowed(d, false)).catch(e => e)));
    for (let i = 0; i < kept.length; i++) {
      const d = kept[i];
      try {
        if (state[i] === DEAD) { dead = d.name; continue; }
        if (state[i] === false) asked.push(d);
        if (state[i] !== true) continue;
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
    msg(dead ? "前に選んだフォルダ「" + dead + "」は、今の Chrome では使えなくなっています。もう一度選ぶと編集が始まります"
             : "原稿を含むフォルダを選ぶ画面を開いています。フォルダを選ぶと編集が始まります");
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
    S.panel = document.body.classList.contains("tools-open");   // the engine's panel stays open over the rebuild
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
      "body.sed-on .deck :is([data-sed], [data-sedt]):not(.sed-parts):hover, body.sed-on .deck .sed-part:hover, body.sed-on .deck [data-sed-jump]:hover { outline: 2px dashed #e07000; outline-offset: 2px; cursor: text; }",
      ".deck .sed-editing { outline: 2px solid #e07000 !important; outline-offset: 2px; white-space: pre-wrap; background: #fff8ec; }",
      // the text being edited: marks of line ends of the source, math and other tags by color (highlights)
      ".deck .sed-editing .sed-ws0 { font-size: 0; }",
      "::highlight(sed-math) { color: #a04000; }",
      "::highlight(sed-tag) { color: #7a7a7a; }",
      ".sed-fmt { position: fixed; z-index: 99998; display: flex; gap: 2px; padding: 3px; background: #1e1e1e; border: 1px solid #444;",
      "  border-radius: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, .35); }",
      ".sed-fmt button { font: 700 16px/1 system-ui, sans-serif; min-width: 30px; height: 28px; padding: 0 6px; color: #fff; background: none; border: 0; border-radius: 5px; cursor: pointer; }",
      ".sed-fmt button i { display: inline-block; padding: 3px 6px; border-radius: 4px; background: #fff; font-style: normal; }",
      ".sed-fmt button:hover { background: #3a3a3a; }",
      ".sed-fmt button.on { background: #e07000; }",
      // Theme headers and footers pass clicks through (pointer-events: none); take them back while editing.
      "body.sed-on .deck [data-sed], body.sed-on .deck [data-sedt], body.sed-on .deck [data-sed-jump] { pointer-events: auto; }",
      "body.sed-on .deck .sed-src { white-space: pre-wrap; font-family: ui-monospace, Menlo, monospace; font-size: .8em; color: #a04000; }",
      // one language at a time: what the language shown does not have
      "body.sed-on .deck .sed-off { opacity: .4; cursor: default; }",
      "body.sed-on .deck .sed-part + .sed-part { margin-left: .5em; }",
      ".tools button.sed-lang { font: 700 13px/1 system-ui, sans-serif; letter-spacing: 0; }",
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
      "@media print { .sed-bar, .sed-fmt { display: none; } }"
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
    // from: the element whose attribute it is (its -en is the English of the same place)
    const put = function (el, from, attr) {
      if (!el || !from || !from.hasAttribute("data-sed-" + attr)) return;
      el.setAttribute("data-sedt", from.getAttribute("data-sed-" + attr));
      if (from.hasAttribute("data-sed-" + attr + "-en")) el.setAttribute("data-sedt-en", from.getAttribute("data-sed-" + attr + "-en"));
    };
    const deck = document.querySelector(".deck");
    if (deck) {
      deck.querySelectorAll("[data-sed-title]").forEach(function (el) {
        put(el.tagName === "SLIDE"
          ? el.closest("section.page").querySelector(":scope > .ttl > span")
          : el.querySelector(":scope > .bt > span, :scope > .pt > span"),   // .pt: Kamishibai's proof, plan, later
            el, "title");
      });
      deck.querySelectorAll("[data-sed-label]").forEach(el => put(el.querySelector(":scope > .lb"), el, "label"));
      deck.querySelectorAll("[data-sed-cite]").forEach(el => put(el.querySelector(":scope > .bt > cite"), el, "cite"));
      // Institutes: one line per distinct aff on the cover, in the order of the authors.
      deck.querySelectorAll("cover").forEach(function (cov) {
        const seen = [], at = [];
        cov.querySelectorAll("author[aff]").forEach(function (a) {
          const f = a.getAttribute("aff");
          const k = seen.indexOf(f);
          if (k < 0) { seen.push(f); at.push(a); }
          else if (!at[k].hasAttribute("aff-en")) at[k] = a;   // the English may be at a later author (as in the engine)
        });
        cov.querySelectorAll(":scope > .insts > span").forEach((s, k) => put(s, at[k], "aff"));
      });
      // Section names in every page's header: by name, to the first slide that sets it.
      const secs = Object.create(null);
      deck.querySelectorAll("slide[data-sed-sec]").forEach(function (sl) {
        const n = sl.getAttribute("sec");
        if (!(n in secs) || (!secs[n].hasAttribute("sec-en") && sl.hasAttribute("sec-en"))) secs[n] = sl;
      });
      deck.querySelectorAll(".hn").forEach(function (h) {
        const n = (h.querySelector(".L-ja") || h).textContent;   // in a deck with English: the Japanese is the name
        if (n in secs) put(h, secs[n], "sec");
      });
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
            if (src.hasAttribute("data-sed-short")) put(f, src, "short");
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
      langButtons(K);
      const handle = document.querySelector(".tools .handle");
      if (S.panel && handle && !document.body.classList.contains("tools-open")) handle.click();
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

  /* ===== One language at a time =====
     A deck with English (Kamishibai.hasEn): what is shown and edited is the language on screen, unless the author
     chose both at once (kept in the browser). The language itself is the engine's, so the page shows it too. */
  let langs = null;   // the engine, when the deck has English and the panel to choose with
  let both = false;
  const shown = () => langs && !both ? langs.lang() : null;   // "ja" or "en"; null: everything at once
  function langButtons(K) {
    const g = document.querySelector(".tools .g-edit");
    if (!g || !K.hasEn || !K.lang) return;
    langs = K;
    try { both = localStorage.getItem(BOTH_KEY) === "1"; } catch (e) { /* storage unavailable */ }
    if (S.lang) K.lang(S.lang);   // the rebuilt page: ?lang= in the address must not turn it back
    const sep = document.createElement("div");
    sep.className = "sep";
    g.prepend(sep);
    const defs = [["ja", "あ", "日本語だけを編集"], ["en", "A", "英語だけを編集"], ["both", "あA", "日本語と英語を一度に編集"]];
    const btns = defs.map(function (d) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "it sed-lang";
      b.textContent = d[1];
      b.title = d[2];
      b.setAttribute("aria-label", d[2]);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        b.blur();
        if (editing) finish(true);
        both = d[0] === "both";
        try { localStorage.setItem(BOTH_KEY, both ? "1" : "0"); } catch (x) { /* storage unavailable */ }
        if (!both) K.lang(d[0]);   // on a change, the event below shows the sources again
        light();
        refresh();
      });
      g.insertBefore(b, sep);
      return b;
    });
    const light = () => btns.forEach((b, k) => b.classList.toggle("on", defs[k][0] === (both ? "both" : K.lang())));
    light();
    document.addEventListener("kamishibai:lang", function () {
      if (!live()) return;
      if (editing) finish(true);
      S.lang = K.lang();
      light();
      refresh();
    });
  }

  // The source cut at its Japanese and English: [{a, b, L}], L "ja", "en" or "" (common to both), as the engine pairs
  // them: <ja>, <en>, and an element with lang="en" right after one with lang="ja".
  function pieces(src) {
    const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, found = [];
    let m, open = null;
    while ((m = TAG.exec(src))) {
      if (!m[2]) continue;
      const tag = m[2].toLowerCase(), self = VOID.has(tag) || /\/\s*$/.test(m[3]);
      if (open) {
        if (tag !== open.tag || self) continue;
        open.depth += m[1] ? -1 : 1;
        if (open.depth) continue;
        found.push({ L: open.L, own: open.own, from: open.from, a: open.a, b: m.index, to: m.index + m[0].length });
        open = null;
        continue;
      }
      if (m[1] || self) continue;
      const own = tag === "ja" || tag === "en", at = /\slang\s*=\s*["']?(ja|en)\b/i.exec(m[3]);
      if (own || at) open = { tag: tag, own: own, L: own ? tag : at[1].toLowerCase(), depth: 1, from: m.index, a: m.index + m[0].length };
    }
    const next = (x, y, L) => x && y && y.L === L && blank(src.slice(x.to, y.from));
    const list = found.filter((f, k) => f.own || (f.L === "ja" ? next(f, found[k + 1], "en") : found[k - 1] && found[k - 1].L === "ja" && next(found[k - 1], f, "en")));
    const out = [];
    let at = 0;
    list.forEach(function (f) {
      out.push({ a: at, b: f.from, L: "" }, { a: f.a, b: f.b, L: f.L });
      at = f.to;
    });
    out.push({ a: at, b: src.length, L: "" });
    return out.filter(p => p.L ? !blank(src.slice(p.a, p.b)) : !blank(src.slice(p.a, p.b).replace(/<\/?[a-zA-Z][^>]*>/g, "")));
  }

  // What el shows in edit mode, as units edited one by one: [{it, edit}]; null when el is one unit as a whole.
  function units(el) {
    const L = shown();
    if (el.hasAttribute("data-sed")) {
      if (!L) return null;
      el._one = null;
      const t = info(el), list = pieces(t.src);
      if (list.length === 1 && !list[0].L && !(L === "en" && JAPANESE.test(t.src))) return null;
      const out = [];
      list.forEach(function (p, k) {
        if (p.L && p.L !== L) {
          // Japanese without English shows in English too (the engine does so); it is not edited there
          if (p.L !== "ja" || (list[k + 1] && list[k + 1].L === "en")) return;
        }
        const text = t.src.slice(p.a, p.b);
        out.push({ L: p.L, it: { kind: "span", i: t.i, src: text, whole: t.src, a: p.a, b: p.b },
                   edit: p.L ? p.L === L : !(L === "en" && JAPANESE.test(text)) });
      });
      return out;
    }
    const of = i => ({ kind: "attr", i: +i, src: S.text.slice(D.attrs[+i].start, D.attrs[+i].end) });
    const ja = of(el.getAttribute("data-sedt")), en = el.hasAttribute("data-sedt-en") ? of(el.getAttribute("data-sedt-en")) : null;
    if (!langs || L === "ja") return null;
    if (!L) return en ? [{ it: ja, edit: true }, { it: en, edit: true }] : null;
    return en ? [{ it: en, edit: true }] : JAPANESE.test(ja.src) ? [{ it: ja, edit: false }] : null;
  }

  function info(el) {
    if (el._unit) return el._unit;
    if (el._one) return el._one;
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
    const box = src && src.querySelector(":scope > [data-sed]");
    const el = box && (box.classList.contains("sed-parts") ? box.querySelector(".sed-part") : box);
    if (!el) { msg("表紙のこの文は編集できません", 4000); return; }
    const pages = [].slice.call(document.querySelectorAll(".deck section.page"));
    const k = pages.indexOf(el.closest("section.page"));
    if (k >= 0 && location.hash !== "#s" + (k + 1)) location.hash = "#s" + (k + 1);   // the engine turns to it (hashchange)
    setTimeout(function () { if (live()) start(el, -1, -1); }, 80);
  }

  /* ===== Edit mode: every text stays as the engine has typeset it; the text being edited shows its TeX =====
     A text with several parts to edit apart (Japanese or English beside text common to both) shows them one by one,
     typeset by the engine (Kamishibai.typeset). Both languages at once: the source, with its <ja> and <en>. */
  const rendered = new WeakMap();   // el -> its nodes as the engine built them, while el shows something else
  const NO_EN = "この文には英語がありません（日本語か、日英を一度に編集する表示で直せます）";
  const keep = el => { if (!rendered.has(el)) rendered.set(el, [].slice.call(el.childNodes)); };
  function back(el) { if (rendered.has(el)) { el.replaceChildren(...rendered.get(el)); rendered.delete(el); } }
  function plainSource(el, src) {
    const s = document.createElement("span");
    s.className = "sed-src";
    s.textContent = src.trim();
    el.replaceChildren(s);
  }
  function partShown(s, u) {
    const K = window.Kamishibai, src = u.it.src.trim();
    if (!K || !K.typeset || (u.it.kind === "span" && !tokens(src))) { s.classList.add("sed-src"); s.textContent = src; return; }
    if (u.it.kind === "attr") s.textContent = unescape(src); else s.innerHTML = src;
    s.querySelectorAll("[id]").forEach(x => x.removeAttribute("id"));
    if (u.it.kind === "span" && u.L === shown() && u.L) s.classList.add("L-" + u.L);
    K.typeset(s);
  }
  function showSource(el) {
    if (el._unit) { partShown(el, { it: el._unit, L: el._L }); return; }
    back(el);
    el._one = null;
    const list = units(el);
    el.classList.toggle("sed-parts", !!list && list.length > 1);
    el.classList.toggle("sed-off", !!list && list.length === 1 && !list[0].edit);
    if (!list) {
      // both languages at once: the pairs themselves
      if (langs && both && el.hasAttribute("data-sed") && pieces(info(el).src).some(p => p.L)) { keep(el); plainSource(el, info(el).src); }
      return;
    }
    if (list.length === 1) { if (list[0].edit) el._one = list[0].it; return; }
    if (!list.length) return;
    keep(el);
    el.replaceChildren(...list.map(function (u) {
      const s = document.createElement("span");
      s.className = u.edit ? "sed-part" : "sed-off";
      if (u.edit) { s._unit = u.it; s._L = u.L; }
      else s.title = NO_EN;
      partShown(s, u);
      return s;
    }));
  }
  // The language or the choice of one or both changed: show the sources again.
  function refresh() {
    if (!document.body.classList.contains("sed-on")) return;
    document.querySelectorAll(".deck [data-sed], .deck [data-sedt]").forEach(showSource);
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
      if (on) showSource(el);
      else { back(el); el._one = null; el.classList.remove("sed-parts", "sed-off"); }
    });
  }

  /* ===== The source of one text as tokens =====
     {t, s, a, b}: "text", "math" (with its delimiters), "br", "ws" (a line end of the source with its indent), "raw"
     (an entity, a comment, any other tag: shown as it is written), "open" and "close" (an inline tag shown by its look,
     m: its mark). null when the tags are not well nested (a part of a longer text, or broken source). */
  const INLINE = new Set(["alert", "red", "navy", "orange", "blue", "green", "rem", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "span", "nobr", "cite", "code"]);
  function tokens(src) {
    const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'$<])*)>/g;   // no "$" or "<": a "<" of a math is not a tag
    const TEXT = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:\\[\s\S]|[^$\\])+?\$)|(\s*\n\s*)|(&(?:#\d+|#x[\da-fA-F]+|\w+);)/g;
    const out = [], stack = [];
    const add = (t, a, b, m) => { if (b > a) out.push({ t: t, s: src.slice(a, b), a: a, b: b, m: m }); };
    const text = function (from, to) {
      const part = src.slice(from, to);
      let m, at = 0;
      TEXT.lastIndex = 0;
      while ((m = TEXT.exec(part))) {
        add("text", from + at, from + m.index);
        at = m.index + m[0].length;
        add(m[1] ? "math" : m[2] ? "ws" : "raw", from + m.index, from + at);
      }
      add("text", from + at, to);
    };
    let m, at = 0;
    while ((m = TAG.exec(src))) {
      text(at, m.index);
      const a = m.index;
      at = a + m[0].length;
      const tag = (m[2] || "").toLowerCase();
      if (!tag) { add("raw", a, at); continue; }
      if (tag === "br" && !m[1]) { add("br", a, at); continue; }
      if (VOID.has(tag) || /\/\s*$/.test(m[3])) { add("raw", a, at); continue; }
      if (!m[1]) {
        const mark = INLINE.has(tag) && !/\s(?:lang|step|with)\b/i.test(m[3]) ? { tag: tag, open: m[0] } : null;
        stack.push({ tag: tag, mark: mark });
        add(mark ? "open" : "raw", a, at, mark);
        continue;
      }
      const top = stack.pop();
      if (!top || top.tag !== tag) return null;
      add(top.mark ? "close" : "raw", a, at, top.mark);
    }
    text(at, src.length);
    return stack.length ? null : out;
  }
  // In a math the author writes < and >. In the source a "<" that HTML would read as a tag is "&lt;"; a text whose source
  // writes them another way throughout keeps it. shownMath: {src, style}, null style: shown as it is.
  const inMath = function (src, fn) {
    const list = tokens(src);
    return list ? list.map(t => t.t === "math" ? fn(t.s) : t.s).join("") : src;
  };
  const MATH_STYLES = [{}, { lt: 1 }, { gt: 1 }, { lt: 1, gt: 1 }];
  function writeMath(src, st) {
    return inMath(src, function (x) {
      x = x.replace(st.lt ? /</g : /<(?=[a-zA-Z\/!?])/g, "&lt;");
      return st.gt ? x.replace(/>/g, "&gt;") : x;
    });
  }
  function shownMath(core) {
    const src = inMath(core, x => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    const st = MATH_STYLES.find(m => writeMath(src, m) === core);
    return st ? { src: src, style: st } : { src: core, style: MATH_STYLES[0] };
  }
  const isDisplay = t => t && t.t === "math" && /^(?:\$\$|\\\[)/.test(t.s);

  /* ===== The text being edited, by its look =====
     rich: {el, hist, at}. The DOM of el is made from the tokens and read back as source (flat); marks (<alert>, <b> …)
     are the elements themselves, with their start tag in data-open, so that the source comes back byte for byte. */
  const ZW = "​";   // beside a mark with no text next to it, so that the caret can stand there; not in the source
  let rich = null;
  function draw(el, list) {
    const root = document.createDocumentFragment(), path = [root];
    const top = () => path[path.length - 1];
    const gap = () => { const l = top().lastChild; if (!l || l.nodeType !== 3) top().appendChild(document.createTextNode(ZW)); };
    list.forEach(function (t, k) {
      if (t.t === "open") {
        gap();
        const x = document.createElement("template");
        x.innerHTML = t.s + "</" + t.m.tag + ">";
        const e = x.content.firstElementChild;
        e.removeAttribute("id");
        if (t.m.tag === "alert") e.classList.add("k");
        e.setAttribute("data-open", t.s);
        top().appendChild(e);
        path.push(e);
      } else if (t.t === "close") {
        path.pop();
        const n = list[k + 1];
        if (!n || n.t === "br" || n.t === "ws" || n.t === "open" || n.t === "close") gap();
      } else if (t.t === "br") {
        const e = document.createElement("br");
        e.setAttribute("data-src", t.s);
        top().appendChild(e);
        if (!list[k + 1] || list[k + 1].t === "br") gap();
      } else if (t.t === "ws") {
        const e = document.createElement("span"), p = list[k - 1], n = list[k + 1];
        e.className = (p && p.t === "br") || (n && n.t === "br") ? "sed-ws sed-ws0" : "sed-ws";
        e.setAttribute("data-src", t.s);
        e.textContent = isDisplay(p) || isDisplay(n) ? "\n" : " ";
        top().appendChild(e);
      } else {
        const l = top().lastChild;
        if (l && l.nodeType === 3) l.data = (l.data === ZW ? "" : l.data) + t.s;
        else top().appendChild(document.createTextNode(t.s));
      }
    });
    el.replaceChildren(root);
    if (!el.firstChild) el.appendChild(document.createTextNode(ZW));
  }
  // The source the DOM of el stands for, and where each node of it is: {src, at: node -> [start, end, inner start]}
  function flat(el) {
    let src = "";
    const at = new Map();
    const walk = function (n) {
      const from = src.length;
      if (n.nodeType === 3) { src += n.data.split(ZW).join(""); at.set(n, [from, src.length]); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === "BR") {
        if (n.hasAttribute("data-src")) src += n.getAttribute("data-src");
        else if (n !== el.lastChild) src += "<br>";   // the last one: Chrome's own, holding the line open
        at.set(n, [from, src.length]);
        return;
      }
      if (n.classList.contains("sed-ws")) {
        // what Chrome typed into it stays behind the line end
        const t = n.textContent.split(ZW).join("");
        src += /^[ \n]/.test(t) ? n.getAttribute("data-src") + t.slice(1) : t;
        at.set(n, [from, src.length]);
        n.childNodes.forEach(c => at.set(c, [from, src.length, n]));
        return;
      }
      const open = n === el ? "" : n.getAttribute("data-open") || "";
      src += open;
      const inner = src.length;
      n.childNodes.forEach(walk);
      if (open && src.length === inner) { src = src.slice(0, from); at.set(n, [from, from, from]); return; }   // nothing left in it
      const end = src.length;
      if (open) src += "</" + n.tagName.toLowerCase() + ">";
      at.set(n, [from, src.length, inner, end]);
    };
    walk(el);
    return { src: src, at: at };
  }
  // A point of the DOM as an offset of the source, and back.
  function toSrc(f, node, off) {
    const p = f.at.get(node);
    if (!p) return f.src.length;
    if (node.nodeType === 3) {
      const ws = p[2];
      if (ws) {
        if (!off) return p[0];
        return Math.min(p[1], p[0] + ws.getAttribute("data-src").length + off - 1);
      }
      return p[0] + node.data.slice(0, off).split(ZW).join("").length;
    }
    if (node.tagName === "BR") return p[0];
    const kid = node.childNodes[off];
    if (kid && f.at.has(kid)) return f.at.get(kid)[0];
    return p[3] === undefined ? p[1] : p[3];
  }
  function toDom(el, f, pos) {
    let best = null;
    f.at.forEach(function (p, n) {
      if (best || n.nodeType !== 3 || p[2]) return;
      if (pos < p[0] || pos > p[1]) return;
      let off = 0, left = pos - p[0];
      while (off < n.data.length && (left > 0 || n.data[off] === ZW)) { if (n.data[off] !== ZW) left--; off++; }
      best = [n, off];
    });
    if (best) return best;
    f.at.forEach(function (p, n) {   // before a node, or in a place with no text
      if (best || n === el || !n.parentNode || (n.nodeType === 3 && p[2])) return;
      if (p[0] === pos || (p[0] < pos && pos < p[1] && (n.tagName === "BR" || n.classList.contains("sed-ws"))))
        best = [n.parentNode, [].indexOf.call(n.parentNode.childNodes, n)];
    });
    return best || [el, el.childNodes.length];
  }
  function selected() {
    const sel = getSelection(), el = rich.el;
    if (!sel.rangeCount || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
    const r = sel.getRangeAt(0), f = flat(el);
    return { src: f.src, a: toSrc(f, r.startContainer, r.startOffset), b: toSrc(f, r.endContainer, r.endOffset) };
  }
  function select(el, a, b) {
    const f = flat(el), p = toDom(el, f, a), q = b === a ? p : toDom(el, f, b);
    const r = document.createRange();
    r.setStart(p[0], p[1]);
    r.setEnd(q[0], q[1]);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  // Math and tags shown as written get their color without touching the DOM (CSS highlights).
  function paint() {
    if (!window.Highlight || !CSS.highlights) return;
    const math = [], tag = [];
    if (rich) {
      const f = flat(rich.el), list = tokens(f.src);
      (list || []).forEach(function (t) {
        if (t.t !== "math" && t.t !== "raw") return;
        f.at.forEach(function (p, n) {
          if (n.nodeType !== 3 || p[2] || p[1] <= t.a || p[0] >= t.b) return;
          const r = document.createRange(), x = toDom(rich.el, { src: f.src, at: new Map([[n, p]]) }, Math.max(t.a, p[0])),
                y = toDom(rich.el, { src: f.src, at: new Map([[n, p]]) }, Math.min(t.b, p[1]));
          r.setStart(x[0], x[1]); r.setEnd(y[0], y[1]);
          (t.t === "math" ? math : tag).push(r);
        });
      });
    }
    CSS.highlights.set("sed-math", new Highlight(...math));
    CSS.highlights.set("sed-tag", new Highlight(...tag));
  }

  // Undo while editing: Chrome's own does not survive a redraw, so the sources are kept here.
  function remember(typed) {
    const now = selected(), h = rich.hist, cur = h[rich.at];
    if (!now) return;
    if (now.src === cur.src) { cur.a = now.a; cur.b = now.b; return; }
    h.length = rich.at + 1;
    const t = Date.now();
    if (typed && cur.typed && t - cur.t < 700) { cur.src = now.src; cur.a = now.a; cur.b = now.b; cur.t = t; return; }
    h.push({ src: now.src, a: now.a, b: now.b, typed: typed, t: t });
    rich.at = h.length - 1;
  }
  function step(d) {
    const h = rich.hist[rich.at + d];
    if (!h) return;
    rich.at += d;
    h.typed = false;
    put(h.src, h.a, h.b, true);
  }
  function put(src, a, b, quiet) {
    const list = tokens(src);
    if (!list) { msg("この範囲では、ほかの書き方と入れ違いになるので付け外しできません", 5000); return false; }
    draw(rich.el, list);
    select(rich.el, a, b);
    if (!quiet) remember(false);
    paint();
    bubble();
    return true;
  }

  /* Marks on the selection. The source is cut into cells (a character, a math, a line break …), each with the marks
     around it; marks are put on or taken off the cells, and the cells written out again. */
  const COLORS = ["alert", "navy", "red", "orange", "blue", "green"];
  function cellsOf(list) {
    const out = [], on = [];
    list.forEach(function (t) {
      if (t.t === "open") on.push(t.m);
      else if (t.t === "close") on.pop();
      else if (t.t === "text") for (let i = 0; i < t.s.length; i++) out.push({ t: "text", s: t.s[i], a: t.a + i, b: t.a + i + 1, on: on.slice() });
      else out.push({ t: t.t, s: t.s, a: t.a, b: t.b, on: on.slice() });
    });
    return out;
  }
  const plainMark = m => m.open === "<" + m.tag + ">";
  function writeCells(cells) {
    let src = "", on = [];
    const opened = new Set();
    let ok = true;
    const to = function (want) {
      let k = 0;
      while (k < on.length && k < want.length && on[k] === want[k]) k++;
      for (let j = on.length - 1; j >= k; j--) src += "</" + on[j].tag + ">";
      for (let j = k; j < want.length; j++) {
        if (opened.has(want[j]) && !plainMark(want[j])) ok = false;   // a mark with attributes is not cut in two
        opened.add(want[j]);
        src += want[j].open;
      }
      on = want;
    };
    cells.forEach(function (c) { to(c.on); c.na = src.length; src += c.s; c.nb = src.length; });
    to([]);
    return ok ? src : null;
  }
  const picked = (cells, a, b) => cells.filter(c => a === b ? c.t === "math" && c.a < a && c.b > a : c.b > a && c.a < b);
  const solid = c => c.t !== "ws" && c.t !== "br" && !/^\s$/.test(c.s);
  function toggleMark(tag) {
    const now = selected(), list = now && tokens(now.src);
    if (!list) return;
    const cells = cellsOf(list), has = c => c.on.filter(m => m.tag === tag);
    let pick = picked(cells, now.a, now.b);
    if (now.a === now.b) {
      // no selection: the whole mark around the caret comes off; in a math, the math is taken
      const near = cells.filter(c => c.a <= now.a && c.b >= now.a), marks = near.map(c => has(c)).find(x => x.length);
      if (marks) pick = cells.filter(c => c.on.indexOf(marks[marks.length - 1]) >= 0);
      else if (!pick.length) { msg("飾りを付ける範囲を選んでください", 3000); return; }
    }
    if (!pick.some(solid)) return;
    const off = pick.filter(solid).every(c => has(c).length);
    const drop = off ? [tag] : COLORS.indexOf(tag) >= 0 ? COLORS : [tag];
    if (off) pick.forEach(c => { c.on = c.on.filter(m => m.tag !== tag); });
    else {
      const set = new Set(pick), i = cells.indexOf(pick[0]), j = cells.indexOf(pick[pick.length - 1]);
      // joined to a neighbor with the same mark; outside the marks that lie wholly in the selection, else inside
      const same = [cells[i - 1], cells[j + 1]].concat(pick).filter(c => c && c.on[0] && c.on[0].tag === tag && plainMark(c.on[0]))[0];
      const mark = same ? same.on[0] : { tag: tag, open: "<" + tag + ">" };
      const base = pick[0].on.filter(m => pick.every(c => c.on.indexOf(m) >= 0) && cells.some(c => !set.has(c) && c.on.indexOf(m) >= 0));
      pick.forEach(function (c) {
        const rest = c.on.filter(m => drop.indexOf(m.tag) < 0 || (!plainMark(m)));
        const k = rest.filter(m => base.indexOf(m) >= 0).length;
        c.on = same && !base.length ? [mark].concat(rest) : rest.slice(0, k).concat([mark], rest.slice(k));
      });
    }
    const src = writeCells(cells);
    if (src === null) { msg("class などの付いた飾りの一部だけは付け外しできません", 5000); return; }
    put(src, pick[0].na, pick[pick.length - 1].nb);
  }
  // The part a..b of the source, with the marks around it (for copying).
  function slice(now) {
    const list = tokens(now.src);
    if (!list) return now.src.slice(now.a, now.b);
    const c = cellsOf(list).filter(x => x.t === "math" ? x.b > now.a && x.a < now.b : x.b > now.a && x.a < now.b);
    c.forEach(function (x) { if (x.t === "math") x.s = now.src.slice(Math.max(x.a, now.a), Math.min(x.b, now.b)); });
    return writeCells(c) || c.map(x => x.s).join("");
  }
  function insert(text) {
    const now = selected();
    if (!now) return;
    const list = tokens(now.src);
    let src;
    if (list && now.a !== now.b) {
      // the selected cells go, what is around them stays well nested
      const cells = cellsOf(list), keepCells = [];
      let placed = false;
      cells.forEach(function (c) {
        if (c.b <= now.a || c.a >= now.b) { keepCells.push(c); return; }
        if (c.t === "math" && (c.a < now.a || c.b > now.b)) {
          const l = now.src.slice(c.a, Math.max(c.a, now.a)), r = now.src.slice(Math.min(c.b, now.b), c.b);
          keepCells.push({ t: "math", s: l + (placed ? "" : text) + r, on: c.on, mark: placed ? 0 : l.length + text.length });
          placed = true;
          return;
        }
        if (!placed) { keepCells.push({ t: "text", s: text, on: c.on, mark: text.length }); placed = true; }
      });
      src = writeCells(keepCells);
      const m = keepCells.find(c => c.mark !== undefined), p = m ? m.na + m.mark : now.a;
      if (src !== null) { put(src, p, p); return; }
    }
    src = now.src.slice(0, now.a) + text + now.src.slice(now.b);
    put(src, now.a + text.length, now.a + text.length);
  }
  function lineBreak() {
    const now = selected(), list = now && tokens(now.src);
    if (!list) return;
    insert(list.some(t => (t.t === "math" || t.t === "raw") && t.a < now.a && now.a < t.b) ? "\n" : "<br>");
  }

  // The small bar over the text being edited.
  const FMT = [["alert", "強調（" + (MAC ? "⌘" : "Ctrl+") + "K）", "var(--alert)"], ["navy", "色（" + (MAC ? "⌘⇧" : "Ctrl+Shift+") + "K）", "var(--navy)"],
               ["orange", "橙", "var(--c-orange)"], ["blue", "青", "var(--c-blue)"], ["green", "緑", "var(--c-green)"],
               ["b", "太字（" + (MAC ? "⌘" : "Ctrl+") + "B）", "#000"]];
  function bubble() {
    let b = document.querySelector(".sed-fmt");
    if (!rich) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("div");
      b.className = "sed-fmt";
      const add = function (html, title, run, tag) {
        const x = document.createElement("button");
        x.type = "button";
        x.innerHTML = html;
        x.title = title;
        if (tag) x.dataset.tag = tag;
        x.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); run(); });
        b.appendChild(x);
      };
      FMT.forEach(f => add('<i style="color:' + f[2] + '">' + (f[0] === "b" ? "B" : "あ") + "</i>", f[1], () => toggleMark(f[0]), f[0]));
      add("↵", "改行（Shift+Enter）", lineBreak);
      document.body.appendChild(b);
    }
    const r = rich.el.getBoundingClientRect(), h = b.offsetHeight;
    b.style.left = Math.max(4, Math.min(r.left, innerWidth - b.offsetWidth - 4)) + "px";
    b.style.top = (r.top - h - 6 > 4 ? r.top - h - 6 : Math.min(r.bottom + 6, innerHeight - h - 4)) + "px";
    const now = selected(), list = now && tokens(now.src);
    const pick = list ? (now.a === now.b ? cellsOf(list).filter(c => c.a <= now.a && c.b >= now.a) : picked(cellsOf(list), now.a, now.b)).filter(solid) : [];
    b.querySelectorAll("button[data-tag]").forEach(function (x) {
      const t = x.dataset.tag, on = c => c.on.some(m => m.tag === t);
      x.classList.toggle("on", pick.length > 0 && (now.a === now.b ? pick.some(on) : pick.every(on)));
    });
  }
  // Keys in the text being edited by its look; true: done here.
  function richKey(e) {
    if (e.isComposing) return false;
    const m = MAC ? e.metaKey : e.ctrlKey, done = fn => { e.preventDefault(); fn(); return true; };
    if (m && !e.altKey) {
      if (e.code === "KeyB" && !e.shiftKey) return done(() => toggleMark("b"));
      if (e.code === "KeyK") return done(() => toggleMark(e.shiftKey ? "navy" : "alert"));
      if (e.code === "KeyZ") return done(() => step(e.shiftKey ? 1 : -1));
      if (e.code === "KeyY" && !MAC) return done(() => step(1));
    }
    if (e.key === "Enter" && e.shiftKey) return done(lineBreak);
    if (e.key === "Backspace" || e.key === "Delete") {
      // pass over the marks of places that are not in the source
      const s = getSelection(), n = s.anchorNode, o = s.anchorOffset;
      if (s.isCollapsed && n && n.nodeType === 3 && n.data[e.key === "Delete" ? o : o - 1] === ZW) s.collapse(n, e.key === "Delete" ? o + 1 : o - 1);
    }
    return false;
  }

  /* ===== Editing ===== */
  // Where a click on the typeset text is in its source: after how many maths, and how many characters after the last.
  function clickAt(el, core, x, y) {
    const cr = x >= 0 && document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    if (!cr || !el.contains(cr.startContainer)) return -1;
    const hit = document.elementFromPoint(x, y), inMath = hit && el.contains(hit) && hit.closest(".katex");
    const stop = inMath || cr.startContainer, count = t => t.replace(/[\s​]/g, "").length;
    let maths = 0, chars = 0, done = false;
    const walk = function (n) {
      if (done) return;
      if (n.nodeType === 3) {
        if (n === stop) { chars += count(n.data.slice(0, cr.startOffset)); done = true; return; }
        chars += count(n.data);
        return;
      }
      if (n.nodeType !== 1 || !n.getClientRects().length && n.tagName !== "BR" && n.matches(".L-ja, .L-en")) return;
      if (n.classList.contains("katex")) {
        if (n === stop || n.contains(stop)) { done = true; maths++; chars = -1; return; }
        maths++; chars = 0;
        return;
      }
      if (n.classList.contains("arw")) { chars++; return; }
      n.childNodes.forEach(walk);
      if (n === stop) done = true;
    };
    walk(el);
    if (!done) return -1;
    const list = tokens(core) || [{ t: "text", s: core, a: 0, b: core.length }];
    let m = 0, c = 0, after = 0;
    for (const t of list) {
      if (t.t === "math") {
        m++; c = 0;
        if (m === maths && chars < 0) return t.a;
        if (m === maths && chars === 0) return t.b + /^[ \t]*/.exec(core.slice(t.b))[0].length;   // the text after the space of the source
        if (m > maths) return after;
      } else if (m === maths && t.t === "text") {
        for (let i = 0; i < t.s.length; i++) {
          if (c === chars) return t.a + i;
          if (!/[\s​]/.test(t.s[i])) c++;
          after = t.a + i + 1;
        }
        if (c === chars) return t.b;
      } else if (m === maths && t.t === "raw" && t.s[0] === "&") { if (c === chars) return t.a; c++; after = t.b; }
    }
    return core.length;
  }

  function start(el, x, y) {
    if (editing) finish(true);
    const it = info(el), src = it.src;
    const lead = src.match(/^\s*/)[0], trail = src.slice(lead.length).match(/\s*$/)[0];
    const raw = src.slice(lead.length, src.length - trail.length);
    const sm = it.kind === "span" ? shownMath(raw) : { src: raw };
    let core = sm.src;
    // Where the click landed, so that the caret goes there: in the source shown, or in the typeset text.
    let at = -1;
    const cr = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    if (cr && cr.startContainer.nodeType === 3 && el.contains(cr.startContainer) && cr.startContainer.parentNode.closest(".sed-src")) at = cr.startOffset;
    else at = clickAt(el, core, x, y);
    if (!el._unit) keep(el);
    editing = el;
    S.editing = true;
    el.classList.remove("sed-src");
    // By its look, when the source comes back byte for byte; else (and for attributes) as plain text.
    let list = it.kind === "span" && !core.includes(ZW) && !/\r/.test(core) ? tokens(core) : null;
    if (list) {
      draw(el, list);
      if (flat(el).src !== core) list = null;
      else rich = { el: el, hist: [{ src: core, a: 0, b: 0 }], at: 0 };
    }
    if (!list) el.textContent = core = raw;
    el._sed = { it: it, lead: lead, trail: trail, core: core, style: list && sm.style };
    el.classList.add("sed-editing");
    try { el.contentEditable = "plaintext-only"; } catch (e) { el.contentEditable = "true"; }
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.focus();
    if (rich) {
      const p = at >= 0 && at <= core.length ? at : core.length;
      select(el, p, p);
      rich.hist[0].a = rich.hist[0].b = p;
      paint();
      bubble();
      return;
    }
    const r = document.createRange();
    if (at >= 0 && el.firstChild && at <= el.firstChild.length) { r.setStart(el.firstChild, at); r.collapse(true); }
    else { r.selectNodeContents(el); r.collapse(false); }
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  addEventListener("input", function (e) {
    if (!live() || !rich || e.target !== rich.el || e.isComposing) return;
    remember(true);
    paint();
    bubble();
  }, true);
  addEventListener("compositionend", function (e) {
    if (live() && rich && e.target === rich.el) setTimeout(function () { if (live() && rich) { remember(true); paint(); bubble(); } }, 0);
  }, true);
  addEventListener("beforeinput", function (e) {
    if (!live() || !rich || e.target !== rich.el) return;
    if (/^history/.test(e.inputType)) { e.preventDefault(); step(e.inputType === "historyUndo" ? -1 : 1); }
    else if (/^(?:insertParagraph|insertLineBreak)$/.test(e.inputType)) e.preventDefault();
  }, true);
  ["copy", "cut", "paste"].forEach(k => addEventListener(k, function (e) {
    if (!live() || !rich || !rich.el.contains(e.target)) return;
    const now = selected();
    if (!now) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === "paste") { insert(e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n").split(ZW).join("")); return; }
    if (now.a === now.b) return;
    e.clipboardData.setData("text/plain", slice(now));
    if (k === "cut") insert("");
  }, true));
  document.addEventListener("selectionchange", function () { if (live() && rich) bubble(); });
  addEventListener("resize", function () { if (live() && rich) bubble(); });

  function restore(el) {
    el.removeAttribute("contenteditable");
    el.classList.remove("sed-editing");
    if (S.edit) showSource(el); else back(el);
  }

  function finish(save) {
    const el = editing;
    if (!el) return;
    const st = el._sed;
    const text = rich ? flat(el).src : el.innerText.replace(/ /g, " ").replace(/\n$/, "");
    editing = null;
    S.editing = false;
    rich = null;
    paint();
    bubble();
    if (!save || text === st.core) { restore(el); msg(""); return; }
    msg("保存中…");
    write(st.it, st.lead + (st.style ? writeMath(text, st.style) : text) + st.trail).catch(async function (e) {
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
    if (!s || cur.slice(s.start, s.end) !== (it.whole === undefined ? it.src : it.whole) || (it.kind === "attr" && D.attrs[it.i] && s.attr !== D.attrs[it.i].attr)) {
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
    } else if (it.whole !== undefined) next = cur.slice(0, s.start + it.a) + neu + cur.slice(s.start + it.b);   // one piece of the text
    else next = cur.slice(0, s.start) + neu + cur.slice(s.end);
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
    const el = e.target.closest && e.target.closest(".sed-part, [data-sed], [data-sedt]");
    if (!el || !el.closest(".deck")) return null;
    if (e.target.closest(".sed-off")) return null;
    if (!el.classList.contains("sed-parts")) return el;
    const ps = el.querySelectorAll(":scope > .sed-part");   // beside the parts: the only one there is
    return ps.length === 1 ? ps[0] : null;
  }

  // Capture phase on window: runs before WebSlide's handlers, so the page does not turn.
  addEventListener("click", function (e) {
    if (!live()) return;
    if (editing && editing.contains(e.target)) { e.stopPropagation(); return; }
    if (e.target.closest && e.target.closest(".sed-fmt")) { e.stopPropagation(); return; }
    if (!S.edit || !enabled) return;
    const j = e.target.closest && e.target.closest(".deck [data-sed-jump]");
    if (j && !target(e)) { e.preventDefault(); e.stopPropagation(); jump(j.getAttribute("data-sed-jump")); return; }
    const el = target(e);
    if (!el && e.target.closest && e.target.closest(".deck .sed-off")) msg(NO_EN, 4000);
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
      if (rich && richKey(e)) return;
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
