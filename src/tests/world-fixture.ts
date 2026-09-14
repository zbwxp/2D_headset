import type {SemanticLandmark} from '../domain/landmarks/model';
export function world(l:SemanticLandmark){if(l.placement.kind!=='WORLD')throw Error('Expected WORLD fixture');return l.placement;}
