import { useCallback } from 'react';
export type Api = (path: string, options?: RequestInit) => Promise<Response>;
export function useApi(access: string): Api {
  return useCallback(
    async (path, options = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Code': access,
          ...options.headers,
        },
      });
      if (!response.ok) {
        let message = '请求失败，请重试。';
        try {
          message = ((await response.json()) as { error?: string }).error ?? message;
        } catch {}
        throw new Error(message);
      }
      return response;
    },
    [access],
  );
}
