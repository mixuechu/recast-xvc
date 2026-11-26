import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8787';
const headers = {
  'Content-Type': 'application/json',
  ...(process.env.TEST_ACCESS_CODE ? { 'X-Access-Code': process.env.TEST_ACCESS_CODE } : {}),
};
const post = (path, data, extra = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { ...headers, ...extra },
    body: JSON.stringify(data),
  });
const config = await (await fetch(base + '/api/config')).json();
assert.equal(config.configured, true);
assert.equal((await post('/api/generate', { mode: 'unknown', requirements: '' })).status, 400);
assert.equal(
  (await post('/api/generate', { mode: 'sample', requirements: 'x'.repeat(2001) })).status,
  400,
);
assert.equal(
  (
    await post(
      '/api/generate',
      { mode: 'sample', requirements: '' },
      { Origin: 'https://attacker.invalid' },
    )
  ).status,
  403,
);
assert.equal((await fetch(base + '/api/sessions/' + 'a'.repeat(64), { headers })).status, 404);
const response = await post('/api/generate', {
  mode: 'sample',
  requirements: '保留对话，按三个章节整理，控制在1500字。',
});
assert.equal(response.status, 200);
assert.ok(response.headers.get('content-type').includes('text/event-stream'));
let raw = '',
  id = '',
  cancelled = false;
const decoder = new TextDecoder();
const reader = response.body.getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  raw += decoder.decode(value, { stream: true });
  id = raw.match(/"id":"([a-f0-9]{64})"/)?.[1] ?? id;
  if (!cancelled && raw.includes('event: delta')) {
    cancelled = true;
    assert.equal((await post(`/api/sessions/${id}/cancel`, {})).status, 200);
  }
}
assert.ok(cancelled, 'must receive real model deltas before cancelling');
const article = await (await fetch(`${base}/api/sessions/${id}`, { headers })).json();
assert.equal(article.status, 'interrupted');
assert.ok(article.markdown.length > 0);
assert.equal('captions' in article.source, false);
assert.equal((await post(`/api/sessions/${id}/resume`, {})).status, 409);
assert.equal((await post(`/api/sessions/${id}/summary`, { chapterId: 'chapter-1' })).status, 409);
assert.equal(
  (await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers })).status,
  200,
);
assert.equal((await fetch(`${base}/api/sessions/${id}`, { headers })).status, 404);
console.log(
  'Passed: config, validation, same-origin protection, missing record, live deltas, explicit cancellation, retained partial content, unfinished-draft resume guard, summary guard, deletion.',
);
