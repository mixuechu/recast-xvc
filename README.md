# Recast

输入带字幕的 YouTube 视频链接，将内容实时整理成中文文章；可指定任务、风格、受众和约束，按章节生成 5W1H，并逐段核对原文。

- [在线体验](https://recast-xvc.mixuechu.workers.dev)（访问码由维护者单独提供）
- [使用说明](docs/USAGE.md) · [架构与代码走读](docs/ARCHITECTURE.md) · [实测记录](docs/VALIDATION.md)

当前默认使用 **DeepSeek `deepseek-flash`**。Gemini与智谱的完整接入以独立Provider类保留，未启用，不会在失败时自动切换厂商。题目指定Gemini的模型差异仍保留说明，历史验收与限制见[实测记录](docs/VALIDATION.md)及[Gemini诊断](docs/GEMINI_DIAGNOSTIC.md)。密钥只在服务端。

## 启动与部署

需要 Node.js 22.12+。

```sh
npm ci
cp .dev.vars.example .dev.vars  # 已有配置时不要覆盖
# 填写 SUPADATA_API_KEY、DEEPSEEK_API_KEY；公开部署可设置 APP_ACCESS_TOKEN
npm run dev
```

默认本地地址 `http://localhost:8787`。密钥只在服务端，修改后重启；不要提交 `.dev.vars`。公开站点云端托管，无需本机持续运行。

```sh
npx wrangler login
npx wrangler secret put SUPADATA_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
# 可保留 GEMINI_API_KEY 和 ZHIPU_API_KEY，用于测试备用厂商
npx wrangler secret put APP_ACCESS_TOKEN
npm run deploy
```

默认配置为 `AI_PROVIDER=deepseek`、`AI_MODEL=deepseek-flash`。Gemini测试配置为 `AI_PROVIDER=gemini`、`AI_MODEL=gemini-3.6-flash`、`GEMINI_API_KEY`，通过完整验收后才切换默认；模型列表可读或短请求成功，不等于完整生成可用。

## 实现说明

**YouTube 字幕。** 服务端优先使用 [Supadata](https://docs.supadata.ai/get-transcript) 的 `native` 模式，只读取视频已有字幕；优先选择英文字幕（无英文时由服务返回可用字幕，并显示实际语言），统一转换毫秒时间轴、分配稳定片段编号、视频字幕限制为150,000字符及6,000片段，手动输入限制为100,000字符。不自动触发音频转录。成功结果按视频缓存24小时，同视频并发合并，失败不缓存。未配置此服务时保留直接读取适配器，但 YouTube 可能拒绝 Cloudflare 出口。可手动导入 SRT、VTT 或文本；不把演示素材或快照冒充目标视频的实时结果。

**模型与流式。** `server/ai.ts` 通过 `createProvider(env)` 创建选中的 `AIProvider` 对象。`DeepSeekProvider`、`GeminiProvider`、`ZhipuProvider` 分别封装对应厂商的流式和JSON接口。DeepSeek与智谱共享Chat Completions协议；Gemini使用 `interactions?alt=sse`（`store=false`，会话由本应用管理）。协议层统一处理UTF-8分片、增量与结束状态，Worker将真实增量传给浏览器，Markdown经DOMPurify清洗后渲染，支持停止、断流提示和部分内容保留。

**生成要求。** 用户要求作为独立数据传入模型，影响任务、风格、受众、篇幅与重点，不能覆盖事实忠实性。多人素材保留对话，单人讲述不虚构问答。明确章节数量通过纯函数重组已有段落，避免再次调用模型重写；事实质量仍需人工核对。

**章节 5W1H。** 每次生成的字幕、文章与章节保存在独立 SQLite Durable Object。浏览器只提交 `chapterId`；服务器结合完整字幕和当前章节生成六个结构化字段，检查引用编号，缺失的信息显示“未明确提及”。同章结果缓存、并发合并，以固定格式展示。

**工程取舍。** 交付聚焦题目核心，移除 ASR、音频上传、回听、字幕比较和修订分支。网络适配、纯函数、流式协议、持久化和界面各自独立。会话保存24小时并自动过期；API有访问码、同源检查、大小与频率限制。随机会话ID不是账号体系。原文编号可验证存在性，不能据此声称自动证明每个结论正确。Supadata 是外部依赖，额度与服务可用性需持续留意。

## 验证

```sh
npm run format:check
npm run check
npm test
npm run build
npx wrangler deploy --dry-run
```

真实服务测试会产生字幕与模型用量，结果写入被忽略的 `work/`：

```sh
TEST_BASE_URL=http://localhost:8787 TEST_ACCESS_CODE=你的访问码 node scripts/live-validation.mjs
TEST_BASE_URL=http://localhost:8787 TEST_ACCESS_CODE=你的访问码 node tests/smoke.mjs
```

CI执行不含真实密钥的检查与部署 dry-run，不自动发布网站。真实服务样本、通过范围和未验证事项见[验收记录](docs/VALIDATION.md)。

## 篇幅控制

明确的总篇幅要求由程序验收：约1500字按1350–1650字验收，1500字以内作为硬上限，1000–1500字按范围验收。仅解析明确的全文篇幅；单个标题、每章或每段的字数仍作为模型指令。页面与服务端使用同一可读字符统计，包含标题、讲者名、标点、英文字母和数字，不含空白、Markdown语法和原文引用链接。

初稿不达标时，最多进行三轮按章的结构化段落编辑，并根据实际计数校准写作预算。模型只返回段落编号与正文；程序保留标题、章节、讲者、顺序和原文链接，允许省略次要整段，不截断句子。最终字数、结构与引用验证通过才标为完成。初稿生成完整后保存整理检查点；编辑或引用核对中断时，可点击“继续整理”，复用服务端素材与原稿，不重新读取字幕或重写初稿。引用分批核对并保存进度；模型失败仍可能需要重新整理，不能据此承诺语义无误。

质量版实测：原题长访谈主动停止后从同一会话恢复，最终1506字、四章、对话与40条有效引用；正式站点另一段神经网络课程得到1028字、三章、39条有效引用。5W1H与缓存通过。结构化总结校验失败时最多补试一次，上游限流和网络错误不自动重试；详细过程与失败边界见[验证记录](docs/VALIDATION.md)。

模型切换只需更改服务端 `AI_PROVIDER` / `AI_MODEL` 并配置对应密钥：`deepseek` / `deepseek-flash` / `DEEPSEEK_API_KEY`；`zhipu` / `glm-4.7` / `ZHIPU_API_KEY`；`gemini` / 账户可用模型 / `GEMINI_API_KEY`。不会在缺少当前厂商密钥时偷偷切到另一家。
