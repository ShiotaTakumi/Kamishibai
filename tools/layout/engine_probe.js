/* Layout probe for a page of the Kamishibai engine (engine/kamishibai.js, as a draft or packed by
   make pack). Used by check_layout.mjs; writes its result as JSON into <pre id="__layout">.

   Screen media: for every page, with all steps shown, and once more for every further card of each
   flip figure (its caption may change), the text of each rendered line of each text block and the
   overflow problems:
     - text or a box outside the content area: the box the page's tag (slide, cover, divider) lays its
       content out in, i.e. that tag's content box when it is absolutely placed (Madrid), else the
       content box of the page (Boadilla). Absolutely placed parts are placed on purpose and are only
       held to the canvas;
     - text wider than its own block (an unbreakable word or formula);
     - anything outside the canvas (W x H of the theme);
     - clipped content (an element with overflow other than visible whose content is larger).
   Print media: the printed sheets (.print > .ppage, shown all as for the PDF button): their size,
   that a page with n step groups has n + 1 sheets showing 0, 1, ..., n groups, and for the sheet
   with all steps the same lines and overflow problems as on screen. */
window.__layout = (async function () {
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  for (let i = 0; i < 1200 && !document.querySelector(".stage > .page"); i++) await sleep(50);
  /* fonts load lazily, so load all first */
  await Promise.all(Array.from(document.fonts).map(f => f.load().catch(() => null)));
  await document.fonts.ready;
  const K = window.Kamishibai, [W, H] = K.size;
  const STEP = "[step]:not(input)";
  const PRINT = matchMedia("print").matches;
  const stage = document.querySelector(".stage");
  stage.style.transform = "none";
  stage.style.visibility = "";

  const name = el => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim()
    ? "." + el.className.trim().split(/\s+/).join(".") : "");
  const snip = s => { s = s.replace(/\s+/g, " ").trim(); return s.length > 24 ? s.slice(0, 24) + "…" : s; };
  const xy = (b, o) => Math.round(b.left - o.left) + "," + Math.round(b.top - o.top) + "-" +
                       Math.round(b.right - o.left) + "," + Math.round(b.bottom - o.top);
  const inner = function (el) {   // content box (inside border and padding) in client coordinates
    const b = el.getBoundingClientRect(), s = getComputedStyle(el), f = p => parseFloat(s[p]) || 0;
    return { left: b.left + f("borderLeftWidth") + f("paddingLeft"), top: b.top + f("borderTopWidth") + f("paddingTop"),
             right: b.right - f("borderRightWidth") - f("paddingRight"), bottom: b.bottom - f("borderBottomWidth") - f("paddingBottom") };
  };
  const padded = function (el) {   // padding box: text may run into the padding, not past it
    const b = el.getBoundingClientRect(), s = getComputedStyle(el), f = p => parseFloat(s[p]) || 0;
    return { left: b.left + f("borderLeftWidth"), right: b.right - f("borderRightWidth") };
  };
  /* a box with a negative margin (a block reaching 4pt past the text, as in Beamer) is meant to
     stick out by that much, and so are its contents */
  const bleed = function (el, a, stop) {
    const r = Object.assign({}, a);
    for (let e = el; e && e !== stop; e = e.parentElement) {
      const s = getComputedStyle(e), f = p => Math.min(0, parseFloat(s[p]) || 0);
      r.left += f("marginLeft"); r.right -= f("marginRight"); r.top += f("marginTop"); r.bottom -= f("marginBottom");
    }
    return r;
  };
  const out = (b, a, t) => b.left < a.left - t || b.top < a.top - t || b.right > a.right + t || b.bottom > a.bottom + t;
  const isBlock = el => !/^inline/.test(getComputedStyle(el).display) || el.classList.contains("katex-display");
  const placed = el => /^(absolute|fixed)$/.test(getComputedStyle(el).position);

  function measure(pg) {
    const o = pg.getBoundingClientRect();
    const canvas = { left: o.left, top: o.top, right: o.left + W, bottom: o.top + H };
    const ce = pg.querySelector(":scope > slide, :scope > cover, :scope > divider");
    const area = ce && placed(ce) ? inner(ce) : inner(pg);
    const problems = [];
    /* text blocks: characters grouped by their nearest block ancestor; math (.katex) is one unit */
    const owners = new Map();
    const tw = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const p = n.parentElement;
      if (!n.data.trim() && !owners.size) continue;
      if (p.closest("svg, .katex-mathml, .ctrl")) continue;
      const kx = p.closest(".katex");
      let ow = kx ? kx.parentElement : p; while (ow !== pg && !isBlock(ow)) ow = ow.parentElement;
      if (!owners.has(ow)) owners.set(ow, []);
      const list = owners.get(ow);
      if (kx) { if (list[list.length - 1] !== kx) list.push(kx); continue; }
      for (let i = 0; i < n.data.length; i++) list.push([n, i]);
    }
    const blocks = [];
    owners.forEach(function (items, ow) {
      const lines = []; let top = null, cur = "";
      let ext = null;
      for (const it of items) {
        let b, ch;
        if (Array.isArray(it)) {
          ch = it[0].data[it[1]];
          if (/\s/.test(ch)) { cur += " "; continue; }
          r.setStart(it[0], it[1]); r.setEnd(it[0], it[1] + 1);
          /* WebKit may give the first character of a wrapped line an empty rect at the end of the
             line before as well: take the last rect with a width */
          b = [].filter.call(r.getClientRects(), x => x.width > 0).pop() || r.getBoundingClientRect();
        } else { b = mathBox(it); ch = (it.querySelector(".katex-html") || it).textContent.replace(/\s+/g, ""); }
        if (!b.width && !b.height) continue;
        if (top !== null && b.top > top + b.height * 0.5) { lines.push(cur.trim()); cur = ""; }
        if (top === null || b.top > top + b.height * 0.5) top = b.top;
        cur += ch;
        ext = ext ? { left: Math.min(ext.left, b.left), top: Math.min(ext.top, b.top),
                      right: Math.max(ext.right, b.right), bottom: Math.max(ext.bottom, b.bottom) } : b;
      }
      if (cur.trim()) lines.push(cur.trim());
      if (!lines.length) return;
      const text = lines.join(" ");
      blocks.push({ w: +ow.getBoundingClientRect().width.toFixed(2), lines: lines.map(s => s.replace(/ +/g, " ")) });
      const free = ow.closest(".ttl, .hl, .pn, .foot") || [].some.call([ow].concat(ancestors(ow, pg)), placed);
      if (out(ext, canvas, 0.5)) problems.push("text outside the canvas: " + name(ow) + " \"" + snip(text) + "\" at " + xy(ext, o));
      else if (!free && ce && ce.contains(ow) && out(ext, bleed(ow, area, ce), 0.5))
        problems.push("text outside the content area: " + name(ow) + " \"" + snip(text) + "\" at " + xy(ext, o) + " (area " + xy(area, o) + ")");
      else if (ext.right > padded(ow).right + 1 && getComputedStyle(ow).overflowX === "visible")
        problems.push("text wider than its block: " + name(ow) + " \"" + snip(text) + "\" by " + Math.round(ext.right - padded(ow).right) + " px");
    });
    /* boxes: the outermost one that leaves the content area (in-flow parts) or the canvas (all parts) */
    const seen = [];
    pg.querySelectorAll("*").forEach(function (el) {
      if (el.closest(".katex") && !el.matches(".katex") || el.closest("svg") && el.tagName.toLowerCase() !== "svg" ||
          el.closest(".ctrl") || seen.some(s => s.contains(el))) return;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const free = el.closest(".ttl, .hl, .pn, .foot") || [el].concat(ancestors(el, pg)).some(placed);
      if (out(b, canvas, 0.5)) { problems.push("box outside the canvas: " + name(el) + " at " + xy(b, o)); seen.push(el); }
      else if (!free && ce && ce.contains(el) && el !== ce && out(b, bleed(el, area, ce), 0.5)) {
        problems.push("box outside the content area: " + name(el) + " at " + xy(b, o) + " (area " + xy(area, o) + ")"); seen.push(el);
      }
      const s = getComputedStyle(el);
      if ((s.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) || (s.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 1))
        problems.push("clipped content: " + name(el) + " \"" + snip(el.textContent) + "\" (" + el.scrollWidth + "x" + el.scrollHeight +
                      " in " + el.clientWidth + "x" + el.clientHeight + ")");
    });
    return { blocks: blocks, overflow: problems };
  }
  /* a formula wider than its line overflows its .katex box: measure what KaTeX laid out */
  function mathBox(kx) {
    let u = null;
    kx.querySelectorAll(".katex-html > *").forEach(function (e) {
      const b = e.getBoundingClientRect(); if (!b.width) return;
      u = u ? { left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right),
                bottom: Math.max(u.bottom, b.bottom), width: 1, height: 1 } : b;
    });
    return u || kx.getBoundingClientRect();
  }
  function ancestors(el, stop) { const a = []; for (let p = el.parentElement; p && p !== stop; p = p.parentElement) a.push(p); return a; }

  /* a font that has just loaded may not be applied to layout yet: repeat until two passes agree */
  async function settle(f) {
    let prev = null, json = null;
    for (let k = 0; k < 10; k++) {
      await sleep(60);
      json = JSON.stringify(f());
      if (json === prev) break;
      prev = json;
    }
    return JSON.parse(json);
  }

  const res = { size: [W, H], print: PRINT, pages: [], sheets: [], problems: [] };
  if (!PRINT) {
    const secs = [].slice.call(stage.children);
    for (let i = 0; i < secs.length; i++) {
      K.go(i, true);
      res.pages.push(Object.assign({ slide: i + 1, state: "" }, await settle(() => measure(secs[i]))));
      /* every further card of each flip figure with buttons (one figure at a time, the others on card 1) */
      const ctrls = [].slice.call(secs[i].querySelectorAll("[data-flip]"));
      for (const ct of ctrls) {
        const btns = [].slice.call(ct.querySelectorAll("button"));
        for (let k = 1; k < btns.length; k++) {
          btns[k].click();
          res.pages.push(Object.assign({ slide: i + 1, state: ct.dataset.flip + "=" + (k + 1) }, await settle(() => measure(secs[i]))));
        }
        K.go(i, true);
      }
    }
    K.go(0);
  } else {
    document.body.classList.add("print-steps");
    const sheets = [].slice.call(document.querySelectorAll(".print > .ppage"));
    let page = 1, k = 0;
    for (const sh of sheets) {
      const pg = sh.querySelector(":scope > .page"), b = sh.getBoundingClientRect();
      const g = [];   // step groups of the copy, as the engine forms them
      pg.querySelectorAll(STEP).forEach(e => { if (g.length && e.dataset.with === "prev") g[g.length - 1].push(e); else g.push([e]); });
      const on = pg.querySelectorAll(STEP + ".on").length, want = g.slice(0, k).reduce((s, x) => s + x.length, 0);
      const all = sh.classList.contains("all");
      if (Math.abs(b.width - W) > 0.5 || Math.abs(b.height - H) > 0.5)
        res.problems.push("#" + page + ": sheet " + (k + 1) + " is " + b.width + "x" + b.height + ", not " + W + "x" + H);
      if (on !== want) res.problems.push("#" + page + ": sheet " + (k + 1) + " shows " + on + " steps, not " + want);
      if (all !== (k === g.length)) res.problems.push("#" + page + ": " + (k + 1) + " sheets, but " + (g.length + 1) + " expected (" + g.length + " step groups)");
      if (all) res.sheets.push(Object.assign({ slide: page, state: "" }, await settle(() => measure(pg))));
      if (all) { page++; k = 0; } else k++;
    }
    res.count = { pages: page - 1, sheets: sheets.length };
    document.body.classList.remove("print-steps");
  }
  const pre = document.createElement("pre"); pre.id = "__layout"; pre.style.display = "none";
  pre.textContent = JSON.stringify(res); document.body.appendChild(pre);
})();
