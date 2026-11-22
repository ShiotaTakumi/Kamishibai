/* Layout probe for the HTML slides: for every slide (all .reveal steps shown), the text of
   each rendered line of each text block, plus boxes that overflow the 1280x720 canvas.
   Run in the page after fonts are ready; returns a JSON string. Used by check_layout.mjs. */
window.__layout = (async function () {
  /* fonts load lazily (KaTeX's only when a slide using them is shown), so load all first */
  await Promise.all(Array.from(document.fonts).map(f => f.load().catch(() => null)));
  await document.fonts.ready;
  const BLOCKS = "h1,h2,p,li,.bt,.cap,td";
  const slides = [].slice.call(document.querySelectorAll(".slide"));
  document.querySelectorAll(".reveal").forEach(e => e.classList.add("on"));
  const stage = document.getElementById("stage");
  stage.style.transform = "none";
  /* timers, not rAF: headless Chrome with a virtual-time budget does not run rAF */
  const frame = () => new Promise(res => setTimeout(res, 50));
  function measure() {
  const out = [];
  slides.forEach(function (sl, si) {
    slides.forEach((s, i) => s.classList.toggle("on", i === si));
    const base = stage.getBoundingClientRect();
    const blocks = [], over = [];
    sl.querySelectorAll(BLOCKS).forEach(function (el) {
      if (el.querySelector(BLOCKS)) return;
      /* character tops -> lines (KaTeX is measured as one unit) */
      const lines = []; let top = null, cur = "";
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement.closest(".katex-html[aria-hidden]")) continue;
        const kx = n.parentElement.closest(".katex");
        for (let i = 0; i < n.data.length; i++) {
          const ch = n.data[i];
          if (/\s/.test(ch) && !kx) { cur += " "; continue; }
          r.setStart(n, i); r.setEnd(n, i + 1);
          const b = kx ? kx.getBoundingClientRect()   // WebKit: a wrapped line's first character may also get an empty rect on the line before
            : [].filter.call(r.getClientRects(), x => x.width > 0).pop() || r.getBoundingClientRect();
          if (!b.width && !b.height) continue;
          if (top !== null && b.top > top + b.height * 0.5) { lines.push(cur.trim()); cur = ""; }
          if (top === null || b.top > top + b.height * 0.5) top = b.top;
          cur += ch;
        }
      }
      if (cur.trim()) lines.push(cur.trim());
      if (lines.length) blocks.push({ w: +el.getBoundingClientRect().width.toFixed(2), lines: lines.map(s => s.replace(/ +/g, " ")) });
    });
    /* boxes that leave the canvas (figures, blocks, text; not the parts inside KaTeX) */
    sl.querySelectorAll(BLOCKS + ",img,.fig,.side,.blk,table,.flip,ul,ol,div").forEach(function (el) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || el.closest(".ctrl")) return;
      const name = el.tagName.toLowerCase() + (el.className ? "." + el.className : "");
      if (b.right - base.left > 1280.5 || b.bottom - base.top > 720.5 || b.left < base.left - 0.5 || b.top < base.top - 0.5)
        over.push(name + " at " + Math.round(b.left - base.left) + "," + Math.round(b.top - base.top) +
                  "-" + Math.round(b.right - base.left) + "," + Math.round(b.bottom - base.top));
    });
    out.push({ slide: si + 1, blocks: blocks, overflow: over });
  });
  return JSON.stringify(out);
  }
  /* a font that has just loaded may not be applied to layout yet: repeat until two passes agree */
  let prev = null, json = null;
  for (let k = 0; k < 10; k++) {
    await frame(); await frame();
    json = measure();
    if (json === prev) break;
    prev = json;
  }
  const pre = document.createElement("pre"); pre.id = "__layout";
  pre.textContent = json; document.body.appendChild(pre);
})();
