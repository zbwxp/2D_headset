# the 90° keyframe from the moved-ear copy (bowen 1792669128) with the new references
import json, subprocess
TC='/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'
all_=json.load(open(TC)); V1='近2远3 · 新参考（0°-09 / 45°-11 鼓腮版 / 90°-11）'
c=json.loads(subprocess.run(['cat','k90.json'],capture_output=True,text=True).stdout)
keys=[dict(k) for k in all_['variants'][V1]]
for k in keys:
    if k['yaw']==90: k['pts']=c['pts']; k['lines']=c['lines']
V='近2远3 · 新参考 + 90° 耳点后移到 14.5（handle 跟随）'
all_['variants']={V:keys,**{k:v for k,v in all_['variants'].items() if k!=V}}; all_['mirror'][V]=True
json.dump(all_,open(TC,'w')); print('ok')
