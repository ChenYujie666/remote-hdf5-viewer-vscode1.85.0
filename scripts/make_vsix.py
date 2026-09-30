import json
import os
import shutil
import zipfile
root = os.path.dirname(os.path.dirname(__file__))
with open(os.path.join(root, 'package.json'), encoding='utf-8') as f:
    version = json.load(f)['version']
stage = os.path.join(root, 'work', 'vsixstage')
shutil.rmtree(stage, ignore_errors=True)
os.makedirs(os.path.join(stage, 'extension'))
for name in ('package.json', 'extension.js', 'README.md'):
    shutil.copy2(os.path.join(root, name), os.path.join(stage, 'extension', name))
shutil.copy2(os.path.join(root, 'extension', 'LICENSE.txt'), os.path.join(stage, 'extension', 'LICENSE.txt'))
for name in ('[Content_Types].xml', 'extension.vsixmanifest'):
    shutil.copy2(os.path.join(root, name), os.path.join(stage, name))
out = os.path.join(root, 'outputs', f'remote-hdf5-viewer-{version}.vsix')
os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, _, files in os.walk(stage):
        for f in files:
            full = os.path.join(dp, f)
            z.write(full, os.path.relpath(full, stage))
print(out, os.path.getsize(out))
