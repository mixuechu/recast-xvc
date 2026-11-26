function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Retry only a busy Gemini response before any stream is consumed; never replay partial text.
export async function requestModel(
  url: string,
  init: RequestInit & { signal: AbortSignal },
  attempts = 1,
) {
  for (let attempt = 0; ; attempt++) {
    init.signal.throwIfAborted();
    const response = await fetch(url, init);
    if (response.status !== 503 || attempt + 1 >= attempts) return response;
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
    const retryAfter = Number.isFinite(seconds)
      ? seconds * 1000
      : header
        ? Date.parse(header) - Date.now()
        : 0;
    // A longer server wait must be surfaced, not shortened to fit an interactive request.
    if (retryAfter > 30000) return response;
    await response.body?.cancel();
    await pause(
      Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 250), retryAfter || 0),
      init.signal,
    );
  }
}
