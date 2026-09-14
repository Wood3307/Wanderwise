# 星空第八版与最新陆地合并

目标分支：`20260914`。

## 来源

| 系统 | 分支 | 锁定提交 |
| --- | --- | --- |
| 星空第八版 | `main` | [`f7cea25dfaf937a34940fa64965f56352733c601`](https://github.com/Wood3307/Wanderwise/commit/f7cea25dfaf937a34940fa64965f56352733c601) |
| 陆地主线 | `20260914` | [`88c847cd14bb33dc149ac1b31f16e141f3c69f79`](https://github.com/Wood3307/Wanderwise/commit/88c847cd14bb33dc149ac1b31f16e141f3c69f79) |

两个来源的根目录采用不同应用结构，因此以陆地应用为宿主，把星空前端放入 `src/features/galaxy`、资源放入 `public/galaxy`，通过现有同源内容服务连接知乎。合并保留两条 Git 历史，`main` 继续作为独立星空版本。

星空组件、模型、虫洞、图像、字体和音乐与第八版逐项核对；差异限于宿主路径、样式作用域、React 19、返回路由及共享数据适配。最新陆地的场景、跳跃、群岛、交互、渲染与部署文件沿用 `88c847c`；独立录制展示分支不属于此次普通游戏整合范围。

版本信息由 `/galaxy/upstream-version.json` 提供，包含两个来源提交。

## 连接行为

- `/` 进入小屋，旧 `/world` 链接转到 `/land`。观星台、群岛和主题旅程可进入 `/galaxy`。
- 星空保留当前知乎热榜、问题/回答/段落三级阅读、仿宋与 Markdown/LaTeX、平行宇宙、拖动/缩放和蓝白虫洞。
- 旅程来源按真实身份传入；返回时恢复原陆地旅程、站点与位置，普通进入返回观星台。
- 收藏、独立手记和阅读进度共享宿主个人空间。星空按单次旅行记录，明确导出后进入漫行者日志。
- 个人面板同时保留陆地工作区、灯下续读和星空旅行日志；观星台能打开本次导出的足迹。

## 合并时解决的兼容问题

1. 最新陆地已移除邀请码。联想接口改用签名访客身份，与合成服务共享实际配置的全局/访客 AI 预算；保留缓存、并发去重及模型失败时的语义降级。
2. 个人备份导入与后台足迹接收共用持久化队列；排队保存执行时读取当前资料，避免导入成功后被旧快照覆盖。足迹确认必须对应包含该旅程的真实提交。
3. 来源别名归并时按更新时间保留较新的阅读进度。
4. 接入测试执行新版虫洞 hook；陆地素材检查读取已提交的纹理清单，不依赖 Git 忽略的构建报告。素材像素和几何未修改。

## 验证

已完成：

- 生产构建、TypeScript、相关变更 ESLint。
- 小屋、观星台、视角、跳跃、花园配方及陆地导航检查；11 个世界的导航与几何共 1461 项检查通过。
- 个人数据 84 项、内容服务 12 项、星空 173 项、宿主接入 11 组通过。
- 素材解码和预算检查通过；683 个星空样式选择器、7 组资源、17 个动画作用域检查通过。
- 桌面与 390px 手机各 6 组浏览器联调通过：直达小屋/陆地、三层阅读、明确导出、观星台日志、阅读工作区共存、新旅行、舍弃和重开领取。
- 平行宇宙 8 项浏览器流程通过：三个深度往返、拖动/缩放、连续关键词进入、原话题返回、失败/取消、蓝白隧道首帧握手、手机双指操作、结束旅行中止请求；未出现页面异常。

浏览器使用隔离存储与固定 API 响应，不读取玩家资料，也不消耗真实知乎搜索/模型额度。原工作区和其中的未提交内容保留。

复验方法：

```sh
npm ci
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

`scripts/test-galaxy-handoff-browser.mjs` 可用 `PLAYWRIGHT_MODULE` 指向已安装的 Playwright，`BASE_URL` 指向统一服务；`VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844` 运行手机布局。平行宇宙完整浏览器用例位于独立星空版本的 `tests/wormhole.spec.ts`，设置 `WORMHOLE_ENTRY_PATH=/galaxy` 与目标 `PLAYWRIGHT_BASE_URL`。
