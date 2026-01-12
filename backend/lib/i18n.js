const fs = require('fs');
const path = require('path');

const DEFAULT_LOCALE = 'zh-CN';
let locales = {};

function loadLocale(locale) {
  try {
    const p = path.join(__dirname, '..', 'locales', `${locale}.json`);
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function getLocaleFromReq(req) {
  try {
    const al = req.headers['accept-language'] || '';
    if (/zh/i.test(al)) return 'zh-CN';
  } catch (e) {}
  return DEFAULT_LOCALE;
}

function t(locale, key, vars) {
  if (!locales[locale]) locales[locale] = loadLocale(locale);
  const map = locales[locale] || {};
  let str = map[key] || key;
  if (vars && typeof vars === 'object') {
    Object.keys(vars).forEach(k => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
    });
  }
  return str;
}

function translateForReq(req, key, defaultMsg, vars) {
  const locale = getLocaleFromReq(req);
  const translated = t(locale, key, vars);
  if (!translated || translated === key) return defaultMsg;
  return translated;
}

module.exports = {
  translateForReq,
  getLocaleFromReq,
};
