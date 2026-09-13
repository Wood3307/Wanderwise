# Wanderwise · 漫知

以知乎内容为来源的三维知识探索应用。页面把内容放在宇宙中，按照 **问题集合 → 问题与多个回答 → 文章与精选段落** 展开；原文在居中阅览窗口中阅读。

视觉采用无边框的全息文字、羽化投影光场与低亮度宇宙背景。星云、银河尘带和远处黑洞提供空间层次；背景随阅读纵深减弱，支持轻微视差与减少动态效果。背景图约 201 KiB，随应用本地提供；生成提示词和来源见 [宇宙背景美术说明](docs/COSMIC_ART_DIRECTION.md)。

三层内容均绑定实际三维天体：问题对应星系核心，回答对应旋臂或恒星群中的亮星，精华段落对应恒星系中的行星。拖动相机时，天体和文字由同一世界坐标投影移动；文字保持水平，并通过邻近避让与细引导线保持可读。Shift 或右键拖动可平移视角。

星系包含棒旋、螺旋、椭圆、透镜和不规则五种几何形态，宏观位置按 X/Y/Z 三个轴和常用斜视方向优化。位置固定在世界空间中，不会随视角重新排列；相同问题集合改变排序时，星系也会保留对应的位置。第一层以更宽松的间距利用画面，移除星系之间的装饰连线，保留文字与对应天体的短引导线。宏观视角增补均匀的细星尘与适度光度，旋臂更连续；进入第二层时平滑恢复原有近景光度。

恒星使用湛蓝、银白、紫辉、琥珀四种艺术风格，包含不同光球纹理、日冕、磁环与可选尘埃盘。同一篇回答在第二、三层使用一致的恒星外观。行星使用异质流体、岩质、气态、环状、冰质和熔岩等程序化表面，每类有不同配色；流体世界没有地球式海陆或极冠。

第二层保留少量低亮度彗星。第三层每次仅有一颗彗星沿外围划过，使用恒星系对应的稳定配色、柔和双层光带和少量星尘；进入后短暂延迟出现，随后间歇造访，飞行轨迹避开中央标题。星系会缓慢自转，回答恒星与旋臂使用同一变换；悬停或聚焦文字、输入、打开阅览窗口、拖动时，自动运动暂停，恢复后不跳跃。减少动态效果会关闭彗星并冻结自转、公转和恒星活动，手动拖动仍然有效。

形态设计参考用户提供的图片及 [NASA 星系分类](https://science.nasa.gov/universe/galaxies/types/) 与 [NASA 行星资料](https://science.nasa.gov/solar-system/planets/)，比例、色彩和轨道为阅读体验调整，不是天体物理数值模拟。移动端每页显示两条文字，桌面每页四条；其余天体仍可点击定位。

## 启动

Node.js 18.19+：

```bash
npm install
npm run dev
```

前端：<http://localhost:5188>；内容服务：3001。开发命令同时启动两者。5188 已被占用时先关闭本项目的旧开发进程，不会静默打开其他项目所在的端口。

生产运行：

```bash
npm run build
npm start
```

访问 <http://localhost:3001>。生产进程同时托管前端构建和 API，需要运行 TypeScript 的 `tsx` 依赖。

## 知乎接入

初次使用可将 `.env.example` 复制为 `.env`，在服务端配置：

```dotenv
ZHIHU_ACCESS_SECRET=你的实际凭证
ZHIHU_MODEL_ENABLED=false
PORT=3001
```

如果 `.env` 已存在，直接编辑对应配置，不要用模板覆盖已有凭证。

Access Secret 申请步骤依据工作区官方 skill：

1. 打开 <https://developer.zhihu.com/profile>。
2. 用知乎账号登录并完成页面验证。
3. 点击「申请新 Access Secret」，按页面提示获取凭证。
4. 将凭证填入服务端 `.env` 的 `ZHIHU_ACCESS_SECRET`。
5. 重启应用，打开右下角「内容与模型连接」查看配置状态，再输入一个问题进行检索。

凭证只在服务端读取，`.env` 已忽略并应保留在本机。不要使用 `VITE_` 前缀或把凭证放入浏览器、URL、代码仓库。无需安装知乎 CLI 才能运行本 Web 应用；这里根据 skill 的开发接入文档使用官方 HTTP API。

### 真实问题与多回答

输入问题时，应用调用官方 `zhihu_search`，把真实结果按知乎问题 ID 归组。进入某个问题后，再按该问题标题进行一次有缓存的检索，只补入归属匹配的回答，并保留作者、来源和赞同数。

同一问题 ID 优先；只有缺少问题 ID 的结果才允许按严格规范化标题归组。有其他明确问题 ID 的结果不会因标题相似被混入。接口返回多少真实回答就展示多少，不捏造作者或凑齐星星数量。知乎搜索每次最多返回 10 条结果，因此应用不声称列出了问题下的全部回答。

### 公开主题模式

未输入问题时，或没有配置搜索凭证时，应用提供 10 篇来自官方赛事接口的真实作品。它们按职场成长、学习注意力、人际心理等主题聚合，形成「主题 → 多篇原文 → 原文段落」。中央节点明确标注为**主题聚合**，不会冒充同一知乎问题的回答。

公开语料支持关键词搜索，零匹配时保持空结果。首次启动使用带来源与获取时间的本地快照，后台有频率限制地刷新；联网失败保留真实快照，不生成替代内容。

### 阅读边界

搜索 API 返回的是摘要；官方赛事知识 API 的正文也可能被截断。原文阅览窗口会标明「搜索摘要」或「正文节选」，并保留知乎原文 / 官方内容来源链接。应用不会将这些文本冒称为完整回答，也不会尝试用模型补写缺失内容。

## 小模型与段落筛选

不配置模型时也可实际使用：本地算法根据查询词、信息密度、段落长度和差异筛选原文片段，并抑制重复、问候语等低信息内容。每条片段都带原文段落索引。

可选两种模型接入方式：

**知乎直答快速模型**：已有有效知乎凭证时，在 `.env` 中设置：

```dotenv
ZHIHU_MODEL_ENABLED=true
```

使用官方 `zhida-fast-1p5`，通过同一 Access Secret 鉴权。只有进入文章时才请求片段选择；结果缓存，重复请求合并，不自动重试模型 POST。

**本地 / 兼容小模型**：在已运行的模型服务上选择实际安装的模型名称，例如 Ollama：

```dotenv
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_NAME=你的已安装模型名称
MODEL_API_KEY=
```

外部服务需要 HTTPS，按服务要求配置 `MODEL_API_KEY`；本机兼容服务可使用 HTTP。配置完整的兼容模型优先于知乎直答。本项目不会自动下载体积较大的模型。

模型只从提供的原文候选中选择片段；服务端校验候选编号与原文位置，最终文字来自原文。无效输出、超时或服务失败会明确提示并保留本地提取结果。模型标签如果存在，只是辅助组织，不是原作者写下的文字。模型配置与鉴权始终留在服务端。

兼容协议参考 [Ollama 官方文档](https://docs.ollama.com/api/openai-compatibility)。知乎直答协议见工作区 `REFERENCE/zhihu/references/http-api.md`。

## 操作

| 操作                    | 效果                          |
| ----------------------- | ----------------------------- |
| 滚轮向上 / 双指张开     | 向当前目标深入                |
| 滚轮向下 / 双指收拢     | 返回上一级尺度                |
| 拖动 / 单指滑动         | 调整三维视角                  |
| Shift + 拖动 / 右键拖动 | 平移视角                      |
| 点击星体                | 选择问题、回答或原文片段      |
| 双击星体 / 进入按钮     | 进入选定内容                  |
| 第三层点击中央文章标题  | 打开居中的原文阅览窗口        |
| E                       | 收藏 / 取消收藏当前问题或文章 |
| R                       | 对当前内容或选中段落写下思考  |
| F                       | 第三层打开 / 收起原文阅览     |
| V / W A S D / Shift     | 切换飞行 / 移动 / 加速        |
| Esc                     | 先关闭弹窗，再返回上一层      |
| /                       | 聚焦问题输入                  |

底部只保留返回、图谱、内容操作和视角工具。输入文字时不会误触探索快捷键。星尘文字特效支持「减少动态效果」；WebGL 不可用时仍可通过二维内容布局探索和阅读。

右上角播放按钮可开启 Hans Zimmer 的《Day One》循环背景音乐，点击旁边的小箭头调整音量或静音。首次进入与刷新后均由用户点击播放；音量和静音偏好保存在本机，切换纵深和打开文章时音乐连续播放。没有其他交互音效。

用户提供的原始音源已移入 `public/audio/day-one.flac`，并生成约 3.9 MiB 的 160 kbps MP3 `public/audio/day-one.mp3` 作为浏览器优先播放版本；保留 FLAC 作为备用。音乐在首次点击播放时加载，与应用一同本地提供。

收藏、思考与足迹保存在本机 `localStorage`；支持刷新恢复和 Markdown 导出，不提供跨设备同步。失效的历史结果会提示找不到原目标，不会偷偷跳到另一篇文章。

## 占星台 / 小屋接入

本仓库尚未提供已有占星台或小屋源码。星空入口支持 URL、自定义事件、同源消息和 JavaScript 调用，返回时携带收藏、思考与足迹。

URL：

```ts
location.assign(
  `/explore?q=${encodeURIComponent("大学生实习应该如何获取资源？")}&returnUrl=${encodeURIComponent("/observatory")}`,
);
```

`q` / `topic` 最长 160 字；生产服务对应用路由提供 SPA 回退。

等待 `wanderwise:ready` 后：

```ts
window.Wanderwise?.enter({
  query: "如何提高专注力？",
  returnUrl: "/observatory",
});

window.dispatchEvent(
  new CustomEvent("wanderwise:enter", {
    detail: { query: "如何提高专注力？", returnUrl: "/observatory" },
  }),
);
```

同源 iframe：

```ts
iframe.contentWindow?.postMessage(
  {
    type: "wanderwise:enter",
    payload: { query: "如何提高专注力？", returnUrl: "/observatory" },
  },
  location.origin,
);
```

在应用所在窗口监听返回：

```ts
window.addEventListener("wanderwise:return", (event) => {
  const { query, summary, returnedAt } = (event as CustomEvent).detail;
  // summary: collection、reflections、journey，交给已有小屋视图。
  event.preventDefault();
});
```

宿主可通过 `preventDefault()` 接管返回，否则应用跳转到验证后的同源相对 `returnUrl`。未提供返回入口时，展示本次收获和手记导出。

## API

| 路径                                                         | 作用                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `GET /api/health`                                            | 知乎配置状态、公开内容数、模型配置状态；不返回凭证 |
| `GET /api/explore?q=...`                                     | 初始问题集合或公开主题集合                         |
| `GET /api/questions/:questionId?q=...`                       | 按初始查询找到已知问题，按需展开真实回答           |
| `GET /api/answers/:answerId/highlights?q=...&questionId=...` | 为已知问题中的已知回答筛选原文片段                 |
| `GET /api/knowledge/:workId`                                 | 读取官方公开内容的作者与正文节选                   |

缓存和并发上限控制外部请求；搜索限流、鉴权失败及空内容会如实返回。模型端点由服务端配置，不接受浏览器传入任意地址。

## 验证

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定本机 Chromium，`PLAYWRIGHT_BASE_URL` 指向已启动的应用。测试覆盖真实身份归组、多回答补充与缓存、来源片段校验、模型异常、本地持久化、接入协议和浏览器探索流程。自动化搜索场景使用明确的测试数据，避免测试反复消耗生产凭证额度。

核心文件：

- `src/components/GalaxyScene.tsx`：三维星空、三层内容布局和交互。
- `src/components/space/`：体积布局、星系形态、多样化恒星与行星、彗星、世界坐标投影及文字避让。
- `src/components/StellarText.tsx`：文字星尘聚合 / 消散。
- `src/components/ReadingRoom.tsx`：居中原文阅读。
- `src/App.tsx`：检索、异步内容展开、行囊、思考和连接状态。
- `server/zhihu.ts`：知乎搜索、严格归组与公开主题语料。
- `server/highlights.ts`：原文筛选与可选模型接入。
- `src/lib/`：持久化、Markdown 导出与占星台协议。

参考项目、字体、内容来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
