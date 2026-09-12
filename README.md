# Contour — Semantic Point Editor V0.1

当前版本只编辑 20 个共享三维语义点。视图锁约束 driver，镜像伙伴作为 dependent follower 跟随，不额外消耗自由度；中心线点保持 x=0。二维视图使用正交投影；3D 视口仅检查点的位置。

```sh
npm ci
npm run dev -- --port 5173
```

打开 http://127.0.0.1:5173/。参考图可加载、平移、缩放、旋转、调整透明度和锁定。支持 JSON 保存 / 载入、本机自动保存、100 步会话撤销。

完整实现说明、文件列表、手工验收及已知限制见 [V0.1 文档](docs/semantic-points-v01.md)。

```sh
npm run build
npm test
npm run test:e2e
```

旧曲面 solver 已从应用调用路径移除，其源文件和测试仅保留供历史参考。未实现 Curve、Surface 或 V0.2。
