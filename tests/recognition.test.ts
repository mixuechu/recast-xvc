import { it, expect, vi, afterEach } from 'vitest';
import { queryRecognition, submitRecognition } from '../src/server/recognition';
afterEach(() => vi.unstubAllGlobals());
const env = { VOLC_ASR_API_KEY: 'test-secret' };
it('submits with ASR-specific authorization and no destructive text smoothing', async () => {
  const mock = vi
    .fn()
    .mockResolvedValue(new Response('{}', { headers: { 'X-Api-Status-Code': '20000000' } }));
  vi.stubGlobal('fetch', mock);
  await submitRecognition(env, 'id', 'https://media.example.com/a.mp3');
  const [url, init] = mock.mock.calls[0];
  expect(url).toContain('/submit');
  expect(init.headers['X-Api-Key']).toBe('test-secret');
  const body = JSON.parse(init.body);
  expect(body.request.enable_ddc).toBe(false);
  expect(body.request.show_utterances).toBe(true);
});
it('maps ASR milliseconds and speaker labels into source captions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            utterances: [
              {
                text: 'Original speech.',
                start_time: 500,
                end_time: 2000,
                additions: { speaker: '1' },
              },
            ],
          },
        }),
        { headers: { 'X-Api-Status-Code': '20000000' } },
      ),
    ),
  );
  expect(await queryRecognition(env, 'id')).toEqual([
    { id: 'c0001', text: 'Original speech.', offset: 0.5, duration: 1.5, speaker: '讲者 1' },
  ]);
});
it('keeps pending jobs pending rather than returning an empty transcript', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { headers: { 'X-Api-Status-Code': '20000001' } })),
  );
  expect(await queryRecognition(env, 'id')).toBeNull();
});
it('reports missing ASR permission without leaking raw response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('sensitive provider body', {
        status: 403,
        headers: { 'X-Api-Status-Code': '45000030' },
      }),
    ),
  );
  await expect(queryRecognition(env, 'id')).rejects.toThrow('未授权');
});
it('passes an explicit format for an opaque signed object URL', async () => {
  const mock = vi
    .fn()
    .mockResolvedValue(new Response('{}', { headers: { 'X-Api-Status-Code': '20000000' } }));
  vi.stubGlobal('fetch', mock);
  await submitRecognition(
    env,
    'id',
    'https://storage.example.com/opaquehash?signature=temporary',
    'mp3',
  );
  expect(JSON.parse(mock.mock.calls[0][1].body).audio.format).toBe('mp3');
});
