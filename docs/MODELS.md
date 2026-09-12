# 精华段落与小模型接入

第三层星空展示的是原文中的片段。默认提取器按查询词、标题、信息量和段落差异选择最多 6 段，排除重复内容与常见推广文案；短文章有几段就展示几段。它可以离线工作，不会把这种规则提取标记为模型生成。

配置模型后，进入文章会请求服务端选择精华。模型只选择已经编号的原文段落，不能生成引用文本。服务端校验编号、数量、重复项与响应结构后，从原文取出对应片段。点击片段可定位阅读内容并记录思考。

## 使用知乎直答快速模型

在项目根目录 `.env` 中设置：

```dotenv
ZHIHU_ACCESS_SECRET=你的知乎开放平台AccessSecret
ZHIHU_MODEL_ENABLED=true
```

重启服务后，文章精华选择会使用 `zhida-fast-1p5`。知乎搜索和直答共用服务端密钥，但直答需要单独启用；只配置搜索密钥不会自动调用模型。实际能否使用直答取决于账号授权和剩余额度。

实现遵循工作区的[直答 API 文档](../REFERENCE/zhihu/references/http-api.md)：请求 `https://developer.zhihu.com/v1/chat/completions`，使用 Bearer 密钥和秒级 `X-Request-Timestamp`，请求体仅传 `model`、`messages`、`stream` 三个正式支持字段。

## 使用本机已安装的小模型

如果本机已经运行 Ollama，可先用 `ollama list` 查看已安装模型，将输出中的准确模型名填入配置：

```dotenv
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_NAME=此处填写ollama-list中的模型名
```

这里没有预置或自动下载模型。模型需要能够按指令返回 JSON；不满足结构要求时，页面会继续使用可靠的原文提取结果。Ollama 的端口与聊天接口见其[官方兼容接口文档](https://docs.ollama.com/api/openai-compatibility)。

也支持部署者提供的 HTTPS 聊天接口：

```dotenv
MODEL_BASE_URL=https://你的模型服务地址/v1
MODEL_NAME=你的服务支持的模型名
MODEL_API_KEY=你的模型服务密钥
```

`MODEL_BASE_URL` 和 `MODEL_NAME` 同时提供时优先使用该模型，覆盖知乎直答配置。`MODEL_API_KEY` 对无鉴权的本机服务可省略。地址可写为 `/v1` 基础路径或完整的 `/chat/completions` 地址；根路径会补全为 `/v1/chat/completions`。HTTP 仅支持本机 `localhost`、`127.0.0.1`、`[::1]`，其他地址必须使用 HTTPS。

## 状态与降级

`GET /api/health` 的 `model` 字段报告配置状态，例如：

```json
{"configured":true,"provider":"zhihu","name":"zhida-fast-1p5"}
```

`configured` 表示服务端配置完整，不代表连接探测成功。一次文章精华请求的 `method` 才说明本次实际使用了 `model` 还是 `extractive`；调用失败时 `notice` 会说明超时、额度限制、连接失败或原文校验失败，且不会泄露上游响应或密钥。

每次模型请求最多发送 48 个候选原文片段、总计 12,000 个原文字符，以及最多 160 字的查询和 400 字的标题。已配置的外部模型会收到这些内容。精华引用始终来自接口实际提供的内容；知乎只提供摘要或节选时，模型也无法补全全文。

服务端最多同时执行 2 个模型请求，15 秒超时；不会自动重试 POST。相同文章内容、标题、查询和模型配置共享进行中的请求，并缓存成功结果 5 分钟；失败结果短暂缓存 10 秒以避免连续重复调用。浏览器不能通过请求参数指定模型地址或密钥。

验证命令：

```bash
npx tsx --test server/highlights.test.ts
```

测试覆盖真实本机 HTTP 请求、知乎请求格式、原文对应关系、无效编号和伪造文字拒绝、缓存隔离、并发上限、超时与响应大小限制。它们使用本机测试服务或模拟响应，不消耗真实模型额度。
