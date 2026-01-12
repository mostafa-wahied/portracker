import os
import re
import json

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'frontend', 'src')
LOCAL = os.path.join(SRC, 'locales', 'zh-CN.json')

key_re = re.compile(r"t\(['\"]([^'\"]+)['\"]\)")

keys = set()
for dirpath, dirs, files in os.walk(SRC):
    for fname in files:
        if fname.endswith(('.js', '.jsx', '.ts', '.tsx')):
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, 'r', encoding='utf8') as f:
                    content = f.read()
            except Exception:
                continue
            for m in key_re.finditer(content):
                keys.add(m.group(1))

with open(LOCAL, 'r', encoding='utf8') as f:
    locales = json.load(f)

missing = sorted(k for k in keys if k not in locales)
unused = sorted(k for k in locales.keys() if k not in keys)

print(f'Found {len(keys)} unique t(...) keys in frontend source.')
print(f'Missing in zh-CN.json: {len(missing)}')
if missing:
    print('\n'.join(missing))
print('\nUnused keys in zh-CN.json:', len(unused))
if unused:
    print('\n'.join(unused))
