# 俯仰 keys for the 转头模型 (bowen 1793026490: pitch in the viewer). From bowen's files at yaw 0, read only:
# pitch 0 = the 0° file as copied before any pitch edit (备份 …-before-耳点线上-181018), +45 仰 = 12 第3版, −45 俯 = 13 第3版.
# Writes 转头模型/sources/pitch-keys.json (outline + ear points and handles, the eye sphere fit, the reference placement)
# and copies dot's two pictures beside the model as ref-pitch±45.png.
import json, os, shutil
H = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = H + '../转头模型/'
FILES = {0: '../备份/12-仰45-yaw0-pitch45.近2远3.耳朵骨线-before-耳点线上-181018.json',
         45: '手调记录/12-仰45-yaw0-pitch45.第3版-耳尖.json', -45: '手调记录/13-俯45-yaw0-pitch-45.第3版-耳尖.json'}
PT = {'crown': 'cmv3m1am1-6/pmv3m1am1-4', 'chin': 'cmv3m1am1-6/pmv3m1am1-2', 'nearRoot': 'cmv3m1am1-6/pmv3m1am1-1', 'zyg': 'pmv3m1am1-1',
      'temple': 'pm03-skf', 'earUp': 'pear-R-up', 'earTip': 'pear-R-tip', 'earLow': 'pear-R-low'}
LN = {'farJaw': 'lmv3m1am1-3', 'farCheek': 'lm03-chf', 'farSkull': 'lm03-skf', 'nearJaw': 'cmv3m1am1-6/lmv3m1am1-3', 'nearSkull': 'lm03-skb',
      'earUpper': 'lear-R-1', 'earLower': 'lear-R-2'}
r = lambda v: [round(v['x'], 4), round(v['y'], 4)]
keys = []
for p, f in sorted(FILES.items()):
    d = json.load(open(H + f)); net = d['document']['network']; v = next(l for l in net['shapes']['layers'] if l['key'] == 'view:0,0')
    keys.append({'pitch': p, 'file': os.path.basename(f), 'pts': {k: r(v['points'][i]) for k, i in PT.items()},
                 'handles': {k: {'ha': r(v['lines'][i]['ha']), 'hb': r(v['lines'][i]['hb'])} for k, i in LN.items()}})
    if p:
        im = next(i for i in d['document']['reference']['images'] if i['visible']); a = next(x for x in d['document']['reference']['library'] if x['id'] == im['asset'])
        name = 'ref-pitch%+d.png' % p
        shutil.copy(H + 'pics/' + im['asset'].replace('ref-', '') + '.png', OUT + name)
        keys[-1]['ref'] = {'file': name, 'x': round(im['x'], 4), 'y': round(im['y'], 4), 'w': round(im['width'] * im['scale'], 4), 'h': round(im['height'] * im['scale'], 4)}
S = json.load(open(H + 'sphere-fit.json'))['sharedEyes']
eyes = {'anchorY': S['Ay'], 'r': S['r'], 'keys': [{'pitch': -45, 'bend': S['down']['pitch'], 's': S['down']['s'], 'oy': S['down']['oy']},
        {'pitch': 0, 'bend': 0, 's': 1, 'oy': 0}, {'pitch': 45, 'bend': S['up']['pitch'], 's': S['up']['s'], 'oy': S['up']['oy']}],
        'source': 'sphere-fit.mjs: one sphere for both eyes and both directions, fitted to bowen\'s ±45 eye bones (mean 1.7 / 1.1, max 3.0 / 2.2)'}
json.dump({'note': 'bowen\'s pitch keys at yaw 0 (pitch +45 = 仰 = looking up). From bench-tasks/俯仰-2026-10-25/export-pitch-keys.py', 'keys': keys, 'eyes': eyes},
          open(OUT + 'sources/pitch-keys.json', 'w'), ensure_ascii=False, indent=1)
print('ok', [k['pitch'] for k in keys])
