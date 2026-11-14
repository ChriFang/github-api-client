import { marked } from 'marked';
import { api, GitHubError } from './api';
import type { TreeResponse } from './types';

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

const ALLOWED_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'data:']);
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** 1x1 透明 GIF：图片通过 API 取回前先用它占位，避免浏览器去请求站内相对地址 */
const IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** 单份 README 最多补全多少张仓库内图片，避免恶意/异常 README 消耗大量配额 */
const MAX_REPO_IMAGES = 40;

export interface MarkdownContext {
  owner: string;
  repo: string;
  ref: string;
  /** README 在仓库中的路径，用于解析相对图片/链接 */
  path?: string;
}

function resolveProtocol(value: string): string {
  try {
    return new URL(value, window.location.origin).protocol;
  } catch {
    return '';
  }
}

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

      if (name === 'srcset' || name === 'imagesrcset') {
        const candidates = value
          .split(',')
          .map((part) => part.trim().split(/\s+/)[0] ?? '')
          .filter(Boolean);
        if (candidates.some((url) => !/^(?:https?:|data:image\/)/i.test(url))) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }

      if ((name === 'href' || name === 'src' || name === 'xlink:href') && value) {
        const protocol = resolveProtocol(value);
        const allowed = element.tagName === 'IMG' ? ALLOWED_IMAGE_PROTOCOLS : ALLOWED_LINK_PROTOCOLS;
        const isInlineImage = protocol === 'data:' && value.startsWith('data:image/');
        if (!allowed.has(protocol) || (protocol === 'data:' && !isInlineImage)) {
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

/** 把 README 中的相对路径解析成仓库内路径；外链、锚点、data: 返回 null */
function repoRelativePath(value: string, basePath = ''): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null;

  const cut = trimmed.search(/[?#]/);
  const rawPath = cut >= 0 ? trimmed.slice(0, cut) : trimmed;
  if (!rawPath) return null;

  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : '';
  try {
    const resolved = new URL(rawPath, `https://repo.local/${baseDir}`);
    if (resolved.origin !== 'https://repo.local') return null;
    return decodeURIComponent(resolved.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

/** 识别 raw.githubusercontent.com / github.com blob?raw=true 形式的同仓库图片 */
function sameRepoImage(
  value: string,
  context: MarkdownContext,
): { path: string; ref: string } | null {
  let url: URL;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const owner = context.owner.toLowerCase();
  const repo = context.repo.toLowerCase();
  const prefix = `/${owner}/${repo}/`;
  const pathname = url.pathname.toLowerCase();
  if (!pathname.startsWith(prefix)) return null;

  const rest = url.pathname.slice(prefix.length);
  const restLower = rest.toLowerCase();

  if (url.hostname === 'raw.githubusercontent.com') {
    const refPrefix = `${context.ref}/`;
    if (restLower.startsWith(refPrefix.toLowerCase())) {
      return {
        path: decodeURIComponent(rest.slice(refPrefix.length)),
        ref: context.ref,
      };
    }
    return null;
  }

  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const rawPrefix = `raw/${context.ref}/`;
    if (restLower.startsWith(rawPrefix.toLowerCase())) {
      return {
        path: decodeURIComponent(rest.slice(rawPrefix.length)),
        ref: context.ref,
      };
    }

    const blobPrefix = `blob/${context.ref}/`;
    if (restLower.startsWith(blobPrefix.toLowerCase())) {
      return {
        path: decodeURIComponent(rest.slice(blobPrefix.length)),
        ref: context.ref,
      };
    }
  }

  return null;
}

function encodeRepoPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function prepareLinks(root: HTMLElement, context: MarkdownContext): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (!href) return;
    const path = repoRelativePath(href, context.path);
    if (!path) return;

    const hashIndex = href.indexOf('#');
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
    anchor.setAttribute(
      'href',
      `https://github.com/${encodeURIComponent(context.owner)}/${encodeURIComponent(
        context.repo,
      )}/blob/${encodeRepoPath(context.ref)}/${encodeRepoPath(path)}${hash}`,
    );
  });
}

function prepareImages(root: HTMLElement, context: MarkdownContext): void {
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const src = image.getAttribute('src');
    if (!src) return;

    const absolute = sameRepoImage(src, context);
    const path = absolute?.path ?? repoRelativePath(src, context.path);
    if (!path) return;

    image.setAttribute('data-repo-image', path);
    if (absolute?.ref) image.setAttribute('data-repo-ref', absolute.ref);
    image.setAttribute('src', IMAGE_PLACEHOLDER);
    image.setAttribute('loading', 'lazy');
    image.classList.add('readme-image-pending');
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');

    // <picture> 里的 <source> 也可能指向仓库内图片，统一回退到 <img> 的 API 加载
    const picture = image.closest('picture');
    if (picture) {
      picture.querySelectorAll('source').forEach((source) => source.remove());
    }
  });
}

/** 将 README 文本里的 :rocket: 之类 GitHub emoji 短码替换为图标 */
export function applyEmojiTo(root: HTMLElement, emojis: Record<string, string> | undefined): void {
  if (!emojis || Object.keys(emojis).length === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('code, pre, a, script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return /:[a-z0-9_+-]+:/i.test(node.nodeValue ?? '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const pattern = /:([a-z0-9_+-]+):/gi;
    let match: RegExpExecArray | null;
    let cursor = 0;
    let fragment: DocumentFragment | null = null;

    while ((match = pattern.exec(text))) {
      const url = emojis[match[1].toLowerCase()];
      if (!url) continue;

      if (!fragment) fragment = document.createDocumentFragment();
      fragment.append(text.slice(cursor, match.index));

      const image = document.createElement('img');
      image.className = 'emoji';
      image.src = url;
      image.alt = match[0];
      image.title = match[0];
      image.loading = 'lazy';
      image.draggable = false;
      fragment.append(image);
      cursor = pattern.lastIndex;
    }

    if (fragment) {
      fragment.append(text.slice(cursor));
      node.replaceWith(fragment);
    }
  }
}

function imageMime(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

const repoTreeCache = new Map<string, Promise<TreeResponse>>();

function loadRepoTree(owner: string, repo: string, ref: string): Promise<TreeResponse> {
  const key = `${owner}/${repo}@${ref}`;
  let tree = repoTreeCache.get(key);
  if (!tree) {
    tree = api
      .getTree(owner, repo, ref)
      .then((result) => result.data)
      .catch((error) => {
        repoTreeCache.delete(key);
        throw error;
      });
    repoTreeCache.set(key, tree);
  }
  return tree;
}

/**
 * Contents API 单文件上限 1MB；超过时回退到 Git Blobs API（100MB）。
 * 文件树请求按仓库+ref 缓存，多张图片共用。
 */
async function fetchRepoImage(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  try {
    return await api.getContentRaw(owner, repo, path, ref, signal);
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 403) throw error;

    const tree = await loadRepoTree(owner, repo, ref);
    if (tree.truncated) throw error;

    const entry = tree.tree.find((item) => item.type === 'blob' && item.path === path);
    if (!entry) throw error;
    return api.getBlob(owner, repo, entry.sha, signal);
  }
}

export interface HydrateRepoImagesOptions {
  owner: string;
  repo: string;
  ref: string;
  signal?: AbortSignal;
}

/**
 * 把 README 里的仓库内图片通过内容 API 取回，替换成 blob URL。
 *
 * 之所以不直接把相对路径改成 raw.githubusercontent.com：本项目面向的网络里
 * github.com / raw.githubusercontent.com 经常被阻断，而 api.github.com 可达。
 * 顺带也能让私有仓库的图片在携带 Token 的请求下正常显示。
 *
 * 返回清理函数：取消未完成的请求并释放 blob URL。
 */
export function hydrateRepoImages(
  container: HTMLElement,
  options: HydrateRepoImagesOptions,
): () => void {
  const allImages = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-repo-image]'));
  if (allImages.length === 0) return () => {};
  if (options.signal?.aborted) return () => {};

  const images = allImages.slice(0, MAX_REPO_IMAGES);
  allImages.slice(MAX_REPO_IMAGES).forEach((image) => {
    image.removeAttribute('data-repo-image');
    image.title = 'README 图片过多，已跳过';
  });

  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  options.signal?.addEventListener('abort', relayAbort, { once: true });

  const objectUrls: string[] = [];
  const cached = new Map<string, Promise<Uint8Array>>();
  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (controller.signal.aborted) return;
      const image = images[cursor];
      cursor += 1;
      if (!image) return;

      const path = image.getAttribute('data-repo-image');
      if (!path) continue;
      const ref = image.getAttribute('data-repo-ref') ?? options.ref;
      const key = `${ref}\u0000${path}`;

      try {
        let request = cached.get(key);
        if (!request) {
          request = fetchRepoImage(options.owner, options.repo, ref, path, controller.signal);
          cached.set(key, request);
        }
        const bytes = await request;
        if (controller.signal.aborted) return;

        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(path) }));
        objectUrls.push(url);
        image.src = url;
        image.classList.remove('readme-image-pending');
        image.removeAttribute('data-repo-image');
        image.removeAttribute('data-repo-ref');
      } catch {
        if (controller.signal.aborted) return;
        image.classList.remove('readme-image-pending');
        image.classList.add('readme-image-error');
        image.removeAttribute('data-repo-image');
        image.removeAttribute('data-repo-ref');
        image.title = '图片加载失败';
      }
    }
  };

  const concurrency = Math.min(4, images.length);
  void Promise.all(Array.from({ length: concurrency }, () => worker())).catch(() => {});

  return () => {
    options.signal?.removeEventListener('abort', relayAbort);
    controller.abort();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  };
}

/**
 * README 来自任意仓库，属于不可信内容。
 * 先交给 marked 渲染，再用 DOM 解析器做一次白名单清洗，避免注入脚本。
 * 传入仓库上下文时，还会把相对图片标记为待加载、把相对链接改写为 GitHub 页面链接。
 */
export function renderMarkdown(source: string, context?: MarkdownContext): string {
  const html = marked.parse(source, { async: false });
  const document = new DOMParser().parseFromString(html, 'text/html');
  sanitize(document.body);

  if (context) {
    prepareLinks(document.body, context);
    prepareImages(document.body, context);
  }

  return document.body.innerHTML;
}
