# Recast

把视频内容整理成可核对原文的中文文章。支持真实流式生成、章节级5W1H、字幕差异校对与火山辅助识别。

**线上验收地址：[recast-xvc.mixuechu.workers.dev](https://recast-xvc.mixuechu.workers.dev)**，已按用户授权部署至 Cloudflare Worker，访问码由项目维护者提供。当前主模型为智谱 GLM-4.7；Gemini 适配器保留，但需要向出题方说明模型差异。

## 启动

需要 Node.js 22.12+（本次使用24）。

```sh
npm ci
cp .dev.vars.example .dev.vars  # 已有本地配置时不要覆盖
# 在 .dev.vars 中填写密钥
npm run dev
```

打开终端的 Local 地址，默认 `http://localhost:8787`。前端修改后需 `npm run build` 并刷新；修改密钥后需重启。密钥仅在服务端，`.dev.vars`、本地存储和测试运行记录均不提交。

本地体验音频上传请使用 `npm run dev:asr`（需要官方 `cloudflared`，本机已有）；它仅临时开放带随机令牌的音频下载，不开放网页和管理API。

- [完整使用说明](docs/USAGE.md)
- [架构与代码走读](docs/ARCHITECTURE.md)
- [当前版本验收记录](docs/VALIDATION.md)
- [第一版历史验证记录](VALIDATION.md)

线上音轨存储已接入 mxc-new 的独立 HTTPS 音频服务，修复火山无法下载 `workers.dev` 音频的问题。上传、真实ASR、字幕校对、生成新版与删除清理已通过线上实测。部署细节见 [音频服务说明](deploy/media-gateway/README.md)。

## 真实示例与来源

首页示例是 MIT OCW 的 [What is Computation?](https://www.youtube.com/watch?v=nykOeWgQcHM)，讲者 Dr. Ana Bell。它与其他视频使用相同的字幕获取流程，不再自动替换成发布方字幕或本地快照。

线上已配置 `SUPADATA_API_KEY`，使用 [Supadata 的 native 模式](https://docs.supadata.ai/get-transcript)获取视频现有字幕，不触发音频转录。未配置时保留直接读取适配器，但 Cloudflare 出口可能被 YouTube 拒绝。已在 Cloudflare 实测四个公开视频的字幕读取，并完成 3Blue1Brown 视频的文章、原文引用与章节5W1H链路；这些样本通过不代表所有视频均可读取。成功字幕按视频与服务缓存24小时，同视频并发合并；失败不缓存。

获取失败时可以导入 SRT、VTT 或纯文本。原创合成示例仍有明确标记，不冒充真实视频。MIT真实音频测试片段采用CC BY-NC-SA 4.0，来源与处理见 [音频说明](tests/fixtures/MEDIA-LICENSE.md)。

## 核心实现

- **字幕获取**：`TranscriptCache` 负责24小时缓存与并发合并，`supadata.ts` / `youtube.ts` 隔离读取方式。字幕毫秒统一转换为秒，未知轨道类型不冒充人工字幕；来源与读取方式随文章保存。
- **流式文章**：以 Fetch 调用智谱 Chat Completions 或 Gemini REST；解析UTF-8分片与SSE，以类型明确的事件发送状态、增量和完成结果。前端流式渲染Markdown，通过DOMPurify清洗HTML。
- **用户要求**：任务、风格、受众与约束作为独立数据传给模型；提示词要求忠于字幕、区分观点和事实。单人讲座不捏造主持人与问答。篇幅要求由模型遵循，并非硬性字数保证。
- **原文溯源**：每段字幕有稳定编号。文章和5W1H引用真实编号，点击可查看原文与时间点；服务器验证引用存在性，不宣称已自动证明结论正确。
- **章节5W1H**：前端只提交章节ID。服务端读取本次完整字幕、文章和章节；输出六个带文本、引用及“有依据/未提及”状态的字段，验证后固定格式渲染。结果缓存，同章并发合并。
- **字幕校对**：将不同切句的字幕按重叠时间区间分组，不重复复制ASR长句；提示数字、否定表达与文本差异。人工确认或修订后，使用版本号保存，生成独立新文章。
- **火山识别**：公网音频URL提交异步任务，状态持久化，通过Durable Object alarm查询；不是依赖浏览器持续开着的假进度。支持上传对应音频（24 MB以内）、1小时临时保存和片段回听；YouTube音频自动下载及转码不在本轮范围。
- **持久化与边界**：每次生成独立的SQLite Durable Object，保存24小时；包含检查点、取消、过期清理、访问码、请求大小与频率限制。随机会话ID是读取该记录的凭据，不是账号认证。

## 检查与实测

```sh
npm run format:check
npm run check
npm test
npm run build
npx wrangler deploy --dry-run
```

运行本地服务后，可执行真实服务验证，注意会产生模型与ASR用量：

```sh
node scripts/live-validation.mjs  # 完整真实视频、总结、缓存、校对与新版本
TEST_ASR_AUDIO_URL='https://你的可访问存储/mit-lecture-90s.mp3' TEST_BASE_URL=http://localhost:8788 node scripts/live-asr.mjs  # 真实90秒MIT音频，需准备服务商可下载地址
TEST_BASE_URL=http://localhost:8788 node scripts/live-upload.mjs # 完整上传、真实ASR、修订文章与删除清理
node tests/smoke.mjs  # 真实流式、停止、保留部分内容、删除等边界
```

真实验证结果写入被忽略的 `work/`。它们包含临时会话凭据，不应上传。CI执行不含真实密钥的检查与部署dry-run，不发布网站。

## 部署与更新

已部署的站点使用SQLite Durable Objects与Cloudflare Secrets。更新方式：

```sh
npx wrangler login
npx wrangler secret put SUPADATA_API_KEY  # 推荐的已有字幕读取服务
npx wrangler secret put ZHIPU_API_KEY
npx wrangler secret put VOLC_ASR_API_KEY
npx wrangler secret put APP_ACCESS_TOKEN  # 公开评审的共享访问码
npx wrangler secret put MEDIA_GATEWAY_URL
npx wrangler secret put MEDIA_GATEWAY_SECRET
npm run deploy
```

`wrangler.jsonc` 包含静态资产、会话、字幕缓存和限流对象的SQLite迁移。`VOLC_ASR_RESOURCE_ID` 默认 `volc.seedasr.auc`。模型名称与厂商通过 `AI_MODEL` / `AI_PROVIDER` 配置；切换Gemini需配置 `GEMINI_API_KEY`。Gemini尚未进行真实账号联调，线上持久化与字幕出口可用性也需部署后验证。

## 外部接口参考

- [智谱流式](https://docs.bigmodel.cn/cn/guide/capabilities/streaming)与[结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)
- [火山任务提交](https://docs.volcengine.com/docs/doubao-voice/task-submission-http-1?lang=zh)与[结果查询](https://docs.volcengine.com/docs/doubao-voice/result-query-http-1?lang=zh)
- [Gemini生成接口](https://ai.google.dev/api/generate-content)
- [Cloudflare Durable Objects存储](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
