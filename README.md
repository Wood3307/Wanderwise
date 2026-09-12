# Wanderwise · 漫知

以知乎内容为来源的三维知识探索 Web 应用。依据工作区《设计理念.md》，参考 WikiGalaxy 的粒子星海、轨道与飞行交互，独立实现现代 Three.js 渲染与三层知识纵深。

## 启动

需要 Node.js 18.19+ 和 npm。

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>。此命令同时启动 Vite 前端和 3001 端口的内容服务，不需要另起后端。首次启动无需密钥，可浏览随项目保存的 **10 篇知乎官方公开知识正文节选**；后台会尝试刷新官方数据。

生产运行：

```bash
npm run build
npm start
```

访问 <http://localhost:3001>，同一进程同时提供构建后的网页与 API。生产进程需要安装运行依赖及 `tsx`（本项目的服务端直接运行 TypeScript）。

## 知乎内容接入

复制 `.env.example` 为 `.env`，在本机编辑：

```dotenv
ZHIHU_ACCESS_SECRET=你的知乎开放平台凭证
PORT=3001
```

凭证来自 <https://developer.zhihu.com/profile>。重启服务后，输入问题即可调用工作区知乎文档所述的 `zhihu_search` 接口。密钥只在服务端读取，**不要加 `VITE_` 前缀，也不要提交 `.env`**。

- 有密钥且输入问题：调用知乎搜索，最多接收 10 个真实结果，按原始问题 ID 或标题归组；保留作者、赞同数和溯源链接。搜索没有提供完整原文，第三层明确显示“搜索摘要”。
- 未配置密钥：在官方赛事公开知识语料内按关键词检索；空问题为自由漫游，不匹配时显示空结果，不生成虚构回答。
- 官方赛事 API 将大部分正文截断到约 3000 字，公开内容明确标为“正文节选”。每篇作品是一个主题、一个作者的内容，不冒充同一个问题下的多位回答者。
- 网络不可用：公开模式可继续使用 `server/data/zhihu-public.json` 中的真实快照；搜索认证失败和额度限制会明确报错，不伪装成搜索无结果。
- 公开内容的来源链接指向官方内容接口；搜索内容链接指向对应知乎原文。内容版权归原作者及其权利人所有。

当前集成依据 `REFERENCE/zhihu/references/http-api.md` 和 `hackathon-content-api.md`。赛事公开接口的长期可用性取决于知乎；客户端未抓取站点，也未安装或依赖知乎 CLI。

## 探索方式

| 操作                    | 效果                                             |
| ----------------------- | ------------------------------------------------ |
| 向上滚轮 / 双指张开     | 逐步深入：问题星海 → 观点星系 → 文章恒星         |
| 向下滚轮 / 双指收拢     | 回到上一层纵深                                   |
| 鼠标拖动 / 单指滑动     | 转动三维视角                                     |
| 点击星体或标题          | 选择问题或回答                                   |
| 双击星体 / 点击进入按钮 | 飞向该层内容                                     |
| F                       | 切换自由飞行                                     |
| W / S、A / D、Shift     | 深入 / 返回、横向移动、加速                      |
| E                       | 第二层收藏问题，第三层收藏文章；再次按下取消收藏 |
| R                       | 对问题、文章或选中的段落写下思考                 |
| Esc                     | 关闭弹窗或回到上一层                             |
| /                       | 聚焦问题输入框                                   |

文字输入时不会触发飞行、收藏或思考快捷键。底部分层按钮和星海图谱提供不依赖鼠标滚轮的导航。浏览器不支持 WebGL 或渲染上下文丢失时，切换到可操作的二维星图。

知识行囊、思考和足迹保存在当前浏览器的 `localStorage`。关闭或刷新页面后仍保留；换设备、清理站点数据和隐私模式不提供跨设备同步。可导出 Markdown 旅行手记，包含原作者、来源、引用段落、个人思考和探索时间线。

## 接入已有占星台 / 小屋

仓库尚未包含已有占星台及小屋源码，本实现只开发星空探索，并预留以下接口。具体类型见 `src/types.ts`，实现见 `src/lib/integration.ts`。

最简单的跳转接入：

```ts
const question = "大学生实习应该如何获取资源？";
location.assign(
  `/explore?q=${encodeURIComponent(question)}&returnUrl=${encodeURIComponent("/observatory")}`,
);
```

本应用支持任意前端路由的 SPA 回退；生产部署也应将应用路由回退到 `index.html`，并将 `/api` 交给内容服务。支持 `q` 或 `topic` 参数；问题最长 160 字。

已嵌入同一个页面时，在 `wanderwise:ready` 之后调用：

```ts
window.Wanderwise?.enter({
  query: "大学生实习应该如何获取资源？",
  returnUrl: "/observatory",
});

// 或使用自定义事件
window.dispatchEvent(
  new CustomEvent("wanderwise:enter", {
    detail: { query: "如何提高专注力？", returnUrl: "/observatory" },
  }),
);
```

同源 iframe 支持：

```ts
iframe.contentWindow?.postMessage(
  {
    type: "wanderwise:enter",
    payload: { query: "如何提高专注力？", returnUrl: "/observatory" },
  },
  location.origin,
);
```

返回时监听：

```ts
window.addEventListener("wanderwise:return", (event) => {
  const { query, summary, returnedAt } = (event as CustomEvent).detail;
  // summary 包含 collection、reflections、journey，可交给小屋整理。
  event.preventDefault();
  // 在这里切换到已有的占星台 / 小屋视图。
});
```

只有同源消息可改变探索入口；返回地址仅接受同源相对路径。宿主可用 `preventDefault()` 接管返回；否则跳转到有效 `returnUrl`。没有宿主和返回地址时，应用显示本次收获与导出入口。

## API 与项目结构

| 路径                         | 返回                                         |
| ---------------------------- | -------------------------------------------- |
| `GET /api/health`            | 服务状态、是否配置搜索凭证、公开语料数量     |
| `GET /api/explore?q=...`     | 查询、关键词、问题与回答、来源模式和来源说明 |
| `GET /api/knowledge/:workId` | 已知官方公开作品的作者与正文节选             |

```text
src/App.tsx                    探索界面、阅读、行囊、思考与足迹
src/components/GalaxyScene.tsx 三维粒子、投影标签、镜头与手势
src/lib/storage.ts             持久化、校验及 Markdown 导出
src/lib/integration.ts         占星台入口及返回协议
server/zhihu.ts                内容适配、关键词、缓存与上游请求
server/app.ts                  API、错误边界和生产静态资源托管
server/data/zhihu-public.json  附来源及获取时间的真实公开内容快照
tests/                        浏览器端到端测试
REFERENCE/                    原始参考资料，保留原状
```

语义相关度使用中文分词后的标题 / 正文词项匹配与结果排序计算，亮度随分数变化；没有查询的自由漫游按公开列表顺序赋予初始亮度。这是可解释的关键词相关性，当前未接入向量模型。页面支持移动端、减少动态效果及本地中文字体。

## 验证

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

浏览器测试可使用已有 Chromium：

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/你的/chromium/路径 npm run test:e2e
```

可选 `PLAYWRIGHT_BASE_URL` 指向已启动的服务。基础测试覆盖来源归组、上游错误、密钥隔离、输入校验、收藏恢复、导出和宿主接入；浏览器测试覆盖三层导航、收藏、段落思考、刷新恢复、查询、异常及移动端操作。

本次没有知乎搜索凭证，因此任意问题搜索通过协议测试验证，真实联网验收使用的是无需凭证的官方公开内容接口。没有部署到外部平台。

参考项目、字体与依赖的署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
