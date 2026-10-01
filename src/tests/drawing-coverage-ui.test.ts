import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseDrawing} from '../domain/drawing/model';
import {displayPath} from '../domain/drawing/displayIntervals';
import DisplayCoverageBar from '../ui/drawing/DisplayCoverageBar';
const d=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),'utf8')));
test('whole-route coverage and global range numbering do not depend on selected source member',()=>{
 const track=d.displayIntervals!.find(t=>t.displayRoute)!,path=displayPath(d,track.anchor.id),before=JSON.stringify(d);
 const render=(id:string)=>renderToStaticMarkup(createElement(DisplayCoverageBar,{d,id,selection:{ids:[id]},choose:()=>{}}));
 const first=render(path.segments[0].id);expect(first).toContain('data-testid="drawing-effective-coverage"');expect((first.match(/data-range-id=/g)??[])).toHaveLength(1);
 for(const use of path.segments)expect(render(use.id)).toBe(first);
 const selected=renderToStaticMarkup(createElement(DisplayCoverageBar,{d,id:track.anchor.id,selection:{ids:[track.anchor.id],displayInterval:{track:track.id,range:track.ranges[0].id,end:0}},choose:()=>{}}));expect(selected).toContain('aria-pressed="true"');expect(selected).toContain('stroke="#56bce6"');expect(JSON.stringify(d)).toBe(before);
});
