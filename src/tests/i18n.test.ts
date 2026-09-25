import {test,expect} from 'vitest';
import {uiText,useLanguage} from '../ui/i18n';
test('UI catalog switches both directions and preserves arbitrary names and non-text values',()=>{
 useLanguage.setState({language:'en'});expect(uiText('保存 JSON')).toBe('Save JSON');expect(uiText('自定义下颌 A')).toBe('自定义下颌 A');const object={id:'PATCH'};expect(uiText(object)).toBe(object);expect(uiText(0.4235)).toBe(0.4235);
 useLanguage.setState({language:'zh'});expect(uiText('On Surface Curve')).toBe('贴面曲线');expect(uiText('Identity')).toBe('身份');
});
test('dynamic captions and accessibility strings translate without modifying source names',()=>{
 useLanguage.setState({language:'en'});expect(uiText('显示 2D 视角 窗口')).toBe('Show 2D Viewport panel');expect(uiText('左 30°')).toBe('Left 30°');expect(uiText('面凸度 Fullness 数值')).toBe('Surface fullness value');expect(uiText('Host: 轮廓 · 选择第一个定位点')).toBe('Host: 轮廓 · Select first anchor');
 useLanguage.setState({language:'zh'});expect(uiText('quad Surface 2')).toBe('四边面 2');
});
