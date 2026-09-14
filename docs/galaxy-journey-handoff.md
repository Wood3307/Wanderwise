# 星空单次足迹与观星台接收

本分支已内嵌星空与观星台。用户选择导出的银河行程会进入个人空间的 `galaxyVoyages`，在「漫行者日志 → 星空漫游足迹」中按每趟旅行独立展示；没有选择导出的旅程不会入库。

## 实际接收链路

1. `src/features/galaxy/lib/trip.ts` 管理单次会话、原始访问节点与来源链接。同标签页刷新恢复当前旅行；新的 Router 进入 key 会创建新旅行。
2. `src/features/galaxy/lib/integration.ts` 在用户确认后写入同源待领取记录，并发出 `wanderwise:journey-export`。
3. 宿主 `src/App.tsx` 在个人空间初始化后注册 `connectGalaxyVoyageInbox()`。`src/features/personal/galaxyVoyages.ts` 扫描已授权的待领取记录，页面刷新或星空路由卸载不会丢失队列。
4. `receiveGalaxyVoyage()` 通过原有串行写入队列保存到 IndexedDB。真实事务提交成功后才确认领取并移除待领取记录；失败保留队列供重试。
5. `src/features/galaxy/index.tsx` 保留原返回锚点：从观星台进入则回观星台，从已有陆地旅程进入则回原旅程、站点和视角。返回事件本身不代表导出授权。
6. 观星台提供「查看本次足迹」或「漫游足迹」入口；个人面板用 `GalaxyVoyageLog` 显示时间、问题、文章及安全原文链接。

`tripId` 是幂等身份，重复领取同一趟不会覆盖或累加；旧个人存档缺少 `galaxyVoyages` 时以空列表读取。收藏、笔记、配方和已有陆地旅程保持各自的数据结构。

## 关页与失败边界

浏览器的原生关页确认不能自定义为导出按钮。取消原生关闭后，星空会显示「是否导出漫游足迹」；用户也可直接用返回入口完成导出／舍弃选择。原生确认离开不等于导出许可。

若同源存储不可用，主导出函数只允许已运行宿主同步接管内存包。此分支以异步 IndexedDB 提交为准，不在同步 pending 事件中提前确认，因此会保留星空记录并提示重试，不冒称已经保存。正常失败的待领取包会在重新打开或恢复聚焦后重试。

## 验证

需 Node 24（`.nvmrc`）。

```sh
npm run test:personal
npm run test:galaxy-connection
npm run test:galaxy
npm run test:content
npm run build
```

真实浏览器脚本为 `scripts/test-galaxy-handoff-browser.mjs`。可设置 `BASE_URL` 指向预览服务、`PLAYWRIGHT_MODULE` 指向已安装的 Playwright 模块，以及 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定 Chromium。脚本使用独立浏览器存储与模拟内容 API，不消耗知乎额度，也不修改用户存档。
