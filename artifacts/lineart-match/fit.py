"""One-off project-data fitting study. Does not change the editor's constraint solver."""
import json,copy,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).parent
old=json.loads((ROOT/'before.json').read_text()); p=copy.deepcopy(old)
views={v['id']:v for v in p['views']}; ls={l['name']:l for l in p['landmarks']}; ids={l['id']:l for l in p['landmarks']}
def unit(v): return v/np.linalg.norm(v)
def basis(v):
 f=unit(np.array(v['camera']['position'])-v['camera']['target']); r=unit(np.cross(v['camera']['up'],f)); return np.array([r,np.cross(f,r)])
def pixelworld(q,vid):
 r=views[vid]['reference']; a=math.radians(r['rotation']); R=np.array([[math.cos(a),-math.sin(a)],[math.sin(a),math.cos(a)]]); q=(np.array(q)-np.array([r['width'],r['height']])/2)*2.6*r['scale']/max(r['width'],r['height']); q=q@R.T;return np.array([q[0]+r['offset'][0],-q[1]+r['offset'][1]])
def worldpixel(q,vid):
 r=views[vid]['reference']; a=math.radians(r['rotation']); R=np.array([[math.cos(a),-math.sin(a)],[math.sin(a),math.cos(a)]]); q=np.array([q[0]-r['offset'][0],-q[1]+r['offset'][1]])@R;return q/(2.6*r['scale']/max(r['width'],r['height']))+np.array([r['width'],r['height']])/2
# Align only horizontal symmetry axis: 3.38px correction, used identically in before/after report.
views['front']['reference']['offset'][0]=-(297-287)*2.6*1.2/644
# Primary annotations are image-space semantic observations, not new geometry constraints.
front={
 '颅壳中轴·顶部最高点':[297,25], '面壳中轴·额部下端点':[297,236],
 '五官占位·鼻根定位点':[297,313],'五官占位·鼻尖定位点':[297,384], '五官占位·鼻底定位点':[297,394],
 '五官占位·上唇中点':[297,419],'五官占位·口裂中点':[297,432],'面壳中轴·下巴前端点':[297,504],
 '左五官占位·眉弓内端':[344,237],'左五官占位·眉弓外端':[438,245],
 '左五官占位·眼裂内端':[347,314],'左五官占位·眼裂外端':[443,321],
 '左五官占位·口裂外端':[335,427],
 '左耳部接口·耳根上端':[474,309],'左耳廓占位·上缘最高点':[496,296],
 '左耳廓占位·外缘转折点':[507,353],'左耳部接口·耳根下端':[445,410],
 '左面壳前边界·额颞转折点':[465,284],'左面壳前边界·颧颊转折点':[439,389],
 '左面壳前边界·下颊收束点':[414,442],
 '左面壳后边界·颞侧转折点':[486,280],'左面壳后边界·颧弓侧后点':[455,358],
 '左面壳后边界·下颌角定位点':[434,416],
}
# Side horizontal observations determine depth; vertical position follows the primary front drawing.
sideX={'颅壳中轴·顶部最高点':396,'面壳中轴·额部下端点':143,'五官占位·鼻根定位点':176,
 '五官占位·鼻尖定位点':144,'五官占位·鼻底定位点':155,'五官占位·上唇中点':172,'五官占位·口裂中点':193,'面壳中轴·下巴前端点':217,
 '左五官占位·眉弓内端':202,'左五官占位·眉弓外端':306,
 '左五官占位·眼裂内端':215,'左五官占位·眼裂外端':326,'左五官占位·口裂外端':219,
 '左耳部接口·耳根上端':434,'左耳廓占位·上缘最高点':500,'左耳廓占位·外缘转折点':541,'左耳部接口·耳根下端':435,
 '左面壳前边界·额颞转折点':403,'左面壳前边界·颧颊转折点':413,'左面壳前边界·下颊收束点':354,
 '左面壳后边界·颞侧转折点':515,'左面壳后边界·颧弓侧后点':463,'左面壳后边界·下颌角定位点':428}
# Front rail is in front of the visible temple/ear seam. These are inferred volume boundaries.
sideX.update({'左面壳前边界·额颞转折点':345,'左面壳前边界·颧颊转折点':320,'左面壳前边界·下颊收束点':292,
 '左面壳后边界·颞侧转折点':415,'左面壳后边界·颧弓侧后点':414,'左面壳后边界·下颌角定位点':390})
for name,q in front.items():
 l=ls[name]; xy=pixelworld(q,'front');z=-pixelworld([sideX[name],422],'side')[0];l['position']=[float(xy[0]) if l['type']!='CENTERLINE' else 0.,float(xy[1]),float(z)]
 if l.get('mirrorPartnerId'):ids[l['mirrorPartnerId']]['position']=[-l['position'][0],l['position'][1],l['position'][2]]
for name,q in {'颅壳中轴·后脑突出点':[655,282],'颅壳中轴·后颈连接点':[494,560],'颈部接口·前中点':[350,661]}.items():
 xy=pixelworld(q,'side');ls[name]['position']=[0,float(xy[1]),float(-xy[0])]
# Neck opening is below the jaw, without inventing an anatomical larynx.
for name in ['左颈部接口·侧向连接点','右颈部接口·侧向连接点']:
 l=ls[name]; l['position']=[.29 if name.startswith('左') else -.29,-1.29,-.36]
# Two-point image registration: crown/chin of the oblique drawing define only its display transform.
v=views['right30'];r=v['reference'];imageA=np.array([308,25]);imageB=np.array([238,509]);
wA=basis(v)@ls['颅壳中轴·顶部最高点']['position'];wB=basis(v)@ls['面壳中轴·下巴前端点']['position'];screenA=wA*[1,-1];screenB=wB*[1,-1];di=imageB-imageA;dw=screenB-screenA;angle=math.atan2(dw[1],dw[0])-math.atan2(di[1],di[0]);k=np.linalg.norm(dw)/np.linalg.norm(di);R=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]]);offset=screenA-((imageA-[r['width']/2,r['height']/2])*k)@R.T
r['rotation']=math.degrees(angle);r['scale']=k*max(r['width'],r['height'])/2.6;r['offset']=(offset*[1,-1]).tolist()
# Secondary oblique observations only adjust depth; primary front coordinates stay exact.
oblique={
 '左五官占位·眉弓内端':[[238,240],[151,254]],'左五官占位·眉弓外端':[[345,234],[100,269]],
 '左五官占位·眼裂内端':[[263,306],[171,339]],'左五官占位·眼裂外端':[[368,311],[116,333]],
 '左耳部接口·耳根上端':[[435,316]],'左耳廓占位·上缘最高点':[[473,285]],
 '左耳廓占位·外缘转折点':[[497,343]],'左耳部接口·耳根下端':[[425,405]]}
right=basis(views['right30'])[0]
for name,observations in oblique.items():
 l=ls[name];x,y,z=l['position'];zs=[]
 for i,q in enumerate(observations):
  u=pixelworld(q,'right30')[0];zs.append((u-right[0]*x*(1 if i==0 else -1)-right[1]*y)/right[2])
 # Side image is a weak prior for features; strong prior remains on skull profile.
 z=.9*float(np.mean(zs))+.1*z;l['position'][2]=z;ids[l['mirrorPartnerId']]['position'][2]=z
# Traces use visible front ink where present. Interior rails are explicitly marked as inferred.
traces={}
def tr(name,qs,vid='front',kind='ink'):traces[name]={'view':vid,'pixels':qs,'kind':kind}
tr('左五官占位·眉弓线',[[344,237],[361,228],[380,225],[402,228],[422,236],[438,245]])
tr('左五官占位·眼裂上缘',[[347,314],[353,301],[370,291],[388,289],[408,295],[429,307],[443,321]])
tr('左五官占位·眼裂下缘',[[347,314],[351,336],[364,353],[384,360],[407,358],[429,344],[443,321]])
tr('左五官占位·半侧口裂',[[335,427],[329,430],[315,432],[297,432]])
tr('左耳廓占位·耳根上端至最高点',[[474,309],[482,299],[490,296],[496,296]])
tr('左耳廓占位·上缘至外缘转折',[[496,296],[507,301],[513,316],[513,335],[507,353]])
tr('左耳廓占位·外缘至耳根下端',[[507,353],[497,374],[479,393],[460,406],[445,410]])
tr('左颅壳侧弧·颅顶至颞侧',[[297,25],[348,29],[399,46],[444,80],[475,132],[490,194],[492,230],[486,280]])
tr('左颅壳前侧弧·颅顶至额颞',[[465,284],[466,244],[460,202],[443,160],[418,123],[383,91],[338,60],[297,25]],kind='inferred')
tr('左面壳前边界·额颞至颧颊',[[465,284],[464,315],[454,350],[446,372],[439,389]],kind='inferred')
tr('左面壳前边界·颧颊至下颊',[[439,389],[435,409],[426,429],[414,442]])
tr('左面壳前边界·下颊至下巴',[[414,442],[392,460],[365,476],[332,491],[297,504]])
tr('左面壳后边界·颞侧至颧弓',[[486,280],[478,308],[466,334],[455,358]],kind='inferred')
tr('左面壳后边界·颧弓至下颌角',[[455,358],[448,382],[443,400],[434,416]],kind='inferred')
tr('左下颌底边·下颌角至下巴',[[434,416],[424,437],[407,455],[379,475],[341,493],[297,504]])
tr('颅壳中轴·颅顶至额部下端',[[396,21],[317,32],[244,68],[188,121],[153,186],[141,241],[143,265]],'side')
tr('颅壳中轴·颅顶至后脑',[[396,21],[473,28],[548,60],[604,114],[638,188],[655,250],[655,282]],'side')
tr('颅壳中轴·后脑至后颈',[[655,282],[646,349],[618,415],[575,466],[525,506],[500,534],[494,560]],'side')
tr('五官基准·额部至鼻根',[[143,265],[149,301],[164,348],[176,385]],'side')
tr('五官占位·鼻根至鼻尖',[[176,385],[177,407],[169,428],[144,446]],'side')
tr('颏下中轴·下巴至颈前',[[217,603],[245,601],[284,592],[322,582],[341,628],[350,661]],'side',kind='inferred')
# Cubic least-squares with iteratively updated closest parameters, fixed existing endpoint identities.
def fit2(q,A,B):
 q=np.asarray(q);ts=np.r_[0,np.cumsum(np.linalg.norm(np.diff(q,axis=0),axis=1))];ts/=ts[-1]
 for _ in range(12):
  t=ts[:,None];u=1-t;M=np.hstack([3*u*u*t,3*u*t*t]);rhs=q-u**3*A-t**3*B
  c=np.linalg.lstsq(M,rhs,rcond=None)[0];cp=np.array([A,c[0],c[1],B]);grid=np.linspace(0,1,501);v=bez(cp,grid);ts=np.argmin(np.sum((q[:,None]-v[None])**2,axis=2),axis=1)/500;ts[0]=0;ts[-1]=1
 return cp
def bez(cp,t):
 t=np.asarray(t)[:,None];u=1-t;return u**3*cp[0]+3*u*u*t*cp[1]+3*u*t*t*cp[2]+t**3*cp[3]
def setshape(c,cp,n):
 A,B=cp[0],cp[3];d=unit(B-A);L=np.linalg.norm(B-A);n=unit(n);b=unit(np.cross(n,d));s=cp[1]-A;e=cp[2]-B
 c['shape']={'planeNormal':n.tolist(),'startHandle':{'along':float(s@d/L),'offset':float(s@b/L)},'endHandle':{'along':float(-e@d/L),'offset':float(e@b/L)}}
for c in p['curves']:
 if c['role']!='canonical':continue
 A=np.array(ids[c['startLandmarkId']]['position']);B=np.array(ids[c['endLandmarkId']]['position']);d=unit(B-A)
 # Untraced ribs stay modest; shape is re-expressed in a valid plane of the new chord.
 n=np.array(c['shape']['planeNormal']);n=n-d*(n@d)
 if np.linalg.norm(n)<1e-6:n=np.cross(d,[0,0,1])
 if np.linalg.norm(n)<1e-6:n=np.cross(d,[1,0,0])
 n=unit(n);c['shape']['planeNormal']=n.tolist()
 for h in ['startHandle','endHandle']:
  c['shape'][h]['along']=min(.6,max(.12,c['shape'][h]['along']));c['shape'][h]['offset']=float(np.clip(c['shape'][h]['offset'],-.15,.15))
 if c['name']=='颏下中轴·下巴至颈前':
  c['shape']['startHandle']={'along':1/3,'offset':0};c['shape']['endHandle']={'along':1/3,'offset':0};continue
 if c['name'] not in traces:continue
 trc=traces[c['name']];vid=trc['view'];mat=basis(views[vid]);qs=np.array([pixelworld(q,vid) for q in trc['pixels']]);cp2=fit2(qs,mat@A,mat@B)
 if c['name']=='左颅壳前侧弧·颅顶至额颞':
  cp2=np.array([mat@A,pixelworld([468,135],'front'),pixelworld([397,25],'front'),mat@B])
 if vid=='side':
  cp3=np.c_[np.zeros(4),cp2[:,1],-cp2[:,0]];setshape(c,cp3,np.array([1,0,0]))
 else:
  # A stable front-readable plane: exact projected cubic, with endpoint depth carried along the chord.
  perp=np.array([-(B-A)[1],(B-A)[0],0]);perp=unit(perp);n=unit(np.cross(d,perp));matlift=np.array([[1,0,0],[0,1,0],n]);cp3=np.array([np.linalg.solve(matlift,[q[0],q[1],n@A]) for q in cp2]);setshape(c,cp3,n)
# Use short transitions at authored ink corners to avoid trimming away the selected contour landmarks.
for j in p['smoothJunctions']:j['extent']=.055 if '耳' in ids[j['landmarkId']]['name'] else .035
p['meta']['name']='二次元线稿匹配—正面主稿';
for v in p['views']:
 v['canvas']={'zoom':1,'pan':[0,0]}
 if v.get('reference'):v['reference']['opacity']=.65;v['reference']['locked']=True
(ROOT/'matched.json').write_text(json.dumps(p,ensure_ascii=False,indent=2))
(ROOT/'annotations.json').write_text(json.dumps({'primaryView':'front','frontLandmarks':front,'sideHorizontalDepthObservations':sideX,'traces':traces},ensure_ascii=False,indent=2))
print('Wrote',len(p['landmarks']),'landmarks',len(p['curves']),'curves',len(traces),'annotated traces')
