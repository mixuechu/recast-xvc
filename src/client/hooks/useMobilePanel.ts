import { useEffect, useRef, useState } from 'react';
export function useMobilePanel() {
  const [sidebar, setSidebar] = useState(false),
    [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 620px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobile || !sidebar) return;
    const previous = document.activeElement as HTMLElement;
    const controls = () => [
      ...(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href]',
      ) ?? []),
    ];
    controls()[0]?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSidebar(false);
      }
      if (e.key === 'Tab') {
        const list = controls(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [mobile, sidebar]);
  return { sidebar, setSidebar, mobile, sidebarRef };
}
