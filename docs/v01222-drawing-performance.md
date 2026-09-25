# V0.12.22 · Drawing Performance

针对用户提供的 `绘制间.json`（编辑耳朵并复制镜像后严重卡顿），使用独立 Chrome 测试实例导入完整项目复现。没有替换用户当前页面或修改原存档。

## 数据与根因

绘制数据只有 104 条 Curve、119 个 Node、61 个 Join（43 Smooth、17 Cusp、1 Arc）、28 笔、9 个 Fill、11 层、2 个 Group。左右耳各 16 条曲线。自适应采样总计 3,873 点，单 Curve 最多 102 点。没有发现镜像复制产生海量对象或采样数量爆炸。

主要瓶颈是浏览器主线程 JavaScript：

1. `strokeFor` 每次只查询一条 Curve，却先求出所有图层的全部连续笔画，再搜索成员。侧栏组合、选中高亮、显示区间等重复调用；选中高亮还在每个 interval 检查里重算。
2. `DrawingRoom.move` 在每次鼠标移动时更新没有被任何界面使用的 `cursor` state；即使只移过空白区域也重绘整个 Drawing Room，触发上面的重复求值。
3. 每次重绘重新生成未变化笔画的 arc-length table、收尖、尖点和显示区间墨线。
4. 热循环中的 `curveById` / `nodeAt` 反复线性遍历对象数组。

复制增加对象与关系后，嵌套遍历的成本迅速上升。复现的是当前持续卡顿；没有历史崩溃日志，不能认定此前那一次“卡死”的唯一原因。

## 修复

- 按图层真实连接数据和排序建立连续笔画索引，并用有界输入缓存复用。坐标/handle 改动不再重建连接图。值键允许命令在私有 draft 内修改连接，避免仅按 document identity 缓存造成陈旧数据。
- `strokeFor` 只访问所属图层并查找索引；同一组内重复的笔画只汇总一次。
- 去掉无用途的鼠标 cursor state；钢笔、绑定和镜像预览仍使用原来的专用状态。
- 缓存实际几何和全部样式参数决定的笔触输出；未变化笔画不再重复采样。缓存 128 项，不保存项目/撤销历史，且复制输入坐标以免 draft 原地编辑污染历史结果。
- 点线查询使用数组弱引用索引；读取时校验实际槽位，支持原地替换、重排、增删。
- 保存 schema、原始曲线、采样精度、接笔公式、填充和显示区间语义均未修改。

## 同机、同一完整存档的浏览器实测

Chrome、1440×1000、Vite 开发模式、CDP CPU profiler 开启。顺序为 30 次空白鼠标移动、选中“内耳廓”、12 次 handle 拖动。

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| 查询全部 104 条曲线的连续笔画（5 次平均） | 806.16 ms | 0.52 ms |
| 全部笔触求值（5 次平均，含缓存复用） | 16.98 ms | 3.16 ms |
| 空白鼠标移动每步（含自动化往返） | 336.1 ms | 16.77 ms |
| Handle 拖动每步（含自动化往返及最终提交） | 710.67 ms | 40.67 ms |
| RAF 帧间隔 P95 | 616.7 ms | 16.8 ms |
| RAF 最大间隔 | 650 ms | 50 ms |

修复前 mousemove long task 约 294–356 ms，选中/拖动约 608–657 ms。修复后的测试仍有 3 次 57–70 ms long task（选择/提交等），并非保证所有交互稳定 60 fps。

原始记录见 `artifacts/drawing-performance/baseline.json`、`optimized.json` 和各自 `.cpuprofile`。两次导入后 45 个 Ink / Fill / Cusp SVG 路径逐字一致。

## 回归

- `src/tests/drawing-performance.test.ts`：实际耳朵存档的 handle 编辑、拓扑复用/解绑/Undo、私有 draft 原地修改、隐藏状态、索引变更、墨线缓存输入隔离与显示区间样式。
- `tests/e2e/drawing-performance.spec.ts`：该存档浏览器性能预算；图层复制、水平镜像、编辑、Undo/Redo。
- 绘制领域及 i18n 单元测试：142 项通过。
- 绘制浏览器测试：88 项中 84 项通过，包括本次实际耳朵性能和复制/镜像/Undo 测试。
- 4 项旧失败已在隔离的修复前版本逐项复现：2 项镜像轴输入框选择器重复匹配、2 项旧跨层拖放用例失败。未扩展本轮改动去调整这些既有交互/测试。
- `npm run build` 通过。

复测完整项目：

```sh
PERF_STAGE=verify DRAWING_PERF_PROJECT='/Users/bowen/Desktop/绘制间.json' npx playwright test tests/e2e/drawing-performance.spec.ts
```

不设置 `DRAWING_PERF_PROJECT` 时使用仓库内无背景图片的 Drawing fixture。
