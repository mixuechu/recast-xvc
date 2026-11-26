function retryTime(headers: Headers): string {
  const seconds = Number(headers.get('Retry-After'));
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return `预计约${hours ? `${hours}小时` : ''}${minutes % 60 ? `${minutes % 60}分钟` : ''}后可重试。`;
}

export async function modelError(response: Response, provider: string): Promise<Error> {
  if (provider === 'gemini' && [400, 429].includes(response.status)) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string; details?: { reason?: string }[] };
    } | null;
    if (data?.error?.details?.some((d) => d.reason === 'API_KEY_INVALID'))
      return new Error('模型授权失败，请检查服务端密钥与模型权限。');
    if (response.status === 429) {
      const daily = data?.error?.message?.match(/limit:\s*(\d+)\s*requests per day on Free Tier/i);
      if (daily) {
        const count = Number(daily[1]);
        return new Error(
          count === 0
            ? '当前Gemini模型的免费调用额度为0，请由维护者检查模型权限或计费配置。'
            : `Gemini每日免费调用额度已用尽（${count}次/天）。${retryTime(response.headers)}`,
        );
      }
      return new Error('Gemini请求频率或额度受限，请稍后重试。');
    }
  } else await response.body?.cancel();
  if ([401, 403].includes(response.status))
    return new Error('模型授权失败，请检查服务端密钥与模型权限。');
  if (response.status === 429) return new Error('模型当前请求较多或额度不足，请稍后重试。');
  return new Error(`模型服务暂时不可用（${response.status}），请稍后重试。`);
}
