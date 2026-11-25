import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8787';
const headers = {
  'Content-Type': 'application/json',
  ...(process.env.TEST_ACCESS_CODE ? { 'X-Access-Code': process.env.TEST_ACCESS_CODE } : {}),
};
const api = async (path, body, method = body ? 'POST' : 'GET') => {
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
};
async function generate(input) {
  const started = Date.now(),
    r = await fetch(base + '/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
  assert.ok(r.ok);
  const reader = r.body.getReader(),
    decoder = new TextDecoder();
  let raw = '',
    first = null,
    deltas = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const part = decoder.decode(value, { stream: true });
    raw += part;
    if (part.includes('event: delta')) {
      first ??= Date.now() - started;
      deltas++;
    }
  }
  assert.ok(!raw.includes('event: error'), raw.match(/event: error\ndata: (.*)/)?.[1]);
  assert.ok(raw.includes('event: done'));
  const id = raw.match(/"id":"([a-f0-9]{64})"/)[1];
  return { id, firstTokenMs: first, totalMs: Date.now() - started, deltas };
}
await mkdir('work', { recursive: true });
const first = process.env.TEST_SESSION_ID
  ? { id: process.env.TEST_SESSION_ID }
  : await generate({
      mode: 'youtube',
      url: 'https://www.youtube.com/watch?v=nykOeWgQcHM',
      requirements:
        '面向编程初学者，用中文整理为五个主题章节，保留 Ana Bell 的单人讲述，不虚构问答。正文约1800字，解释关键术语，保留学习建议和重要限制。',
    });
await writeFile('work/live-first-session.json', JSON.stringify(first));
console.log('Generated real video article; validating context and summary.');
const article = await api(`/api/sessions/${first.id}`),
  source = await api(`/api/sessions/${first.id}/source`);
assert.equal(source.videoId, 'nykOeWgQcHM');
assert.ok(source.captions.length > 500);
assert.equal(article.status, 'complete');
assert.equal(article.chapters.length, 5);
assert.ok(article.citationCount > 0);
assert.ok(!('captions' in article.source));
const ids = new Set(source.captions.map((c) => c.id));
for (const match of article.markdown.matchAll(/\]\(#source-(c\d+)\)/g))
  assert.ok(ids.has(match[1]));
const start = Date.now(),
  summary = await api(`/api/sessions/${first.id}/summary`, { chapterId: article.chapters[0].id });
const summaryMs = Date.now() - start;
for (const key of ['Who', 'What', 'When', 'Where', 'Why', 'How']) {
  assert.ok(summary[key]?.text);
  for (const id of summary[key].citationIds) assert.ok(ids.has(id));
  if (summary[key].status === 'supported') assert.ok(summary[key].citationIds.length);
}
const cachedStart = Date.now(),
  cached = await api(`/api/sessions/${first.id}/summary`, { chapterId: article.chapters[0].id });
assert.deepEqual(summary, cached);
const cachedMs = Date.now() - cachedStart;
const time = (n) => {
  const ms = Math.round(n * 1000),
    s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
// Intentionally perturbed fixture tests the review workflow; it is not a real ASR output.
const candidate =
  'WEBVTT\n\n' +
  source.captions
    .map(
      (c, i) =>
        `${time(c.offset)} --> ${time(c.offset + c.duration)}\n${c.text}${i === 0 ? ' [REVIEW TEST]' : ''}`,
    )
    .join('\n\n');
const review = await api(`/api/sessions/${first.id}/review`, {
  action: 'import',
  transcript: candidate,
});
assert.ok(review.rows.some((r) => r.changed && !r.confirmed));
const changes = review.rows
  .filter((r) => r.changed)
  .map((r) => ({ id: r.id, decision: r.original ? 'original' : 'candidate' }));
const saved = await api(`/api/sessions/${first.id}/review`, {
  action: 'resolve',
  version: review.version,
  changes,
});
assert.ok(saved.rows.every((r) => r.confirmed));
console.log('Source, evidence summary, cache and review confirmed; generating revised article.');
const revision = await generate({
  mode: 'revision',
  fromSessionId: first.id,
  reviewVersion: saved.version,
  requirements: '用中文整理为三个主题章节，约1000字，保留单人讲述，逐段引用原文。',
});
const next = await api(`/api/sessions/${revision.id}`);
assert.equal(next.parentId, first.id);
assert.equal(next.chapters.length, 3);
assert.equal(next.source.provider, 'reviewed');
assert.equal((await api(`/api/sessions/${first.id}`)).markdown, article.markdown);
await writeFile('work/live-article.json', JSON.stringify(article, null, 2));
await writeFile('work/live-summary.json', JSON.stringify(summary, null, 2));
const report = {
  videoId: source.videoId,
  title: source.title,
  provider: source.provider,
  retrieval: source.retrieval,
  notice: source.notice,
  captions: source.captions.length,
  sourceCharacters: source.captions.reduce((n, c) => n + c.text.length, 0),
  firstGeneration: first,
  chapters: article.chapters.length,
  citations: article.citationCount,
  summaryMs,
  cachedMs,
  reviewRows: review.rows.length,
  reviewDifferences: changes.length,
  revisionGeneration: revision,
  revisionChapters: next.chapters.length,
  originalUnchanged: true,
  asr: 'Validated separately by live-asr; see docs/VALIDATION.md',
};
await writeFile('work/live-validation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
