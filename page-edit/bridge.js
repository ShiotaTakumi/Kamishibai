/* page-edit: between the page (edit.js) and the extension (files.js, folder.js), in the isolated world of the page.
   edit.js sends a port by postMessage; its requests go to files.js and the answers back through the port. Runs at
   document_start, before any script of the page, and listens for nothing but that port. */
(function () {
  "use strict";
  // Folders kept by 3.11 and before lie in the storage of file:// pages. They are not read any more, and cannot be
  // moved to the extension: removed.
  ["page-edit", "slide-edit"].forEach(n => { try { indexedDB.deleteDatabase(n); } catch (e) { /* storage unavailable */ } });

  const RENEWED = "page-edit の拡張が新しくなりました。ページを再読み込みしてください";
  const asked = new Map();   // ask id -> what to do when its window has been answered (true or false)
  const early = new Map();   // answers that came before the request knew its ask id

  async function send(req) {
    let r;
    try { r = await chrome.runtime.sendMessage(req); }
    catch (e) { throw new Error(chrome.runtime && chrome.runtime.id ? String(e && e.message || e) : RENEWED); }
    if (!r) throw new Error("page-edit の拡張が答えません。ページを再読み込みしてください");
    if (r.error) throw r.error;
    return r.ok;
  }
  const answered = id => new Promise(function (ok) {
    if (early.has(id)) { ok(early.get(id)); early.delete(id); } else asked.set(id, ok);
  });

  // One request of the page. What shows a window or changes the list of folders needs the author's click or key.
  async function run(req, say) {
    const op = String(req.op), acted = navigator.userActivation.isActive;
    if ((op === "dirs" || op === "forget" || op === "front" || op === "export") && !acted) throw new Error("クリックかキーの操作の直後にだけ使えます");
    const q = Object.assign({}, req, { op: op, ask: !!req.ask && acted });
    for (;;) {
      const when = Date.parse(document.lastModified);
      q.when = isNaN(when) ? 0 : when;
      const r = await send(q);
      if (!r.wait) return r;
      say(r.say);
      if (!await answered(r.wait)) throw { name: "AbortError", message: "no folder was chosen" };
      q.ask = false; q.fresh = false;
    }
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.pageEdit !== "link" || !e.ports[0]) return;
    e.stopImmediatePropagation();
    const port = e.ports[0];
    port.onmessage = function (m) {
      const d = m.data || {};
      run(d.req || {}, t => port.postMessage({ id: d.id, say: t })).then(
        ok => port.postMessage({ id: d.id, ok: ok }),
        x => port.postMessage({ id: d.id, error: { name: x.name || "", message: String(x.message || x), conflict: x.conflict } }));
    };
    port.postMessage({ hello: true });
  }, true);

  chrome.runtime.onMessage.addListener(function (m, s, reply) {
    if (m === "alive") { reply(new URL(location.href).pathname); return; }
    if (!m || !m.ask) return;
    const ok = asked.get(m.ask);
    asked.delete(m.ask);
    if (ok) ok(!!m.done); else early.set(m.ask, !!m.done);
  });
})();
