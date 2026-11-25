/* page-edit: the folders the author allowed, kept in the extension's own storage, and the drafts found in them.
   Loaded by the service worker (files.js) and by the window that asks for a folder (folder.html). Pages opened from
   file:// have another origin: their scripts reach neither this storage nor the handles in it.

   IndexedDB "page-edit" of the extension:
   - dirs   "list" -> [{id, dir}], the folders kept, the latest first
   - open   tab id -> {path, root, dirs, name}: the draft open in that tab, inside folder root
   - asks   id -> {id, tab, win, popup, url, when, kept, dead}: a window that asks for a folder */
"use strict";
const STORES = ["dirs", "open", "asks"], LIST = "list", RW = { mode: "readwrite" };
function idb(store, mode, fn) {
  return new Promise(function (resolve, reject) {
    const r = indexedDB.open("page-edit", 1);
    let over = false;
    const late = setTimeout(() => { over = true; reject(new Error("the store of kept folders does not answer")); }, 1500);
    r.onupgradeneeded = () => STORES.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
    r.onerror = () => { clearTimeout(late); reject(r.error); };
    r.onblocked = () => { clearTimeout(late); reject(new Error("the store of kept folders is in use")); };
    r.onsuccess = function () {
      clearTimeout(late);
      const db = r.result;
      if (over) { db.close(); return; }
      db.onversionchange = () => db.close();
      let tx, q;
      try { tx = db.transaction(store, mode); q = fn(tx.objectStore(store)); }
      catch (e) { db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(q && q.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
const stored = (store, key) => idb(store, "readonly", s => s.get(key));
const storedAll = store => idb(store, "readonly", s => s.getAll());
const keep = (store, key, v) => idb(store, "readwrite", s => s.put(v, key));
const drop = (store, key) => idb(store, "readwrite", s => key === undefined ? s.clear() : s.delete(key));

const named = function (name, message) { const e = new Error(message); e.name = name; return e; };

// A folder kept by an earlier Chrome can come back dead after an update: none of its methods ever settles (seen in
// Chrome 158, 2026-11-24). So the first call on a kept folder is given up after a while. Not for calls that show a prompt.
const DEAD = {};
const answer = p => Promise.race([p, new Promise((ok, no) => setTimeout(() => no(DEAD), 1500))]);

async function keptDirs() {
  try { return (await stored("dirs", LIST)) || []; } catch (e) { return []; }
}
// Whether kept folder x is folder d: true, false, or null when that cannot be told now (it does not answer in
// time, or fails for a reason other than being gone). Only a folder that is gone (NotFoundError) counts as d, so
// that it is dropped; one that is slow for a moment stays in the list.
const sameAs = (x, d) => answer(x.isSameEntry(d)).catch(e => e && e.name === "NotFoundError" ? true : null);
async function keepDir(d) {
  const list = await keptDirs();
  // the others stay, except this same folder and those that are gone
  const same = await Promise.all(list.map(x => sameAs(x.dir, d)));
  const out = [{ id: crypto.randomUUID(), dir: d }].concat(list.filter((x, i) => same[i] !== true));
  try { await keep("dirs", LIST, out); } catch (e) { /* storage unavailable */ }
}
// Forget the kept folder id (null: all of them). By its id, not by isSameEntry, so that a folder that no longer
// answers can be forgotten too. An open tab keeps its draft until it is loaded again (store "open").
async function forgetDir(id) {
  const list = id === null ? [] : await keptDirs(), out = list.filter(x => x.id !== id);
  if (id !== null && out.length === list.length) throw new Error("覚えているフォルダの一覧が、ほかのタブで変わっていました。一覧を開き直してください");
  await keep("dirs", LIST, out);
}

const allowed = async d => await d.queryPermission(RW) === "granted";

// The folders and the name on the path of a page ("file:///a/b/c.html": ["a", "b", "c.html"]).
const partsOf = url => new URL(url).pathname.split("/").filter(Boolean).map(decodeURIComponent);

function same(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
// Whether file fh is the one the page at url shows. A handle does not know where it is, so the file at the page's
// own path is read and compared: a draft of the same name in another folder of the same name is not taken for it.
// Once again a moment later, for a file that was being written.
async function isPage(fh, url) {
  for (let k = 0; ; k++) {
    const at = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
    if (await same(at, await (await fh.getFile()).arrayBuffer())) return true;
    if (k) return false;
    await new Promise(r => setTimeout(r, 150));
  }
}
async function dirOf(root, dirs) { let h = root; for (const q of dirs) h = await h.getDirectoryHandle(q); return h; }
const fileOf = async at => (await dirOf(at.root, at.dirs)).getFileHandle(at.name);
// The draft at url inside folder d: d's name is one of the folders on the page's path, and the rest of the path
// leads from there to the same file. {root, dirs, name, gap}, gap how far the file's date is from the page's own
// (when several copies are alike, the nearest one), or null.
async function findIn(d, url, when) {
  const ps = partsOf(url), name = ps[ps.length - 1];
  let best = null;
  for (let i = 0; i < ps.length - 1; i++) {
    if (ps[i] !== d.name) continue;
    try {
      const at = { root: d, dirs: ps.slice(i + 1, ps.length - 1), name: name }, fh = await fileOf(at);
      const g = when ? Math.abs((await fh.getFile()).lastModified - when) : 0;
      if (best && g >= best.gap) continue;
      if (await isPage(fh, url)) best = Object.assign(at, { gap: g });
    } catch (e) { /* not this one */ }
  }
  return best;
}
