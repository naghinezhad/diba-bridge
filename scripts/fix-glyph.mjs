import fs from 'fs';
let c = fs.readFileSync('public/app.js', 'utf8');
// Replace esc(p?.glyph || "•") with p?.glyph || "•" in the template literal
c = c.replace(
  /\$\{esc\(p\?\.glyph \|\| "•"\)\}/g,
  '${p?.glyph || "•"}'
);
fs.writeFileSync('public/app.js', c);
console.log('Done');
