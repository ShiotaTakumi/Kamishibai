/* page-edit: the small window that asks for a folder (folder.html#ID, ID of store "asks"; opened by files.js).
   Once a folder is allowed it stays, minimized, while a draft is being edited: with "allow this time" Chrome takes
   the permission back when the last window of the extension is closed. One such window is enough. */
"use strict";
const ID = location.hash.slice(1), $ = id => document.getElementById(id);
const show = function (t) { $("say").textContent = t; };

function button(text, main, run) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (main) b.className = "main";
  b.addEventListener("click", () => act(run));
  $("buttons").appendChild(b);
}
// One at a time: the button pressed, or the folder dropped.
let busy = false;
async function act(run) {
  if (busy) return;
  busy = true;
  const all = $("buttons").querySelectorAll("button");
  all.forEach(x => { x.disabled = true; });
  show("");
  try { await run(); } catch (e) { show(told(e)); }
  all.forEach(x => { x.disabled = false; });
  busy = false;
}
// A folder dropped on the window, anywhere in it. Nothing else is done with what is dropped: without this, Chrome would
// show the folder in this window, and what is being asked for (or the permissions it holds) would be gone.
let onDrop = null;
addEventListener("dragover", function (e) {
  e.preventDefault();
  const takes = !!onDrop && !busy && e.dataTransfer.types.includes("Files");
  e.dataTransfer.dropEffect = takes ? "copy" : "none";
  $("drop").classList.toggle("over", takes);
});
addEventListener("dragleave", e => { if (!e.relatedTarget) $("drop").classList.remove("over"); });
addEventListener("drop", function (e) {
  e.preventDefault();
  $("drop").classList.remove("over");
  const items = [].filter.call(e.dataTransfer.items, x => x.kind === "file");
  if (!onDrop || busy || !items.length) return;
  // The handles are taken at once (after the event the items are empty) and outside act: for a folder Chrome does not
  // give to pages it puts up a screen of its own first, and the buttons are not to wait for that.
  Promise.all(items.map(x => x.getAsFileSystemHandle())).then(function (got) {
    if (onDrop) act(() => onDrop(got));
  }, function (e) {
    show(e.name === "AbortError" ? "Chrome では、このフォルダは選べません。原稿のフォルダかプロジェクトのフォルダを入れてください" : told(e));
  });
});
// The folder of the page at url, as the folder pickers take it ("/a/b"; on Windows "C:\\a\\b" or "\\\\host\\a").
function folderPath(url) {
  const u = new URL(url), p = "/" + partsOf(url).slice(0, -1).join("/");
  if (u.hostname) return ("//" + u.hostname + p).replace(/\//g, "\\");
  return /^\/[A-Za-z]:/.test(p) ? (p.slice(1) + (p.length === 3 ? "/" : "")).replace(/\//g, "\\") : p;
}
const PASTE = /Mac/.test(navigator.platform) ? "⌘⇧G、⌘V、return の順に押すと、この原稿のフォルダへ移れます"
  : /Win/.test(navigator.platform) ? "「フォルダー」の欄に Ctrl+V で貼ると、この原稿のフォルダを指せます"
  : "場所の欄（Ctrl+L で出ます）に Ctrl+V で貼ると、この原稿のフォルダへ移れます";
const told = e => e.name === "AbortError" ? "フォルダを選ぶ画面を閉じました。もう一度選べます"
  : e.name === "NotFoundError" ? "フォルダが見つかりません。選び直してください（NotFoundError）"
  : String(e.message || e);

async function main() {
  const a = await stored("asks", ID), file = a && partsOf(a.url).pop();
  if (!a) { window.close(); return; }
  document.title = "page-edit：" + file;
  $("path").textContent = decodeURIComponent(new URL(a.url).pathname);
  $("head").textContent = file + " を編集するために、フォルダを許可してください";
  if (!window.showDirectoryPicker) {
    show("このブラウザは原稿への書き込みに対応していません。Chrome・Edge・Brave など Chromium 系のブラウザで開いてください");
    return;
  }
  const kept = (await keptDirs()).filter(x => a.kept.indexOf(x.id) >= 0);
  $("why").textContent = (a.dead && !kept.length
      ? "前に選んだフォルダ「" + a.dead + "」は、今の Chrome では使えなくなっています。もう一度選んでください。"
      : kept.length ? "" : "この原稿を含むフォルダ（原稿のフォルダかプロジェクトのフォルダ）を選びます。その下の原稿は、次から選ばずに開けます。")
    + "許可のあと、この窓は編集している間、最小化して残ります。「今回のみ許可」では、窓を閉じると許可が取り消されます（「毎回許可」を選んだときは閉じて構いません）。";

  const askFor = async function (d, no) {
    let ok;
    try { ok = await allowed(d) || await d.requestPermission(RW) === "granted"; }
    catch (e) { if (e.name === "NotFoundError") throw e; ok = false; }
    if (!ok) throw new Error(no);
  };
  const use = async function (d) {
    const f = await findIn(d, a.url, a.when);
    if (!f) throw new Error("フォルダ「" + d.name + "」の中に、開いている " + file + " がありません。この原稿を含むフォルダを選んでください");
    return f;
  };
  kept.forEach((x, i) => button("フォルダ「" + x.dir.name + "」の編集を許可する", !i, async function () {
    await askFor(x.dir, "フォルダ「" + x.dir.name + "」の編集が許可されませんでした");
    await finish(a, await use(x.dir));
  }));
  const take = async function (d) {   // a folder not kept yet; a wrong one is refused before Chrome asks anything
    const f = await use(d);
    await askFor(d, "フォルダ「" + d.name + "」の書き込みが許可されませんでした");
    await keepDir(d);
    await finish(a, f);
  };
  const choose = kept.length ? "別のフォルダを選ぶ" : "フォルダを選ぶ", path = folderPath(a.url), own = partsOf(a.url).slice(-2)[0];
  button(choose, !kept.length, async function () {
    // Chrome opens the picker at no path that is given to it, so the path is copied, to be pasted there
    await navigator.clipboard.writeText(path).catch(() => {});
    await take(await showDirectoryPicker({ id: "page-edit", mode: "readwrite" }));
  });
  $("hint").textContent = "「" + choose + "」を押すと、この原稿のフォルダのパスをコピーします。選ぶ画面で " + PASTE + "。";
  $("drop").textContent = (own === file ? "原稿を含むフォルダ" : "フォルダ「" + own + "」か、それを含むプロジェクトのフォルダ") + "を、ここへドラッグしても選べます";
  onDrop = async function (got) {
    const dirs = got.filter(x => x && x.kind === "directory");
    if (dirs.length !== 1) throw new Error(dirs.length ? "フォルダを一つだけ入れてください" : "ファイルではなく、原稿を含むフォルダを入れてください");
    await take(dirs[0]);
  };
  button("やめる", false, () => window.close());   // files.js tells the page
}

async function finish(a, f) {
  await keep("open", a.tab, { path: new URL(a.url).pathname, root: f.root, dirs: f.dirs, name: f.name });
  await drop("asks", ID);
  await chrome.tabs.sendMessage(a.tab, { ask: ID, done: true }).catch(() => {});
  chrome.windows.update(a.win, { focused: true }).catch(() => {});
  // stay as the one window that holds the permissions, or leave that to the one there is
  await navigator.locks.request("keeper", { ifAvailable: true }, async function (lock) {
    if (!lock) return;
    onDrop = null;
    $("buttons").replaceChildren();
    $("drop").textContent = $("hint").textContent = "";
    show("");
    $("head").textContent = "page-edit が原稿を編集しています";
    $("path").textContent = "";
    $("why").textContent = "この窓は、編集している原稿のタブが無くなると自分で閉じます。「今回のみ許可」では、閉じると許可が取り消され、次の保存のときに尋ね直します。";
    const w = await chrome.windows.getCurrent();
    await chrome.windows.update(w.id, { state: "minimized" }).catch(() => {});
    await unused();
  });
  window.close();
}
// Resolves when no tab shows a draft any more: asked twice, so that a page being loaded again is not missed.
async function unused() {
  for (let none = 0; none < 2;) {
    await new Promise(r => setTimeout(r, 10000));
    const tabs = await idb("open", "readonly", s => s.getAllKeys()).catch(() => null);
    if (!tabs) continue;
    let any = false;
    for (const t of tabs) {
      const at = await stored("open", t).catch(() => null);
      const path = await chrome.tabs.sendMessage(t, "alive", { frameId: 0 }).catch(() => "");
      if (at && path === at.path) any = true;
    }
    none = any ? 0 : none + 1;
  }
}
main().catch(e => show(told(e)));
