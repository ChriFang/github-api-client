import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

const BLOCKED_TAGS = new Set([
  'SCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'STYLE',
  'LINK',
  'META',
  'BASE',
  'FORM',
]);

const ALLOWED_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function sanitize(root: HTMLElement): void {
  root.querySelectorAll('*').forEach((element) => {
    if (BLOCKED_TAGS.has(element.tagName)) {
      element.remove();
      return;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && value) {
        let protocol = '';
        try {
          protocol = new URL(value, window.location.origin).protocol;
        } catch {
          element.removeAttribute(attribute.name);
          continue;
        }
        const allowed = element.tagName === 'IMG' ? ALLOWED_IMAGE_PROTOCOLS : ALLOWED_LINK_PROTOCOLS;
        if (!allowed.has(protocol)) {
          element.removeAttribute(attribute.name);
        }
      }
    }

    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer noopener');
    }
  });
}

/**
 * README 来自任意仓库，属于不可信内容。
 * 先交给 marked 渲染，再用 DOM 解析器做一次白名单清洗，避免注入脚本。
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false });
  const document = new DOMParser().parseFromString(html, 'text/html');
  sanitize(document.body);
  return document.body.innerHTML;
}
