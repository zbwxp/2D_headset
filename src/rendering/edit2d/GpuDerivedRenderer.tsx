import {editSurfacePicker} from './picking';
import {useLayoutEffect,useRef,useState} from 'react';
import {WebGLRenderer,Vector2} from 'three';
import type {Edit2DRendererProps} from './CpuSvgRenderer';
import {GpuScene} from './GpuScene';
import {count} from '../../domain/geometry/diagnostics';
/** One WebGL context per mounted Main EditView, no animation loop when idle. */
export default function GpuDerivedRenderer(props:Edit2DRendererProps){
 const host=useRef<HTMLDivElement>(null),current=useRef(props);current.current=props;
 const runtime=useRef<{schedule:()=>void}|null>(null);const [error,setError]=useState('');
 useLayoutEffect(()=>{
  let renderer:WebGLRenderer;
  try{renderer=new WebGLRenderer({alpha:true,antialias:true,stencil:true,premultipliedAlpha:true});}
  catch(e){setError('GPU 初始化失败：'+String(e));return;}
  count('gpuRendererCreated');renderer.autoClear=false;renderer.setClearColor(0x000000,0);renderer.sortObjects=false;
  const canvas=renderer.domElement;canvas.dataset.testid='gpu-derived-canvas';canvas.style.cssText='width:100%;height:100%;display:block;pointer-events:none';host.current!.appendChild(canvas);
  const scene=new GpuScene();let frame=0,disposed=false;
  const draw=()=>{frame=0;if(disposed)return;const {snapshot,view,style}=current.current;
   if(renderer.getPixelRatio()!==view.devicePixelRatio)renderer.setPixelRatio(view.devicePixelRatio);
   const size=renderer.getSize(new Vector2());if(size.x!==view.viewportWidth||size.y!==view.viewportHeight)renderer.setSize(view.viewportWidth,view.viewportHeight,false);
   scene.update(snapshot,style);scene.draw(renderer,view);
  };
  const picker={pick:(screen:[number,number],ids?:ReadonlySet<string>)=>{cancelAnimationFrame(frame);frame=0;draw();const {view}=current.current;return scene.pick(renderer,view,...screen,ids);}};editSurfacePicker.current=picker;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw);};runtime.current={schedule};schedule();
  const lost=(e:Event)=>{e.preventDefault();setError('GPU 上下文丢失，等待恢复。');};const restored=()=>{setError('');schedule();};
  canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
  return()=>{if(editSurfacePicker.current===picker)editSurfacePicker.current=null;disposed=true;cancelAnimationFrame(frame);runtime.current=null;canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);scene.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();count('gpuRendererDisposed');};
 },[]);
 useLayoutEffect(()=>{runtime.current?.schedule();},[props]);
 return <div ref={host} data-testid="gpu-derived-renderer" data-surface-triangles={props.snapshot.surface.reduce((n,p)=>n+p.indices.length/3,0)} data-surface-count={props.snapshot.surface.length} className="gpu-derived-renderer">{error&&<div role="alert" className="gpu-render-error">{error}</div>}</div>;
}
