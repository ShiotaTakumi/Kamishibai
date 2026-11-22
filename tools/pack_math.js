// Render the math of an engine draft once at build time (called by pack_engine.py).
// stdin: JSON array of [TeX, display]; stdout: JSON {version, html: [KaTeX HTML, ...]}.
// The options are those the engine passes to KaTeX's auto-render (engine/kamishibai.js): errors
// become red .katex-error spans instead of exceptions, HTML output only, and one macros object
// shared by all formulas in document order (so \gdef carries over as in the page).
const katex = require('katex');

let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  const macros = {};
  const html = JSON.parse(buf).map(([tex, display]) =>
    katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', macros }));
  process.stdout.write(JSON.stringify({ version: katex.version, html }));
});
