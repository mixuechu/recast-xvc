import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8787';
const headers = {
  'Content-Type': 'application/json',
  ...(process.env.TEST_ACCESS_CODE ? { 'X-Access-Code': process.env.TEST_ACCESS_CODE } : {}),
};
const api = async (path, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(base + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  assert.ok(r.ok, JSON.stringify(j));
  return j;
};
async function generate(requirements) {
  const start = Date.now();
  const r = await fetch(base + '/api/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'youtube',
      url: 'https://www.youtube.com/watch?v=aircAruvnKk',
      requirements,
    }),
    signal: AbortSignal.timeout(180000),
  });
  assert.ok(r.ok);
  const reader = r.body.getReader(),
    decoder = new TextDecoder();
  let raw = '',
    firstTokenMs = null,
    deltas = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    if (chunk.includes('event: delta')) {
      firstTokenMs ??= Date.now() - start;
      deltas++;
    }
  }
  assert.ok(!raw.includes('event: error'), raw.match(/event: error\ndata: (.*)/)?.[1]);
  assert.ok(raw.includes('event: done'));
  return {
    id: raw.match(/"id":"([a-f0-9]{64})"/)[1],
    firstTokenMs,
    deltas,
    totalMs: Date.now() - start,
  };
}
fs.mkdirSync('work', { recursive: true });
assert.equal((await api('/api/config')).transcriptProvider, 'supadata');
const first = await generate(
  '面向初学者，用中文整理为三个章节，约1000字，解释神经网络的主要概念，保留原讲者思路，不虚构对话，逐段引用原文。',
);
console.log(JSON.stringify({ phase: 'first-article', ...first }));
fs.writeFileSync('work/core-first-session.json', JSON.stringify(first));
const article = await api(`/api/sessions/${first.id}`),
  source = await api(`/api/sessions/${first.id}/source`);
assert.equal(article.status, 'complete');
assert.equal(article.chapters.length, 3);
assert.equal(source.retrievedBy, 'supadata');
assert.equal(source.provider, 'youtube');
assert.equal(source.videoId, 'aircAruvnKk');
assert.ok(source.captions.length > 100);
assert.ok(article.citationCount > 0);
const ids = new Set(source.captions.map((c) => c.id));
for (const m of article.markdown.matchAll(/\]\(#source-(c\d+)\)/g)) assert.ok(ids.has(m[1]));
let start = Date.now();
const summary = await api(`/api/sessions/${first.id}/summary`, {
  chapterId: article.chapters[0].id,
});
const summaryMs = Date.now() - start;
for (const key of ['Who', 'What', 'When', 'Where', 'Why', 'How']) {
  assert.ok(summary[key]?.text);
  for (const id of summary[key].citationIds) assert.ok(ids.has(id));
  if (summary[key].status === 'supported') assert.ok(summary[key].citationIds.length);
}
start = Date.now();
assert.deepEqual(
  await api(`/api/sessions/${first.id}/summary`, { chapterId: article.chapters[0].id }),
  summary,
);
const summaryCacheMs = Date.now() - start;
console.log(JSON.stringify({ phase: 'summary', summaryMs, summaryCacheMs }));
const second = await generate(
  '用中文整理为两个章节，约500字，突出神经网络的概念与局限，不虚构原文未提到的事实，逐段引用原文。',
);
console.log(JSON.stringify({ phase: 'cached-source-article', ...second }));
const next = await api(`/api/sessions/${second.id}`),
  nextSource = await api(`/api/sessions/${second.id}/source`);
assert.equal(next.status, 'complete');
assert.equal(next.chapters.length, 2);
assert.equal(nextSource.retrieval, 'cache');
assert.equal(nextSource.fetchedAt, source.fetchedAt);
assert.equal((await api(`/api/sessions/${first.id}`)).markdown, article.markdown);
const report = {
  videoId: source.videoId,
  title: source.title,
  provider: source.provider,
  retrievedBy: source.retrievedBy,
  retrieval: source.retrieval,
  captions: source.captions.length,
  characters: source.captions.reduce((n, c) => n + c.text.length, 0),
  chapters: article.chapters.length,
  citations: article.citationCount,
  first,
  summaryMs,
  summaryCacheMs,
  second,
  secondChapters: next.chapters.length,
  secondRetrieval: nextSource.retrieval,
  originalUnchanged: true,
  asr: 'not used',
};
fs.writeFileSync('work/core-validation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
