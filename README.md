# Recast

把 YouTube 视频字幕整理成按主题分章的中文对话文章，实时流式展示；每章可基于服务端保存的完整上下文生成结构化 5W1H。

> 当前版本使用智谱 GLM-4.7，与题目指定的 Gemini 有差异，提交前需向出题方说明。Gemini 适配代码已实现，但尚未使用真实 Gemini 密钥联调。此项目是面试作业的开发版本，并非生产 SaaS。

## 本地运行

需要 Node.js 22.12+（本次验证使用 Node.js 24）。

```sh
npm ci
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写 ZHIPU_API_KEY，仅在本机编辑，不要提交
npm run dev
```

打开终端输出的 `http://localhost:8787`。`npm run dev` 会构建前端并启动本地 Worker 与 Durable Objects。修改前端后运行 `npm run build`，刷新页面；Worker 代码修改会自动重载。请求生成期间不要重建服务，否则连接会中断。

本地 `.wrangler/state` 保存 Durable Objects 数据。文章及字幕默认保留 24 小时，到期由 alarm 清理；页面提供删除入口。最近文章列表只在浏览器保存记录标识和标题，正文与字幕保存在服务端。

## 部署到 Cloudflare Workers

```sh
npx wrangler login
npx wrangler secret put ZHIPU_API_KEY
# 可选：给公开演示添加共享访问码，页面会自动显示访问码输入框
npx wrangler secret put APP_ACCESS_TOKEN
npm run deploy
```

`wrangler.jsonc` 声明同一个 Worker 的静态资产和两个 SQLite-backed Durable Object 类。首次部署自动应用 `v1` 迁移，无需手动创建数据库。部署需要有效 Cloudflare 账号及对应权限；本次环境未登录，尚未获得公开部署网址。Cloudflare 与模型可能产生费用，具体以账户套餐和账单为准。

当前模型设为 `glm-4.7`。免费 `glm-4.7-flash` 在本次联调中返回访问繁忙（错误码 1305），因此没有把它作为默认模型；可在 `wrangler.jsonc` 中修改 `AI_MODEL`。系统不会在失败时偷偷切换其他计费模型。

切换 Gemini：将 `AI_PROVIDER` 改为 `gemini`，将 `AI_MODEL` 改为你的账户可用模型，例如 `gemini-2.5-flash`，并配置 `GEMINI_API_KEY` secret。本地则在 `.dev.vars` 配置对应密钥。适配器使用 Gemini REST `streamGenerateContent?alt=sse`。

## 功能与流程

1. **输入**：YouTube watch、youtu.be、shorts、embed、live 链接；也可以粘贴字幕。只接受明确的 YouTube 域名和 11 位视频 ID，不对用户提供的任意 URL 发起请求。
2. **获取字幕**：`youtube-transcript-plus` 通过 YouTube 页面/播放器接口发现字幕轨道，再获取 timedtext，保留秒级时间戳并解码实体。语言由库默认选择。限制 100,000 字与 30 秒获取时间，不静默截断。
3. **失败恢复**：字幕不可用、访问限制或验证码时，明确说明并提供粘贴字幕或示例入口。不绕过验证码，不在失败后悄悄替换字幕。未配置代理；Cloudflare 出口也可能被 YouTube 限制，这是当前版本的已知局限。
4. **内置素材**：`src/server/sample.ts` 提供一份原创示例访谈，明确标注“不是指定视频字幕”。它用于稳定验证完整流程，不冒充题目参考视频的逐字字幕。正式提交前，建议用合法获取的真实视频字幕补充固定 fixture。
5. **生成文章**：服务端以 Fetch 调用智谱 Chat Completions，设置 `stream: true`，解析 SSE 中的 `delta.content`。只向浏览器发送正文，不展示 reasoning。流式协议处理 UTF-8 跨分片、CRLF、多行 data 和尾事件；检测提前断流、长度截断及上游异常。
6. **即时阅读**：前端接收事件后逐段更新 Markdown，由 `marked` 解析、DOMPurify 清洗后渲染 HTML。使用 `##` 切分章节，章节序号生成稳定 ID，重名章节也能独立总结。正在生成时禁用章节总结。
7. **用户要求**：任务类型、风格、受众与内容/篇幅约束作为单独数据字段送入模型。系统提示词要求忠实于字幕，保留观点和不确定性，约束不得覆盖事实忠实性与章节结构。要求来自提示词引导，不承诺数学意义上的严格字数保证；不额外发起一次要求解析请求，降低延迟和成本。
8. **5W1H**：浏览器只发送 `chapterId`。Durable Object 读取本次字幕、文章和当前章节，启用 JSON 输出模式；服务端校验六个非空字符串字段，前端固定格式渲染。未明确的信息要求标记为“未明确提及”。结果持久缓存，同一章节并发请求合并，最多同时生成两个章节总结。

## 服务端接口

生成记录 ID 是随机 256 位 capability，仅保存在当前浏览器，不放进页面 URL、外链或 Referer。知道 ID 的人可以读取/删除这条记录；这是短期面试演示的权限设计，不等同于用户账号认证。不要把记录 ID 分享给他人。可使用共享访问码限制整站 API。

| 接口                             | 内容                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/config`                | 模型名称、是否已配置密钥、是否需要访问码；不返回密钥                                                                   |
| `POST /api/generate`             | `{mode, url?, transcript?, requirements}`；SSE 事件 `session / status / source / delta / done / error`，另有 heartbeat |
| `GET /api/sessions/:id`          | 恢复文章与已缓存总结；不向客户端返回完整字幕                                                                           |
| `POST /api/sessions/:id/summary` | **仅需** `{chapterId}`，服务端加载上下文                                                                               |
| `POST /api/sessions/:id/cancel`  | 停止本次生成，保留已生成部分                                                                                           |
| `DELETE /api/sessions/:id`       | 删除记录与相关字幕、总结                                                                                               |

## 主要工程取舍

- **同源 Worker + 静态资产**：前后端同域，避免跨域配置；密钥仅留服务端。CSP 限制脚本来源，Markdown 清洗拒绝可执行 HTML 与媒体标签。
- **SQLite Durable Objects**：每次生成一个对象，用持久存储承载完整上下文。比进程内 Map 或前端重传正文更可靠；为 24 小时任务设置过期清理。生成每两秒保存检查点，进程异常退出可恢复已保存部分，但不能无缝续写。
- **真实流式，不模拟打字**：直接转发模型增量，遇到异常显示错误并保留正文。180 秒总超时、显式停止接口、断流检测，不自动重试已开始输出的请求，避免重复计费与内容拼接。
- **成本控制**：100,000 字输入上限、10,000 输出 token 上限、每 IP 每小时 12 次生成、总结缓存与并发合并。IP 限流不是完善的反滥用系统；公开评审建议开启访问码。未实现全站总预算或分布式攻击防护。
- **有限抽象**：模型适配、字幕、SSE、会话存储、共享结构和 UI 分离。无需模型 SDK，两个适配器共用增量文本接口。
- **阅读体验**：目录锚点、逐章总结、Markdown 下载/复制、最近文章恢复、移动端素材抽屉、原生 dialog 焦点限制与 Escape 关闭、减少动画偏好。
- **事实边界**：视频来源展示原视频链接；只允许使用已有字幕时间生成跳转链接。但时间引用仍由模型生成，尚未做逐条机器校验，不能当作事实证明。

## 文件结构

```text
src/
  shared.ts             # 类型、链接校验、章节解析、总结校验
  server/
    index.ts            # Worker 路由、会话 Durable Object、限流
    ai.ts               # 智谱 / Gemini 适配与编辑提示词
    transcript.ts       # 字幕获取与预处理
    sample.ts           # 明确标注的原创示例
    sse.ts              # 共享 SSE 解析
  client/
    main.tsx            # 工作台布局
    useWorkbench.ts     # 生成、恢复、总结与抽屉状态
    SourcePanel.tsx     # 素材与生成要求
    ArticleReader.tsx   # 流式阅读与目录
    SummaryDialog.tsx   # 结构化六维总结
    Markdown.tsx        # 清洗与安全渲染
    style.css           # 响应式阅读布局
```

## 验证

```sh
npm run format:check
npm run check
npm test
npm run build
npx wrangler deploy --dry-run
```

运行本地服务后，可额外执行 `node tests/smoke.mjs` 验证真实生成的取消、部分内容保留与删除。此测试会调用当前配置的模型，可能产生少量模型用量。

单元测试覆盖安全链接、重复章节标题、总结校验、输入长度、UTF-8/CRLF 分片、异常断流、错误脱敏及两个模型适配器。GitHub Actions 对每次 push/PR 执行这些检查，不含真实模型密钥。

浏览器与真实请求验证结果见 `VALIDATION.md`。Gemini、真实 Cloudflare 线上持久化与不同网络下的字幕成功率仍需上线后验证。

## 参考

- [智谱流式消息](https://docs.bigmodel.cn/cn/guide/capabilities/streaming)
- [智谱结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)
- [Gemini Generate Content API](https://ai.google.dev/api/generate-content)
- [Cloudflare 静态资产绑定](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Durable Objects 存储](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [youtube-transcript-plus](https://www.npmjs.com/package/youtube-transcript-plus)
