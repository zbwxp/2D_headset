import {useLayoutEffect,useState,type RefObject} from 'react';
import type {LandmarkView} from '../../domain/landmarks/model';
import {orthographicView} from '../../rendering/orthographic';
export function useOrthographicView(ref:RefObject<SVGSVGElement|null>,view:LandmarkView){
 const [size,setSize]=useState({width:600,height:560,dpr:1});
 useLayoutEffect(()=>{
  const svg=ref.current;if(!svg)return;
  const update=()=>{const {width,height}=svg.getBoundingClientRect(),dpr=window.devicePixelRatio||1;setSize(old=>old.width===width&&old.height===height&&old.dpr===dpr?old:{width,height,dpr});};
  let media:MediaQueryList;
  const dprChanged=()=>{update();watchDpr();};
  const watchDpr=()=>{media?.removeEventListener('change',dprChanged);media=window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);media.addEventListener('change',dprChanged);};
  watchDpr();
  const observer=new ResizeObserver(update);observer.observe(svg);window.addEventListener('resize',update);update();
  return()=>{media.removeEventListener('change',dprChanged);observer.disconnect();window.removeEventListener('resize',update);};
 },[ref]);
 return orthographicView(view.camera,view.canvas,size.width,size.height,size.dpr);
}
