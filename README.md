# Contour — Semantic Landmark Management V0.2

共享三维语义点支持复制、重命名、删除。初始点与新增点完全平等。视图锁约束 driver，镜像伙伴作为 dependent follower 跟随；投影、受限拖动和对称数学沿用 V0.1。

```sh
npm ci
npm run dev -- --port 5173
```

打开 http://127.0.0.1:5173/。支持参考图、100 步 Undo/Redo、JSON 和本机自动保存、空项目。

[V0.2 使用与实现说明](docs/semantic-points-v02.md)

Git 基线：`v0.1-landmark-editor` (`7a40cd0`)；开发分支：`v0.2-landmark-management`。旧 surface/solver 及历史测试保留。

```sh
npm run build
npm test
npm run test:e2e
```

本版本不实现 Curve、Bézier、Surface 或 Patch。
