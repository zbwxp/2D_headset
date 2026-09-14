import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import NumericSlider from '../../src/ui/shared/NumericSlider';
function Harness(){const[value,setValue]=useState(50),[starts,start]=useState(0),[ends,end]=useState(0),[disabled,disable]=useState(false),[visible,show]=useState(true),[angle,setAngle]=useState(0),[stepped,setStepped]=useState(0);
 return <div style={{width:'60vw'}}><style>{'.numeric-slider{display:block}.numeric-slider input{width:100%}.numeric-slider-caption{display:block}output{margin-left:10px}'}</style>
 {visible&&<NumericSlider label="Test" min={0} max={100} value={value} disabled={disabled} onChange={setValue} onEditStart={()=>start(x=>x+1)} onEditEnd={()=>end(x=>x+1)}/>}
 <NumericSlider label="Angle" min={-180} max={180} value={angle} onChange={setAngle}/>
 <NumericSlider label="Stepped" min={0} max={100} step={.7} value={stepped} onChange={setStepped}/>
 <output data-testid="counts">{starts},{ends}</output><output data-testid="value">{value}</output>
 <button onClick={()=>disable(x=>!x)}>Disable</button><button onClick={()=>show(x=>!x)}>Unmount</button>
 <button onClick={()=>{setValue(50);start(0);end(0);}}>Reset</button><input aria-label="Text" defaultValue="test"/>
 </div>;
}createRoot(document.getElementById('root')!).render(<Harness/>);
