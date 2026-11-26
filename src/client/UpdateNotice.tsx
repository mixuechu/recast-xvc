import { useEffect, useState } from 'react';
export function UpdateNotice({ busy, reload }: { busy: boolean; reload: () => void }) {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!src) return;
    const loaded = new URL(src).pathname;
    let stopped = false,
      checking = false,
      outdated = false;
    const check = async () => {
      if (stopped || checking || outdated || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (!response.ok) return;
        const { asset } = (await response.json()) as { asset: string };
        if (!stopped && asset && asset !== loaded) {
          outdated = true;
          setUpdated(true);
        }
      } catch {
        /* Keep the current page usable when the update check is offline. */
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 60000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return updated ? (
    <div className="update-notice" role="status">
      <span>
        新版本已发布。{busy ? '当前生成结束后可更新。' : '刷新会保留输入，并恢复当前保存的文章。'}
      </span>
      <button className="secondary" disabled={busy} onClick={reload}>
        保存并刷新
      </button>
    </div>
  ) : null;
}
