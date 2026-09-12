# 第三方来源与署名

## WikiGalaxy 参考资料

WikiGalaxy 由 Owen Cornec 创作。工作区 `REFERENCE/WikiGalaxy` 是用户提供的参考源码，保留其原始版权声明及许可证。

原始 README 和 `LICENSE.md` 提到 GPL v3；部分脚本头部声明 AGPL v3 或更新版本。此处如实保留该差异，不替作者重新解释或替换许可证。

Wanderwise 的 `src/components/GalaxyScene.tsx` 是独立编写的现代 Three.js 实现，参考其知识粒子星海、分层探索、轨道与飞行的设计概念。应用运行和构建不导入、复制或分发参考目录中的旧版脚本、纹理、文章数据或其他资产。

设计文档所引用的 Webverse 归档地址：<https://web.archive.org/web/20210723135642/http://webverse.org/>。本次归档页无法正常访问，因此未声称进行了原站像素级比对。

## 知乎内容

接口规范来自工作区 `REFERENCE/zhihu` 官方 skill 配套文档。`server/data/zhihu-public.json` 记录真实官方公共知识接口的内容快照、来源 URL 与获取时间。

内容版权归原作者及相应权利人所有。作者随每篇作品呈现；正文或摘要不会标注为 Wanderwise 或用户创作。知乎赛事接口的内容和可用性受赛事及平台规则约束。

## 字体

- Noto Sans SC：Google / Adobe，SIL Open Font License 1.1。许可证随文件位于 `public/fonts/OFL-NotoSansSC.txt`。
- DM Sans：项目字体作者，SIL Open Font License 1.1。许可证位于 `public/fonts/OFL-DMSans.txt`。

字体通过 Google Fonts 获取并转换为 WOFF2；中文首屏使用相同字体的字形子集，其他内容回退到完整字体。字体未作为单独收费产品提供。

## 主要开源依赖

- React / React DOM：MIT。
- Three.js：MIT。
- Vite：MIT。
- Express：MIT。
- Lucide：ISC。
- Playwright：Apache-2.0。

依赖的准确版本锁定在 `package-lock.json`，完整版权声明随对应 npm 包提供。
