import { marked } from 'marked';
import DOMPurify from 'dompurify';
marked.use({ breaks: false, gfm: true });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement) {
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  }
});
export function Markdown({
  text,
  onCitation,
}: {
  text: string;
  onCitation?: (id: string) => void;
}) {
  return (
    <div
      className="prose"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a');
        const id = link?.getAttribute('href')?.match(/^#source-(c\d{4,})$/)?.[1];
        if (id && onCitation) {
          event.preventDefault();
          onCitation(id);
        }
      }}
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(text, { async: false }), {
          FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'style', 'form', 'input'],
        }),
      }}
    />
  );
}
