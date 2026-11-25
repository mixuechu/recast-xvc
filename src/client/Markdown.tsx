import { marked } from 'marked';
import DOMPurify from 'dompurify';
marked.use({ breaks: false, gfm: true });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement) {
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }
});
export function Markdown({ text }: { text: string }) {
  return (
    <div
      className="prose"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(text, { async: false }), {
          FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style', 'form', 'input'],
        }),
      }}
    />
  );
}
