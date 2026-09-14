# Wanderwise · 星空与陆地整合版

以小屋、观星台和镜海群岛承接知识探索；星空第八版通过知乎热点、三层阅读与平行虫洞继续拓展问题。收藏、手记、阅读进度和明确导出的星空足迹进入同一套本地个人空间。

本次合并来源：

- 星空：`main` → [`f7cea25`](https://github.com/Wood3307/Wanderwise/commit/f7cea25dfaf937a34940fa64965f56352733c601)，星空第八版。
- 陆地：`20260914` → [`88c847c`](https://github.com/Wood3307/Wanderwise/commit/88c847cd14bb33dc149ac1b31f16e141f3c69f79)，包含直接进入、第一人称跳跃、阅读续读与新版个人空间。

## 启动

使用 `.nvmrc` 指定的 Node.js 24.14.1：

```sh
nvm use
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4187>，默认进入小屋。`PORT` 和 `HOST` 可修改监听地址。开发模式使用 `npm run dev`，Vite 前端为 4173，API 为 4188。

知乎凭证、CLI 路径与预算只在服务端配置；已有 `.env` 应原样保留，不能用模板覆盖。详细设置见 [内容服务](server/content/README.md)。

## 页面

| 路径 | 功能 |
| --- | --- |
| `/home` | 小屋、资料柜、手记、作品和阅读伙伴 |
| `/observatory` | 观星台、收藏树、星门与星空足迹 |
| `/land` | 镜海群岛 |
| `/journey/:realmId` | 按主题进入陆地旅程 |
| `/galaxy` | 星空第八版：热点、问题/回答/段落与平行宇宙 |
| `/galaxy/upstream-version.json` | 当前整合的来源版本 |

星空通过宿主路由进入与返回，不启动第二套应用。小屋、陆地和星空共享来源与收藏，独立手记继续保留。阅读进度与单次星空旅行使用不同字段，导入和接收足迹时均不会覆盖另一类记录。

## 验证

```sh
npm run build
npm run test:home
npm run test:observatory
npm run test:look
npm run test:jump
npm run test:garden
npm run test:journeys
npm run test:personal
npm run test:content
npm run test:galaxy
npm run test:galaxy-connection
```

测试使用固定数据，避免反复消耗真实内容额度。浏览器联调方法及实际验收结果见合并说明。

- [本次合并与验收](docs/merge-worlds-20260915.md)
- [星空整合契约](docs/galaxy-integration.md)
- [平行宇宙操作与接口](docs/galaxy-wormhole-exploration.md)
- [单次旅行足迹交付](docs/galaxy-journey-handoff.md)
- [图文产品说明](docs/submission/illustrated/README.md)
- [第三方来源与署名](docs/galaxy-third-party-notices.md)
