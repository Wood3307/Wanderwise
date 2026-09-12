# 知乎公开知识快照

`zhihu-public.json` 是在开发期间直接从知乎官方黑客松内容 API 获取的真实响应，保留了未知字段、作者和来源。获取时间见文件内 `fetchedAt`。内容归原作者及知乎所有；应用不声称原创。

来源：`https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list` 及列表返回的 10 个 `/knowledge/{work_id}` 详情地址。参考协议见 `REFERENCE/zhihu/references/hackathon-content-api.md`。

这些接口仅供本次黑客松，当前详情大多在 3000 字处截断；界面统一标注为正文节选，不能当作完整回答。公开 API 的作品没有问题下多个回答的关系，因此每篇作品在浏览中对应一个独立知识节点，不伪造问答归属。

此快照使首次启动和断网浏览可用。服务启动及探索时会在后台进行有频率限制的公开内容刷新，成功后使用内存中的最新真实内容；接口失效时保留已有快照。查询只匹配实际内容，无匹配时返回空结果。
