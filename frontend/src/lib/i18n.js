import zhCN from '../locales/zh-CN.json';

let _locale = 'zh-CN';
const dictionaries = {
  'zh-CN': zhCN,
};

export function t(key, vars) {
  const dict = dictionaries[_locale] || {};
  // allow keys to be used directly; fall back to key if no translation
  let str = dict[key] || key;
  if (vars && typeof vars === 'object') {
    Object.keys(vars).forEach(k => {
      const re = new RegExp(`\\{${k}\\}`, 'g');
      str = str.replace(re, String(vars[k]));
    });
  }
  return str;
}

export function setLocale(locale) {
  if (dictionaries[locale]) {
    _locale = locale;
  }
}

export function getLocale() {
  return _locale;
}

export default { t, setLocale, getLocale };
