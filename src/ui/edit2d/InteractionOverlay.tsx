import type {ReactNode} from 'react';
/** Always above ordinary surface/curve rendering. Picking stays CPU/SVG. */
export default function InteractionOverlay({children}:{children:ReactNode}){
 return <g data-layer="interaction-overlay" data-testid="interaction-overlay">{children}</g>;
}
