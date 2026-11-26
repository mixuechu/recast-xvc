# 架构与代码走读

```mermaid
flowchart LR
  A[视频链接与可选要求] --> B[Worker: 校验与限流]
  B --> C[字幕缓存 DO]
  C --> D[Supadata / 直接读取适配]
  B --> E[文章会话 DO]
  E --> F[模型流式接口]
  F --> G[实时 Markdown 阅读]
  G --> H[chapterId]
  H --> E
  E --> I[服务端上下文生成 5W1H]
```

## 模块与走读顺序

| 顺序 | 文件                                                       | 职责                                   |
| ---- | ---------------------------------------------------------- | -------------------------------------- |
| 1    | `src/shared.ts`                                            | 来源、文章、结构化总结与流事件契约     |
| 2    | `src/client/SourcePanel.tsx`、`useWorkbench.ts`            | 输入、增量展示、取消、恢复与导出       |
| 3    | `src/server/index.ts`                                      | 同源、访问码、请求边界与路由           |
| 4    | `src/server/transcript.ts`、`TranscriptCache.ts`           | 素材入口、每视频缓存、并发合并         |
| 5    | `src/server/supadata.ts`、`youtube.ts`                     | 网络适配、错误、来源和时间轴           |
| 6    | `src/server/session/ArticleSession.ts`                     | 会话生命周期、流式检查点、持久化       |
| 7    | `src/server/ai.ts`、`src/server/providers`、`src/protocol` | Gemini/DeepSeek/智谱流式协议与完成状态 |
| 8    | `src/domain`、`session/ensure-evidence.ts`                 | 字幕、章节要求与引用边界               |
| 9    | `session/summarize.ts`、`client/hooks/useSummary.ts`       | 只传章节ID的5W1H与缓存                 |
| 10   | `client/hooks/useEvidence.ts`、`SourceEvidence.tsx`        | 搜索、引用定位、时间跳转               |

## 工程判断

- 同一 Worker 提供前端和 API；SQLite Durable Objects 保存24小时文章与字幕缓存，没有引入账号平台或通用任务系统。字幕服务密钥仅发送到固定服务端点。
- 每视频字幕请求合并，成功结果缓存24小时，失败不缓存；新文章保存自己的来源副本，缓存更新不改变旧文章。用户取消不会撤销其他会话共用的字幕读取，继续生成前会检查取消。
- 主文章是真流式输出，连接提前中断不能冒充成功。中断会保存部分正文，只有结构和引用校验通过才标为完成。
- 模型偶尔忽略精确章节数，使用纯函数重组已有段落；缺失引用每批12段结构化补全，总计最多96段，每个已验证批次保存检查点，并校验输入段落与返回结果一一对应，不以伪造编号掩盖失败。
- 服务端保留完整来源与章节上下文，5W1H 不依赖前端重传正文。同章并发合并，未提到的信息明确为空；引用编号存在不等于语义已自动证明。
- ASR 与媒体服务已从交付版本移除，保留原文核对。当前默认使用DeepSeek；Gemini与智谱的类、流式/结构化协议、配置和密钥均保留，但默认不调用。Gemini的历史额度诊断见独立记录。

## 模型类与对象

业务层调用 `ai.ts:generate()`，不关心具体厂商。`providers/types.ts` 定义 `AIProvider` 接口与统一请求：系统指令、输入、取消信号和JSON模式。`createProvider(env)` 根据唯一的 `AI_PROVIDER` 配置创建对象，并且只向该对象传入对应厂商的密钥。

- `DeepSeekProvider`：默认 `deepseek-flash`，当前启用。
- `ZhipuProvider`：默认 `glm-4.7`，保留未启用。
- `GeminiProvider`：默认 `gemini-3.6-flash`，保留Interactions流式与JSON、503退避和额度提示，未启用。

```mermaid
classDiagram
  class AIProvider {
    <<interface>>
    generate(request)
  }
  AIProvider <|.. ChatCompletionsProvider
  AIProvider <|.. GeminiProvider
  ChatCompletionsProvider <|-- DeepSeekProvider
  ChatCompletionsProvider <|-- ZhipuProvider
```

DeepSeek与智谱共享Chat Completions协议，因此共同继承一个小的抽象基类；两个具体类各自固定端点与默认模型。Gemini协议不同，独立实现同一个接口。密钥存于JavaScript私有字段，对象序列化不包含密钥；`/api/config` 仅返回选中对象的名称、有效模型和是否配置。

```ts
const provider = createProvider(env); // 默认得到 DeepSeekProvider 对象
for await (const delta of provider.generate({ system, prompt, signal, json: false })) {
  // 由现有会话逻辑向浏览器转发增量
}
```

没有自动降级到其他厂商。切换只需调整配置和对应密钥，不改文章、篇幅或5W1H业务逻辑；未选中的Provider不会发送请求。

## 篇幅控制

`domain/length.ts` 解析明确的总篇幅、合并上下限并拒绝冲突；与界面共用 `requirements.readableLength` 统计。`session/finalize.ts` 顺序处理篇幅编辑、引用核对与最终验收，先缩短正文以减少随后需要核对的段落。

`domain/article-edits.ts` 将原稿分为带稳定ID的段落，分离标题、讲者和引用。`fit-length.ts` 按章给出小的编辑任务，只要求模型返回 `{edits: [{id, text}]}`，最多三轮，根据实测计数校准正文预算；程序按原顺序装回元数据。拒绝缺失/重复/陌生段落、插入标题或链接、空章节和丢失对话双方；允许省略次要整段。模型只编辑同一ID的信息，引用存在性与结构可验证，事实忠实性仍须人工核对。

## 检查点与恢复

完整模型流结束并整理章节后，保存 `processingStage=length`；篇幅合格后保存 `evidence`。引用按12段一批验证后保存，可复用此前已完成批次。`POST /api/sessions/:id/resume` 只依据服务端记录继续，不接收前端提供的正文或新要求，不再调用字幕服务或初稿生成。它复用访问码、同源与限频校验；正在运行、已经完成或没有可恢复检查点时返回409，过期返回404。

网络中断、取消或服务临时失败保留安全检查点与初稿；DO重启后读取遗留的generating记录会识别为interrupted。恢复不延长24小时有效期。删除和过期会中止进行中的任务，避免迟到结果恢复已删除记录。未完成的初稿只能重新生成，旧版无阶段记录保持可读，不假装可恢复。

客户端 `useWorkbench.ts` 共用生成与恢复的流事件处理；`checkpoint` 更新保存后的正文，`status.stage` 驱动四阶段进度，`done` 才标记完成。用时来自实际计时，没有估算百分比。`GenerationProgress.tsx` 负责展示，业务状态仍由服务器决定。

## 建议的实际走读方法

先在网页完成一次“视频 → 四章节文章 → 章节5W1H → 原文定位”，再按下面两条请求路线读。第一遍只跟数据流，第二遍再看异常、并发和测试；不必从样式或全部提示词开始。

### 第一条：生成文章

1. **边界与契约**：先看 `wrangler.jsonc` 和 `src/shared.ts`。区分每视频共享的 `TRANSCRIPTS`、每文章独立的 `SESSIONS`、按IP限频的 `QUOTAS`；认识 `Source`、`Article`、`Chapter`、`GenerationEvent`。24小时数据在云端保存，浏览器历史只存索引。
2. **用户点击生成**：在 `src/client/useWorkbench.ts` 找 `start()`，确认请求只含来源和用户要求；再跳到 `src/server/index.ts` 的 `/api/generate`。看输入验证、同源检查、访问码、限频和随机会话ID如何先于模型调用执行。
3. **素材如何来**：沿 `src/server/transcript.ts:getSource()` → `TranscriptCache.ts:resolve()` → `supadata.ts` 读。观察缓存键、24小时过期、同视频并发合并、失败不缓存，以及毫秒时间轴如何归一化。`youtube.ts` 是未配置Supadata时的备选入口，可第二遍再看。
4. **生成主干**：回到 `src/server/session/ArticleSession.ts:stream()`。依次跟随读取字幕、保存来源、流式写初稿、整理章节、验收篇幅、补全引用、最终保存与完成事件。注意只有最后验证通过才能变成 `complete`；取消和错误进入 `interrupted`，不丢弃初稿。
5. **为什么是真流式**：读 `src/server/ai.ts:generate()` → `src/server/providers/index.ts:createProvider()` → 选中的Provider对象 → `src/protocol/chat-completions.ts` / `gemini.ts` → `sse.ts:readSSE()`，再回 `useWorkbench.ts` 的事件循环。模型增量经Worker的 `delta` 到浏览器；`done.markdown` 负责替换为最终通过验收的正文。读结束标记检查，理解网络断流为什么不能算成功。`server/model-request.ts` 只对尚未输出的Gemini 503做最多三次请求，遵守Retry-After，开始输出后不自动重播；`model-error.ts` 区分日额度耗尽、零免费额度和一般限流，避免泄漏上游详情。
6. **模型之外的确定性规则**：读 `domain/length.ts`、`domain/requirements.ts`、`domain/outline.ts`、`domain/article-edits.ts`、`session/finalize.ts`、`session/fit-length.ts`、`session/ensure-evidence.ts`。分别回答“字数如何计”“章节不符怎么办”“编辑最多几轮”“怎样保护标题、讲者与引用”“失败时留下哪一版”。编号存在性可验证，语义正确性仍需人工核对。
7. **最后看展示**：`ArticleReader.tsx` → `Markdown.tsx` → `SourceEvidence.tsx` / `hooks/useEvidence.ts`。关注DOMPurify清洗、原文链接拦截、字幕搜索与真实时间跳转；样式最后阅读。

### 第二条：章节5W1H

从 `src/client/hooks/useSummary.ts:openSummary()` 出发，确认请求体只有 `{ chapterId }`；跟到 `ArticleSession.ts:summary()`，看它如何找到服务端保存的文章和章节、复用缓存、合并并发请求；再读 `session/summarize.ts` 与 `domain/evidence.ts:validateCitedSummary()`，确认完整字幕和当前章节参与生成，六个字段、信息缺失状态和引用都有校验。结构化输出未通过校验时，最多补试一次并仍然严格校验，两次共用60秒超时；上游网络或限流错误直接返回。最后看 `SummaryDialog.tsx` 如何展示。

### 用测试反问设计

- `tests/core.test.ts`：中文跨分片、结束标记、提前断流，为什么不能用普通字符串切分SSE？
- `tests/transcript-cache.test.ts`：同一视频两个用户同时生成，怎样避免重复扣字幕额度？
- `tests/length.test.ts` / `fit-length.test.ts`：怎样区分全文与每章字数要求？编辑失败为什么不能假报完成？
- `tests/ensure-evidence.test.ts` / `evidence.test.ts`：哪些引用问题可由程序检查，哪些仍不能自动证明？
- `tests/providers.test.ts` / `gemini.test.ts`：切模型时如何保证密钥只发送给对应厂商？怎样忽略思考与签名、确认真实结束、取消退避，避免重播部分正文？
- `tests/session-recovery.test.ts` / `resume-route.test.ts`：重启恢复、并发请求、取消、删除与过期怎样保护检查点，为什么恢复接口不接收客户端正文？
- `tests/smoke.mjs`：停止、保留部分正文、禁止总结未完成文章、删除后404如何在真实HTTP链路验收？

走读完成后，应能画出两条请求路线，并解释三个取舍：为什么采用按会话持久化、为什么不把完整正文从前端重传、为什么把事实与字数校验放在“完成”之前。详细测试结果见 [VALIDATION](VALIDATION.md)。
