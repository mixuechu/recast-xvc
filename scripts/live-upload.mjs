import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8788';
const headers = { 'X-Access-Code': process.env.TEST_ACCESS_CODE ?? '' };
const api = async (path, body, method = 'POST') => {
  const response = await fetch(base + path, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
};
await mkdir('work', { recursive: true });
const generate = async (input) => {
  const response = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const raw = await response.text();
  assert.ok(
    raw.includes('event: done'),
    raw.match(/event: error\ndata: (.*)/)?.[1] ?? raw.slice(0, 200),
  );
  return raw.match(/"id":"([a-f0-9]{64})"/)[1];
};
const requirements =
  '面向初学者，按三个主题章节整理为中文短文，约600字，保留单人讲述，每段引用原文。';
const id = await generate({
  mode: 'manual',
  transcript: await readFile('tests/fixtures/mit-lecture-90s.srt', 'utf8'),
  requirements,
});
await writeFile('work/upload-session.json', JSON.stringify({ id }));
const before = await api(`/api/sessions/${id}`, null, 'GET');
const bytes = await readFile('tests/fixtures/mit-lecture-90s.mp3');
const response = await fetch(`${base}/api/sessions/${id}/audio`, {
  method: 'POST',
  headers: {
    ...headers,
    'Content-Type': 'application/octet-stream',
    'X-Audio-Filename': 'mit-lecture-90s.mp3',
  },
  body: bytes,
});
const audio = await response.json();
assert.ok(response.ok, JSON.stringify(audio));
const download = await fetch(audio.url);
assert.equal(download.status, 200);
assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
const range = await fetch(audio.url, { headers: { Range: 'bytes=100-199' } });
assert.equal(range.status, 206);
assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(100, 200));
assert.equal((await fetch(audio.url.replace(/.$/, 'x'))).status, 404);
assert.equal(
  (await fetch(new URL('/api/config', audio.url))).status,
  404,
  'tunnel must not expose the app API',
);
console.log('Upload and provider-facing download passed; submitting actual ASR.');
const started = Date.now();
await api(`/api/sessions/${id}/recognition`, { audioUrl: audio.url, format: audio.format });
let task;
for (let i = 0; i < 180; i++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  task = await api(`/api/sessions/${id}/recognition`, null, 'GET');
  if (['complete', 'failed'].includes(task.status)) break;
}
assert.equal(task.status, 'complete', JSON.stringify(task));
const recognitionMs = Date.now() - started;
const review = await api(`/api/sessions/${id}/review`, null, 'GET');
assert.equal(review.provider, 'volcengine');
const changes = review.rows
  .filter((r) => r.changed)
  .map((r) => ({ id: r.id, decision: r.original ? 'original' : 'candidate' }));
const saved = await api(`/api/sessions/${id}/review`, {
  action: 'resolve',
  version: review.version,
  changes,
});
const nextId = await generate({
  mode: 'revision',
  fromSessionId: id,
  reviewVersion: saved.version,
  requirements,
});
const next = await api(`/api/sessions/${nextId}`, null, 'GET');
assert.equal(next.chapters.length, 3);
assert.equal(next.parentId, id);
assert.equal(next.status, 'complete');
assert.equal((await api(`/api/sessions/${id}`, null, 'GET')).markdown, before.markdown);
await api(`/api/sessions/${id}`, null, 'DELETE');
assert.equal((await fetch(audio.url)).status, 404, 'article deletion must invalidate the audio');
const report = {
  source: 'MIT OCW 90–180s excerpt',
  uploadBytes: bytes.length,
  fullDownloadVerified: true,
  rangeVerified: true,
  tunnelApiPrivate: true,
  asrStatus: task.status,
  recognitionMs,
  alignedGroups: review.rows.length,
  changedGroups: changes.length,
  revisionChapters: next.chapters.length,
  originalUnchanged: true,
  deletionInvalidatesAudio: true,
  revisionId: nextId,
};
await writeFile('work/live-upload.json', JSON.stringify(report, null, 2));
console.log(report);
