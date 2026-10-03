import {Scan,MousePointer2,MousePointer,PenTool,Circle,Scissors,FlipHorizontal,Merge,Link,Link2,GitMerge,Triangle,CornerDownRight,Hand,ZoomIn} from 'lucide-react';
export const CONNECTION_TOOLS=['link','bind','smooth','cusp','arc'] as const;
export type ConnectionTool=typeof CONNECTION_TOOLS[number];
export const isEndpointTool=(tool:string)=>tool==='merge'||CONNECTION_TOOLS.some(t=>t===tool);
export const TOOLS=[
 ['select','选择整笔','V','V 选择整笔或组合；A 编辑成员；Shift 复选。',MousePointer2],['direct','直接选择','A','选择组内单段、端点或控制柄；拖动即可编辑。',MousePointer],
 ['deform','四角 / 曲边','','先选图层或笔画；拖四角调整透视，拖边柄或菱形中点弯曲边界。隐藏成员一起变形，锁定成员受保护。',Scan],
 ['pen','钢笔','P','落点，拖出控制柄，继续下一段。',PenTool],['ellipse','椭圆','L','拖出椭圆，自动形成闭合笔画。',Circle],
 ['split','分割曲线','','点击曲线内部，精确分成两段。',Scissors],['mirror','镜像编辑','','第一击源曲线，第二击目标曲线。',FlipHorizontal],['merge','合并位置','','只移动一次，不建立绑定。',Merge],
 ['link','端点联动','','两端同步移动，保留各自笔画、线宽和图层。',Link2],
 ['bind','绑定端点','','合成同一笔画，两侧控制柄仍可独立调整。',Link],
 ['smooth','平滑接笔','','合成同一笔画，两侧控制柄反向共线，平顺连接。',GitMerge],
 ['cusp','尖点接笔','','合成同一笔画，锐角处保持尖角，控制柄独立。',Triangle],
 ['arc','圆弧接笔','','合成同一笔画，按可调影响范围生成圆弧过渡。',CornerDownRight],
 ['hand','抓手','H','拖动平移画布。',Hand],['zoom','缩放','Z','按住鼠标向上拖动放大，向下拖动缩小。',ZoomIn],
] as const;
