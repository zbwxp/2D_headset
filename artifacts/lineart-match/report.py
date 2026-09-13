import json,math,io,base64
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).parent
p=json.loads((ROOT/'matched.json').read_text());E=json.loads((ROOT/'evaluation.json').read_text());ann=json.loads((ROOT/'annotations.json').read_text());views={v['id']:v for v in p['views']}
def unit(v):return v/np.linalg.norm(v)
def basis(v):
 f=unit(np.array(v['camera']['position'])-v['camera']['target']);r=unit(np.cross(v['camera']['up'],f));return np.array([r,np.cross(f,r)])
def pixels(cp,vid):
 v=views[vid];r=v['reference'];q=np.array(cp)@basis(v).T-np.array(v['camera']['target'])@basis(v).T;a=math.radians(r['rotation']);R=np.array([[math.cos(a),-math.sin(a)],[math.sin(a),math.cos(a)]]);q=(q-r['offset'])*[1,-1];return (q@R)/(2.6*r['scale']/max(r['width'],r['height']))+[r['width']/2,r['height']/2]
def samples(cp,n=180):
 cp=np.array(cp);d=len(cp)-1;t=np.linspace(0,1,n)[:,None];return sum(math.comb(d,i)*t**i*(1-t)**(d-i)*c for i,c in enumerate(cp))
colors={'feature':'#159ec2','shell':'#c14785','ear':'#008f78','inferred':'#bc933a'}
def category(name):return 'feature' if '五官' in name else 'ear' if '耳' in name else 'inferred' if any(x in name for x in ['横向','前侧弧','接口','颈','颞侧至颧','颧弓至下','额颞至颧']) else 'shell'
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',22)
# Technical reprojection charts; reference raster is unmodified.
for vid in ['front','right30','side']:
 r=views[vid]['reference'];im=Image.open(io.BytesIO(base64.b64decode(r['dataUrl'].split(',')[1]))).convert('RGB');w,h=im.size
 panel=Image.new('RGB',(w*2,h+55),'#eef1f3');dr=ImageDraw.Draw(panel)
 for col,key in enumerate(['before','matched']):
  panel.paste(im,(col*w,55));dr.text((col*w+18,15),key.upper()+' / '+vid,fill='#243442',font=font)
  names={c['id']:c['name'] for c in E[key]['curves']}
  for span in E[key]['network']['spans']:
   q=pixels(samples(span['controls']),vid);xy=[(float(x+col*w),float(y+55)) for x,y in q];dr.line(xy,fill=colors[category(names[span['curveId']])],width=2)
 panel.save(ROOT/(vid+'-comparison.png'))
# Metrics: annotations to actually resolved curves, in ORIGINAL reference pixels.
metrics=[]
for name,tr in ann['traces'].items():
 if tr['kind']!='ink':continue
 rec={'name':name,'view':tr['view']}
 for key in ['before','matched']:
  cid=next(c['id'] for c in E[key]['curves'] if c['name']==name);spans=[s for s in E[key]['network']['spans'] if s['curveId']==cid]
  q=np.concatenate([pixels(samples(s['controls'],500),tr['view']) for s in spans]);t=np.array(tr['pixels']);dist=np.linalg.norm(t[:,None]-q[None],axis=2).min(axis=1)
  rec[key]={'meanPx':float(np.mean(dist)),'maxPx':float(np.max(dist))}
 metrics.append(rec)
(ROOT/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
for vid in ['front','side']:
 m=[x for x in metrics if x['view']==vid];print(vid,'mean annotation distance',*[round(np.mean([x[k]['meanPx'] for x in m]),2) for k in ['before','matched']])
