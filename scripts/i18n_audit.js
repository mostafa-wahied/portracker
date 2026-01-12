const fs = require('fs');
const path = require('path');

function walk(dir, ext, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, ext, fileList);
    else if (ext.some(e => full.endsWith(e))) fileList.push(full);
  }
  return fileList;
}

const srcFiles = walk(path.join(__dirname, '..', 'frontend', 'src'), ['.js', '.jsx', '.ts', '.tsx']);
const keyRe = /t\(['\"]([^'\"]+)['\"]\)/g;
const keys = new Set();
for (const f of srcFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = keyRe.exec(content)) !== null) keys.add(m[1]);
}

const localesPath = path.join(__dirname, '..', 'frontend', 'src', 'locales', 'zh-CN.json');
const locales = JSON.parse(fs.readFileSync(localesPath, 'utf8'));

const missing = [];
for (const k of [...keys].sort()) {
  if (!(k in locales)) missing.push(k);
}

console.log('Found', keys.size, 'unique t(...) keys in frontend source.');
console.log('Missing in zh-CN.json:', missing.length);
if (missing.length) console.log(missing.join('\n'));

// Also check keys present in locales but not used
const unused = [];
for (const k of Object.keys(locales).sort()) {
  if (!keys.has(k)) unused.push(k);
}
console.log('\nUnused keys in zh-CN.json:', unused.length);
if (unused.length) console.log(unused.join('\n'));
