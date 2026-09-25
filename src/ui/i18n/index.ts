import {create} from 'zustand';
import catalog from './messages.tsv?raw';
export type Language='zh'|'en';
const storageKey='contour.ui-language';
function initialLanguage():Language{try{return localStorage.getItem(storageKey)==='en'?'en':'zh';}catch{return 'zh';}}
export const useLanguage=create<{language:Language;setLanguage:(language:Language)=>void}>(()=>({language:initialLanguage(),setLanguage(language){useLanguage.setState({language});try{localStorage.setItem(storageKey,language);}catch{}if(typeof document!=='undefined')document.documentElement.lang=language==='zh'?'zh-CN':'en';}}));
const messages=new Map<string,{zh:string;en:string}>();
for(const line of catalog.split('\n')){const [zh,en,...aliases]=line.split('\t');if(!zh||!en)continue;const pair={zh,en};for(const key of [zh,en,...aliases])messages.set(key.trim().replace(/\s+/g,' '),pair);}
const patterns:[RegExp,string,string][]=[
 [/^tri Surface (\d+)$/,'三边面 {0}','Tri Surface {0}'],
 [/^quad Surface (\d+)$/,'四边面 {0}','Quad Surface {0}'],
 [/^lens Surface (\d+)$/,'两边面 {0}','Lens Surface {0}'],
 [/^loop Surface (\d+)$/,'环形面 {0}','Loop Surface {0}'],
 [/^Offset ([XYZ])$/,'{0} 偏移','Offset {0}'],
 [/^(\d+) DOF$/,'{0} 自由度','{0} DOF'],
 [/^显示 (.*) 窗口$/,'显示 {0} 窗口','Show {0} panel'],
 [/^隐藏 (.*) 窗口$/,'隐藏 {0} 窗口','Hide {0} panel'],
 [/^(.*) 窗口比例$/,'{0} 窗口比例','{0} panel proportions'],
 [/^(.*) 窗口$/,'{0} 窗口','{0} panel'],
 [/^(.*) 数值$/,'{0} 数值','{0} value'],
 [/^源点：(.*)$/,'源点：{0}','Source point: {0}'],
 [/^ 将同时删除 (\d+) 条相连结构线（含镜像侧）及其下游依赖。$/,' 将同时删除 {0} 条相连结构线（含镜像侧）及其下游依赖。',' Also deletes {0} connected curves (including mirrors) and their dependents.'],
 [/^Host: (.*) · (.*)$/,'宿主：{0} · {1}','Host: {0} · {1}'],
 [/^控制柄 (.*)$/,'控制柄 {0}','Handle {0}'],
 [/^起点：(.*)；请选择终点 B$/,'起点：{0}；请选择终点 B','Start: {0}; select end B'],
 [/^＋背景 (\d+)\/6$/,'＋背景 {0}/6','+ Background {0}/6'],
 [/^区间定位点 (.*)$/,'区间定位点 {0}','Span anchor {0}'],
 [/^删除 Patch (.*)$/,'删除曲面 {0}','Delete patch {0}'],
 [/^关闭(.*)$/,'关闭{0}','Close {0}'],
 [/^解锁(.*)全部点$/,'解锁{0}全部点','Unlock all points in {0}'],
 [/^移动基准：(.*)锁约束$/,'移动基准：{0}锁约束','Move basis: {0} view lock'],
 [/^移动基准：(.*)相机平面（深度不变）$/,'移动基准：{0}相机平面（深度不变）','Move basis: {0} camera plane (fixed depth)'],
 [/^ · (\d+) 球面区域$/,' · {0} 球面区域',' · {0} surface regions'],
 [/^(.*) · 边界派生$/,'{0} · 边界派生','{0} · Boundary-derived'],
 [/^([左右]) (\d+)°$/,'{0} {1}°','{0} {1}°'],
 [/^([左右])\s*(\d+(?:\.\d+)?)°$/,'{0} {1}°','{0} {1}°'],
 [/^俯\s*(\d+(?:\.\d+)?)°$/,'俯 {0}°','Down {0}°'],
 [/^仰\s*(\d+(?:\.\d+)?)°$/,'仰 {0}°','Up {0}°'],
];
/** Display boundary only: never translate source IDs, stored names or command arguments. */
export function uiText<T>(value:T):T{
 if(typeof value!=='string')return value;
 const language=useLanguage.getState().language,normalized=value.trim().replace(/\s+/g,' '),found=messages.get(normalized);
 if(found)return found[language] as T;
 for(const [pattern,zh,en] of patterns){const match=value.match(pattern);if(match)return (language==='zh'?zh:en).replace(/\{(\d+)\}/g,(_,i)=>(/源点|Host:|起点：|区间定位点|Driver/.test(pattern.source)&&+i===0?match[+i+1]:uiText(match[+i+1]??''))) as T;}
 return value;
}
