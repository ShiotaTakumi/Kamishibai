// Split Japanese text into phrases with BudouX (the model behind Chrome's word-break:auto-phrase).
// stdin: JSON array of strings; stdout: JSON array of arrays of phrases. Used by build_html.py,
// which inserts <wbr> between the phrases so that every browser breaks lines at the same places.
const { loadDefaultJapaneseParser } = require("budoux");
const parser = loadDefaultJapaneseParser();
let buf = "";
process.stdin.on("data", d => (buf += d));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify(JSON.parse(buf).map(s => parser.parse(s))));
});
