import type {LandmarkProject} from '../domain/landmarks/model';
import type {Vec3} from '../domain/project/types';
export function smoothFixture(fold=0,shear=.35):LandmarkProject{
 const p:LandmarkProject={version:'landmarks-0.4.2',meta:{name:'smooth fixture',createdAt:0,updatedAt:0},views:[],centerlineOrder:[],landmarks:[],curves:[],patches:[],surfaceSmooth:{enabled:true,strength:1,edgeInfluenceOverrides:{}}};
 const positions:Vec3[]=[[0,-.5,1],[0,.5,1],[-1,-.5+shear,1+fold],[-1,.5+shear,1+fold],[1,-.5-shear*.4,1+fold],[1,.5-shear*.4,1+fold]];
 positions.forEach((position,i)=>p.landmarks.push({id:'v'+i,name:'v'+i,placement: {kind:'WORLD' as const,position:position},type:'FREE',viewLocks:{}}));
 const edge=(id:string,a:number,b:number)=>{p.curves.push({id,name:id,role:'canonical',startLandmarkId:'v'+a,endLandmarkId:'v'+b,shape:{planeNormal:[0,0,1],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}}});return id;};
 const seam=edge('seam',0,1),a=[seam,edge('a1',1,3),edge('a2',3,2),edge('a3',2,0)],b=[seam,edge('b1',1,5),edge('b2',5,4),edge('b3',4,0)];
 p.patches!.push({id:'pa',type:'quad',boundaryEdgeIds:a,fullness:0},{id:'pb',type:'quad',boundaryEdgeIds:b,fullness:0});
 return p;
}
