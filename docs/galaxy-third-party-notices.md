# 星系第三方来源与署名

## Wanderwise 上游

星系前端与相关格式处理来源于 [Wood3307/Wanderwise](https://github.com/Wood3307/Wanderwise)，当前锁定 [`f7cea25dfaf937a34940fa64965f56352733c601`](https://github.com/Wood3307/Wanderwise/commit/f7cea25dfaf937a34940fa64965f56352733c601)（星空第八版）。原作者署名、仓库内版权与第三方说明继续适用；本项目不为上游源码另行宣称新许可证。

下列来源说明基于该提交中的 README、THIRD_PARTY_NOTICES.md 和随附许可证。资源路径已适配为本项目的 `/galaxy/` 命名空间。

## WikiGalaxy 参考资料

WikiGalaxy 由 Owen Cornec 创作。按上游记录，`REFERENCE/WikiGalaxy` 是用户提供的参考源码，原始 README 和 LICENSE.md 提到 GPL v3，部分脚本头部声明 AGPL v3 或更新版本。此处保留该差异，不替作者重新解释或替换许可证。

上游将 GalaxyScene 描述为独立编写的现代 Three.js 实现，借鉴知识粒子星海、分层探索、轨道与飞行的设计概念。本项目不将参考目录中的旧版脚本、纹理或文章数据加入运行构建。

上游设计文档引用 [Webverse 归档](https://web.archive.org/web/20210723135642/http://webverse.org/)；本轮没有重新验证该归档页，不声称进行了原站像素级比对。

## 知乎内容

接口规范来自官方 API/skill 文档。`server/galaxy/data/zhihu-public.json` 保存真实官方公共知识接口快照、来源 URL 与获取时间；现有公共 SQLite 内容库保存官方检索摘要。个人收藏来源另见[本批内容记录](design/zhihu-collection-20260914.md)。

内容版权归原作者及相应权利人。界面保留作者、原文入口与摘要/节选标识，不把他人内容标成项目或玩家创作。知乎赛事接口的内容与可用性受赛事及平台规则约束。

## 宇宙背景

按上游记录，`public/galaxy/textures/cosmic-observatory-v3.webp` 由 image_gen.imagegen 生成，用户提供的三张宇宙图片作为题材、色彩和氛围参考，没有直接复制到应用中。提示词和压缩记录见该提交的 [COSMIC_ART_DIRECTION.md](https://github.com/Wood3307/Wanderwise/blob/43094bdf13282e963baa80510f7bf6de074b2af8/docs/COSMIC_ART_DIRECTION.md)。本轮沿用此背景，不宣称重新生成。

平行宇宙的 `public/galaxy/textures/parallel-pillars.jpg` 来自 ESA/Hubble 的 [New view of the Pillars of Creation — visible](https://esahubble.org/images/heic1501a/)，完整署名为 **NASA, ESA/Hubble and the Hubble Heritage Team**。按 [CC BY 4.0 与发布方条款](https://esahubble.org/copyright/)使用，界面保留可见署名；源 JPEG 未修改，仅通过 CSS 压暗和裁切展示。出处见 [背景说明](galaxy-parallel-background.md)。

## 字体资源

- Noto Sans SC：Google / Adobe，SIL Open Font License 1.1。随附许可证：`public/galaxy/fonts/OFL-NotoSansSC.txt`；宿主 CSS family 为 `Wanderwise Galaxy CJK`。
- DM Sans：项目字体作者，SIL Open Font License 1.1。随附许可证：`public/galaxy/fonts/OFL-DMSans.txt`；宿主 CSS family 为 `Wanderwise Galaxy Sans`。
- 朱雀仿宋（Zhuque Fangsong）v0.212：璇玑造字 / Zhejiang JadeFoci Technology，SIL Open Font License 1.1。上游来源为[作者官方发布](https://github.com/TrionesType/zhuque/releases/tag/v0.212)；随附许可证：`public/galaxy/fonts/OFL-ZhuqueFangsong.txt`。本地提供 `zhuque-fangsong.woff2` 和 `zhuque-fangsong-initial.woff2`，CSS family 为 `Wanderwise Galaxy Fangsong`。这是运行时 family 命名隔离，不代表本项目创作或重绘了字形。西文及部分符号源于同为 OFL 的 Alegreya，详见[字体作者说明](https://github.com/TrionesType/zhuque)。

按上游说明，Noto Sans SC 与 DM Sans 通过 Google Fonts 获取并转换为 WOFF2；朱雀仿宋使用完整字体与首屏字形子集，未修改字形。字体不作为单独收费产品提供。数学公式使用 KaTeX 字体，保留包内许可证。

## 背景音乐

本轮沿用上游 Hans Zimmer《Day One》音源。上游 README 说明原始音源由用户提供，保存为 `public/audio/day-one.flac`，并生成约 3.9 MiB、160 kbps 的 MP3 浏览器播放版本；本项目对应路径为 `public/galaxy/audio/day-one.flac` 和 `public/galaxy/audio/day-one.mp3`。

上游没有将这段音乐声明为 CC0 素材，也没有随代码提供额外使用授权。本轮仅保留上游已提供文件与来源说明，尚未进行使用授权扩展；本文不声明已获得公开传播或商业使用的新授权。静音与播放偏好属于产品行为，不能替代音源的版权与授权说明。

## 主要开源依赖

- React / React DOM：MIT。
- Three.js：MIT。
- Vite：MIT。
- Express：MIT。
- Lucide：ISC。
- Playwright（上游测试工具）：Apache-2.0。
- markdown-it：MIT。
- KaTeX：MIT；自带数学字体按包内许可证分发。

宿主实际依赖版本以 `package-lock.json` 为准，完整声明随 npm 包保留。Markdown 与公式排版使用本地模块和字体，不由此引入第三方 CDN。
