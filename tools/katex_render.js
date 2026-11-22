// Render the slides' math once at build time (called by build_html.py).
// stdin: JSON array of TeX strings; stdout: JSON array of KaTeX HTML strings.
const katex = require('katex');

let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  const out = JSON.parse(buf).map((tex) => katex.renderToString(tex, { throwOnError: true, output: 'html' }));
  process.stdout.write(JSON.stringify(out));
});
