import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import Properties from '../ui/drawing/Properties';
import EndpointLinkBrushInfo from '../ui/drawing/EndpointLinkBrushInfo';
import {parseDrawing,type DrawingDocument} from '../domain/drawing/model';
const asset=(name:string)=>parseDrawing(JSON.parse(readFileSync(new URL('../assets/'+name,import.meta.url),'utf8')));
const linkId='ed1131ae-74c5-4534-9b6b-6395e37b1a58',closureId='35dd05a4-bbc8-4bd7-bfd3-9b8d000acf04';
function properties(d:DrawingDocument,id:string){const write=vi.fn(),node=d.curves.find(c=>c.id===id)!.nodes[0];const markup=renderToStaticMarkup(createElement(Properties,{open:true,setOpen:write,document:d,selection:{ids:[id],node},active:null,run:write,choose:write,tool:write,transform:write,upload:write,moveReference:write,preview:write}));expect(write).not.toHaveBeenCalled();return markup;}

test.each(['hairless-symmetric-two-face-mirror.json','right90-reference.json'])('closure shared-node selection reveals the actual cross-layer ARC participants: %s',file=>{
 const d=asset(file),before=JSON.stringify(d),markup=properties(d,closureId);
 expect(markup).toContain('本层连接');expect(markup).toContain('仅绑定');expect(markup).toContain('跨图层末端笔触');expect(markup).toContain('圆弧接笔');expect(markup).toContain('0.052572222');expect(markup).toContain('不是精确圆半径');
 const start=markup.indexOf('data-testid="drawing-link-brush-info"'),end=markup.indexOf('class="drawing-property-actions"',start),card=markup.slice(start,end);
 expect(card).toContain('data-link-id="'+linkId+'"');expect(card).toContain('data-curve-id="65450d8d-7c62-4d87-b421-616dfbcab097"');
 expect(card).toContain('data-curve-id="'+(file.startsWith('right90')?'04da1759-bd52-42f4-857d-afbea7bf1326':'1a723ec7-9bbe-4c56-8c0f-680d03741aa6')+'"');expect(card).not.toContain('data-curve-id="'+closureId+'"');expect(card).toContain('已用于贯通显示路径');expect(JSON.stringify(d)).toBe(before);
});

test.each(['SMOOTH','SHARP',undefined] as const)('shows stored %s appearance independently from local connection',kind=>{
 const d=asset('hairless-symmetric-two-face-mirror.json'),link={...d.endpointLinks!.find(l=>l.id===linkId)!,joinBrush:kind?{kind}:undefined};
 const markup=renderToStaticMarkup(createElement(EndpointLinkBrushInfo,{d,link}));expect(markup).toContain(kind==='SMOOTH'?'平滑接笔':kind==='SHARP'?'尖点接笔':'未单独设置');expect(markup).not.toContain('drawing-link-trim-distance');
});

test('an unused saved ARC is identified as inactive rather than applied to selected ink',()=>{
 const d=asset('hairless-symmetric-two-face-mirror.json');d.displayIntervals=[];const before=JSON.stringify(d),markup=properties(d,closureId);expect(markup).toContain('未用于贯通显示路径');expect(markup).toContain('圆弧接笔');expect(JSON.stringify(d)).toBe(before);
});

test('a disabled through link does not claim active brush use',()=>{
 const d=asset('hairless-symmetric-two-face-mirror.json'),link={...d.endpointLinks!.find(l=>l.id===linkId)!,throughDisplay:false};const markup=renderToStaticMarkup(createElement(EndpointLinkBrushInfo,{d,link}));expect(markup).toContain('未用于贯通显示路径');expect(markup).not.toContain('已用于贯通显示路径');
});
