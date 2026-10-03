import {uiText as t} from '../i18n';

/** The same frame controls accompany Drawing's cage in every workspace. */
export default function CageEditorControls({maxError,onResetFrame,onDone}:{maxError:number;onResetFrame:()=>void;onDone:()=>void}) {
 return <><span data-testid="drawing-deform-error">{t('采样拟合偏差')} ≈ {(maxError*250).toFixed(2)} px</span><button onClick={onResetFrame}>{t('重置变形框')}</button><button onClick={onDone}>{t('完成')}</button></>;
}
