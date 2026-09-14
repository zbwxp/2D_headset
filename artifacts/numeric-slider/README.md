# V0.4.3 — Unified NumericSlider

## API

`src/ui/shared/NumericSlider.tsx` 提供共享组件：

```ts
interface NumericSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  step?: number;       // 只定义 keyboard normal 基础增量，不吸附
  fineScale?: number;  // 默认 0.2
  coarseScale?: number;// 默认 5
  formatValue?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}
```

组件不导入 store 或任何 geometry 模块。内部唯一的原生 range 使用 `step="any"`，键盘和 pointer 行为由组件管理。没有 snap、angle wrap 或数值输入框。

## 已迁移

- Patch Fullness；
- Surface Smooth Strength；
- Edge Smooth Influence；
- Curve Plane Angle；
- 2D / 3D Patch opacity；
- 参考图 opacity、scale、水平/垂直 offset、rotation；
- 三个主窗口的 width ratio。

源码检索 `src/**/*.tsx` 后，仅共享组件内部保留一处 `type="range"`，不再有独立滑条的 pointer/keyboard/history 逻辑。

## 键盘

默认 `baseStep=(max-min)*0.0025`；调用方可显式覆盖 `step`。Alt/Option ×0.2、Shift ×5，同时按时 Fine 优先。ArrowUp/Down 与 Right/Left 等价，Home/End 到两端。

| 参数范围 | Normal | Fine | Coarse |
|---|---:|---:|---:|
| 0..1 | 0.0025（0.25%） | 0.0005（0.05%） | 0.0125（1.25%） |
| Fullness -1..1 | 0.005（0.5 百分点） | 0.001（0.1 百分点） | 0.025（2.5 百分点） |
| Angle -180..180 | 0.9° | 0.18° | 4.5° |
| Window ratio 0.5..3 | 0.00625 | 0.00125 | 0.03125 |

第一次 keydown 立即单步；300ms 延迟后用 requestAnimationFrame + performance.now 计时，忽略操作系统重复 keydown。连续速度：

```
baseStep × modifier × 20 steps/s × multiplier
multiplier = 1 + 15 × (1-exp(-max(0,holdMs-300)/1400))²
```

倍率平滑增至最多 16。每帧 dt 最多 50ms，防止卡顿后一次跳跃过大。松开清除 timer/holdDuration；下一次仍从基础单步开始。加速不改变 step，也不将结果量化。

## Pointer 与焦点

每次移动读取轨道当前 getBoundingClientRect，按 `(clientX-left)/width` 映射 min..max 并 clamp。pointer capture 让拖出轨道仍可继续更新；抬起、取消或丢失捕获时结束。track/thumb/value caption 点击后可直接用键盘；focus-visible 细框；aria-valuetext 使用格式化数值。

只在滑条 input 处理方向键，没有全局 Slider keyboard handler；文本与 FloatingPanel 中的其他输入不被抢键。

## 编辑会话与精度

首次实际变化触发 onEditStart，连续变化仅调用 onChange，结束触发一次 onEditEnd。没有数值变化就不创建空 Undo。keyup、元素 blur、窗口 blur、页面隐藏、卸载、disabled 和 pointer cancellation 都结束会话。

Geometry 调用方接 `beginEdit`，保持一次鼠标拖动/一次键盘长按一个 Undo。显示 opacity/窗口比例不接 geometry history。Reference 仍按现有参考图历史规则记录。

没有存储取整。部分现有 UI 继续使用 0..100 的显示坐标，调用方除以 100 存回原单位，不损失小数精度。`formatNumeric` 只在展示时保留最多两位、去尾零。42%、42.5%、42.35% 和小数角度均可显示。

Project JSON schema 不变，应用版本文字更新为 V0.4.3。

## 验证

最终结果：121 项单元测试通过，build 通过。浏览器全套 37 项中首次 36 项通过，剩余参考图旧步长断言修正后复测通过；额外补充显式 step 测试，最终覆盖的 38 项均通过（最后针对滑条与 Landmark 的 11 项回归全部通过）。

- 纯函数测试：归一化步长、Fine 优先、加速单调连续有上限、轨道映射/clamp、格式化。
- 浏览器组件测试：真实键盘、受控时间推进的长按、松开复位、Home/End、指针捕获、拖出边界、所有会话中断及文本输入。
- 缩放映射：100%/150% CSS zoom 与 1000/1400px viewport resize 下，同一轨道比例仍得到同一数值。此项模拟缩放后的布局坐标，不冒称测试了所有浏览器原生 zoom 菜单档位。
- 实际编辑器：42.35% 存储为0.4235，键盘长按一个 Undo，Undo/Redo 恢复，opacity 不进 geometry history。
- 原 Fullness 鼠标连续拖动一条历史测试继续保留。
- 旧 reference / Fullness 单按预期更新为新 normalized step。

没有修改 domain geometry、Surface Smooth 求解、View Lock、symmetry；未加入 ON_CURVE Point 或其他新参数。
