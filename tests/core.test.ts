import { describe, it, expect, vi, afterEach } from 'vitest';
import { videoId, splitArticle } from '../src/shared';
import { readSSE } from '../src/protocol/sse';
import { generate } from '../src/server/ai';
import { getSource, sourceText } from '../src/server/transcript';
const stream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
      c.close();
    },
  });
afterEach(() => vi.unstubAllGlobals());
describe('input and context boundaries', () => {
  it.each([
    'https://youtube.com/watch?v=xRh2sVcNXQ8',
    'https://youtu.be/xRh2sVcNXQ8?t=20',
    'https://www.youtube.com/shorts/xRh2sVcNXQ8',
    'https://m.youtube.com/live/xRh2sVcNXQ8',
  ])('normalizes %s', (url) => expect(videoId(url)).toBe('xRh2sVcNXQ8'));
  it.each([
    'https://youtube.com.attacker.com/watch?v=xRh2sVcNXQ8',
    'https://attacker.com/youtube.com/watch?v=xRh2sVcNXQ8',
    'file:///etc/passwd',
    'https://user:secret@youtube.com/watch?v=xRh2sVcNXQ8',
    'https://youtube.com/watch?v=short',
  ])('rejects unsafe or malformed %s', (url) => expect(() => videoId(url)).toThrow());
  it('keeps duplicate chapter titles addressable and ignores level-three headings', () => {
    const parts = splitArticle('# 标题\n导语\n## 相同\n第一章\n### 小节\n内容\n## 相同\n第二章');
    expect(parts).toEqual([
      { id: 'chapter-1', title: '相同', markdown: '第一章\n### 小节\n内容' },
      { id: 'chapter-2', title: '相同', markdown: '第二章' },
    ]);
  });
  it('never silently replaces a failed video with the demo', async () => {
    await expect(
      getSource({ mode: 'youtube', url: 'bad' }, new AbortController().signal),
    ).rejects.toThrow();
  });
  it('rejects oversized manual input', async () => {
    await expect(
      getSource({ mode: 'manual', transcript: '字'.repeat(100001) }, new AbortController().signal),
    ).rejects.toThrow('100,000');
  });
  it('does not invent video timestamps for pasted source', async () => {
    const source = await getSource(
      { mode: 'manual', transcript: '对话内容'.repeat(30) },
      new AbortController().signal,
    );
    expect(sourceText(source)).not.toContain('[00:00]');
  });
});
describe('streaming protocol', () => {
  it('preserves UTF-8, CRLF, multiline data, heartbeats and trailing events across arbitrary chunks', async () => {
    const events = [];
    for await (const e of readSSE(
      stream(': pulse\r\n\r\ndata: 中文\r\ndata: 第二行\r\n\r\ndata: 最后一条'),
    ))
      events.push(e);
    expect(events).toEqual(['中文\n第二行', '最后一条']);
  });
  it('normalizes provider deltas and excludes reasoning', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            stream(
              'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\ndata: [DONE]\n\n',
            ),
          ),
        ),
    );
    let text = '';
    for await (const delta of generate(
      { AI_PROVIDER: 'zhipu', AI_MODEL: 'test', ZHIPU_API_KEY: 'test' },
      'system',
      'prompt',
      new AbortController().signal,
    ))
      text += delta;
    expect(text).toBe('你好');
  });
  it('does not report a truncated model response as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(stream('data: {"choices":[{"delta":{"content":"部分内容"}}]}\n\n')),
        ),
    );
    const collect = async () => {
      for await (const _ of generate(
        { AI_PROVIDER: 'zhipu', AI_MODEL: 'test', ZHIPU_API_KEY: 'test' },
        '',
        '',
        new AbortController().signal,
      )) {
      }
    };
    await expect(collect()).rejects.toThrow('提前断开');
  });
  it('returns actionable errors without exposing upstream response or keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret raw body', { status: 401 })),
    );
    const collect = async () => {
      for await (const _ of generate(
        { AI_PROVIDER: 'zhipu', AI_MODEL: 'test', ZHIPU_API_KEY: 'test' },
        '',
        '',
        new AbortController().signal,
      )) {
      }
    };
    await expect(collect()).rejects.toThrow('授权失败');
  });
  it('supports the Gemini adapter with the same stream contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            stream(
              'data: {"event_type":"step.start","index":0,"step":{"type":"model_output"}}\n\ndata: {"event_type":"step.delta","index":0,"delta":{"type":"text","text":"回答"}}\n\ndata: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n',
            ),
          ),
        ),
    );
    let text = '';
    for await (const delta of generate(
      { AI_PROVIDER: 'gemini', AI_MODEL: 'test', GEMINI_API_KEY: 'test' },
      '',
      '',
      new AbortController().signal,
    ))
      text += delta;
    expect(text).toBe('回答');
  });
});
