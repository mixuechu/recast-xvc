import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8788';
const headers = {
  'Content-Type': 'application/json',
  ...(process.env.TEST_ACCESS_CODE ? { 'X-Access-Code': process.env.TEST_ACCESS_CODE } : {}),
};
const api = async (path, body) => {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
};
const audioUrl = process.env.TEST_ASR_AUDIO_URL;
assert.ok(
  audioUrl,
  '请设置 TEST_ASR_AUDIO_URL 为火山可直接下载的同一份 MIT 90 秒音频链接；GitHub raw / CDN 链接本次不可用。',
);
const audio = await fetch(audioUrl);
assert.ok(audio.ok);
assert.ok(
  !audio.headers.get('content-type')?.includes('text/html'),
  '音频链接返回了HTML页面，需要直接下载链接',
);
await audio.body?.cancel();
console.log('Verified public MIT audio excerpt; generating its source context.');
await mkdir('work', { recursive: true });
let id = process.env.TEST_SESSION_ID;
if (!id) {
  const transcript = await readFile('tests/fixtures/mit-lecture-90s.srt', 'utf8');
  const response = await fetch(base + '/api/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'manual',
      transcript,
      requirements:
        '按三个主题章节整理为中文短文，约600字，保持讲者单人叙述，不添加主持人，每段引用原文。',
    }),
  });
  const raw = await response.text();
  await writeFile('work/asr-generation.sse', raw);
  assert.ok(!raw.includes('event: error'), raw.match(/event: error\ndata: (.*)/)?.[1]);
  assert.ok(raw.includes('event: done'));
  id = raw.match(/"id":"([a-f0-9]{64})"/)[1];
}
await writeFile('work/asr-live-session.json', JSON.stringify({ id }));
const started = Date.now();
const existing = await api(`/api/sessions/${id}/recognition`);
const submitted =
  existing && ['queued', 'running', 'complete'].includes(existing.status)
    ? existing
    : await api(`/api/sessions/${id}/recognition`, {
        audioUrl,
        format: process.env.TEST_ASR_FORMAT ?? 'mp3',
      });
assert.ok(['queued', 'running', 'complete'].includes(submitted.status), JSON.stringify(submitted));
console.log('Submitted live ASR task; waiting for Durable Object alarm polling.');
let task;
for (let i = 0; i < 360; i++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  task = await api(`/api/sessions/${id}/recognition`);
  if (task?.status === 'complete' || task?.status === 'failed') break;
}
assert.equal(task.status, 'complete', JSON.stringify(task));
const review = await api(`/api/sessions/${id}/review`);
assert.equal(review.provider, 'volcengine');
assert.ok(review.rows.length);
assert.ok(review.rows.some((row) => row.candidate));
const changes = review.rows
  .filter((row) => row.changed)
  .map((row) => ({ id: row.id, decision: row.original ? 'original' : 'candidate' }));
const saved = await api(`/api/sessions/${id}/review`, {
  action: 'resolve',
  version: review.version,
  changes,
});
assert.ok(saved.rows.every((row) => row.confirmed));
const report = {
  audioOrigin: 'MIT OCW original video, seconds 90–180; 90-second MP3 excerpt',
  audioUrl,
  articleId: id,
  recognitionStatus: task.status,
  recognitionMs: Date.now() - (task.createdAt ?? started),
  pollAttempts: task.attempts,
  alignedGroups: review.rows.length,
  differingGroups: changes.length,
  numberDifferences: review.rows.filter((row) => row.reasons.includes('数字有差异')).length,
  reviewConfirmed: true,
};
await writeFile('work/live-asr.json', JSON.stringify(report, null, 2));
await writeFile('work/live-asr-review.json', JSON.stringify(review, null, 2));
console.log(JSON.stringify(report, null, 2));
