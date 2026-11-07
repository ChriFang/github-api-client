import type {
  CommitDetail,
  CommitListItem,
  ContentFile,
  CreateRepoInput,
  GitHubUser,
  RateLimitInfo,
  Repo,
  TreeResponse,
} from './types';

/**
 * 默认直连 api.github.com；设置 VITE_API_BASE 可指向自建反代或本地 mock，
 * 便于在 GitHub 连通性差的环境下调试。
 */
const ENV = import.meta.env as Record<string, string | undefined> | undefined;
const BASE_URL = (ENV?.VITE_API_BASE ?? 'https://api.github.com').replace(/\/+$/, '');

export type ErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'network'
  | 'unknown';

export class GitHubError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  readonly resetAt?: number;
  readonly details?: unknown;

  constructor(
    kind: ErrorKind,
    message: string,
    status = 0,
    extra: { resetAt?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
    this.resetAt = extra.resetAt;
    this.details = extra.details;
  }
}

export interface Paged<T> {
  data: T;
  nextPage: number | null;
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  etagCache.clear();
}

/* ---------- 条件请求缓存：304 不消耗配额，能让重复浏览几乎零成本 ---------- */

interface CacheEntry {
  etag: string;
  data: unknown;
  nextPage: number | null;
}

const etagCache = new Map<string, CacheEntry>();
const ETAG_CACHE_LIMIT = 200;

function rememberEtag(url: string, entry: CacheEntry): void {
  if (etagCache.size >= ETAG_CACHE_LIMIT) {
    const oldest = etagCache.keys().next().value;
    if (oldest !== undefined) etagCache.delete(oldest);
  }
  etagCache.set(url, entry);
}

/* ---------- 配额订阅，供界面显示 remaining ---------- */

type RateLimitListener = (info: RateLimitInfo) => void;
const rateLimitListeners = new Set<RateLimitListener>();

export function subscribeRateLimit(listener: RateLimitListener): () => void {
  rateLimitListeners.add(listener);
  return () => {
    rateLimitListeners.delete(listener);
  };
}

function emitRateLimit(headers: Headers): void {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return;
  const info: RateLimitInfo = { limit, remaining, reset };
  rateLimitListeners.forEach((listener) => listener(info));
}

/* ---------- 鉴权失效广播：任意请求返回 401 时通知应用剔除失效账号 ---------- */

type AuthFailureListener = (token: string | null) => void;
const authFailureListeners = new Set<AuthFailureListener>();

export function onAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

function notifyAuthFailure(token: string | null): void {
  authFailureListeners.forEach((listener) => listener(token));
}

/* ---------- 请求核心 ---------- */

interface RequestConfig {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  token?: string | null;
  allow404?: boolean;
}

const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNextPage(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    const match = part.match(/<([^>]+)>/);
    if (!match) continue;
    try {
      const page = new URL(match[1]).searchParams.get('page');
      return page ? Number(page) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function toError(response: Response): Promise<GitHubError> {
  let body: { message?: string; errors?: Array<{ message?: string }> } | null = null;
  try {
    body = (await response.json()) as { message?: string; errors?: Array<{ message?: string }> };
  } catch {
    body = null;
  }

  const baseMessage = typeof body?.message === 'string' ? body.message : '';
  const detail = Array.isArray(body?.errors)
    ? body.errors.map((item) => item.message).filter(Boolean).join('；')
    : '';
  const message = detail || baseMessage || `请求失败（HTTP ${response.status}）`;

  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetAt = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000 || undefined;

  if (response.status === 401) {
    return new GitHubError('auth', 'Token 无效或已过期，请重新登录', 401, { details: body });
  }
  if (response.status === 403 && remaining === '0') {
    return new GitHubError('rate-limit', 'API 配额已用完，请稍后再试', 403, { resetAt, details: body });
  }
  if (response.status === 403) {
    return new GitHubError('forbidden', `权限不足：${message}`, 403, { details: body });
  }
  if (response.status === 404) {
    return new GitHubError('not-found', '资源不存在，或当前 Token 无权访问', 404, { details: body });
  }
  if (response.status === 422) {
    return new GitHubError('validation', message, 422, { details: body });
  }
  return new GitHubError('unknown', message, response.status, { details: body });
}

async function request<T>(path: string, config: RequestConfig = {}): Promise<Paged<T>> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = config.method ?? 'GET';
  const token = config.token !== undefined ? config.token : authToken;

  for (let attempt = 0; ; attempt += 1) {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (config.body !== undefined) headers['Content-Type'] = 'application/json';

    const cached = etagCache.get(url);
    if (method === 'GET' && cached) headers['If-None-Match'] = cached.etag;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
        signal: config.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (attempt < MAX_RETRIES) {
        await sleep(400 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      throw new GitHubError(
        'network',
        '无法连接 api.github.com：请检查网络、代理或 DNS 设置后重试',
        0,
      );
    }

    emitRateLimit(response.headers);

    if (response.status === 304 && cached) {
      return { data: cached.data as T, nextPage: cached.nextPage };
    }

    if (!response.ok) {
      const failure = await toError(response);
      if (failure.kind === 'auth') notifyAuthFailure(token ?? null);
      if (failure.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(400 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      throw failure;
    }

    const nextPage = parseNextPage(response.headers.get('link'));
    const data = (response.status === 204 ? undefined : await response.json()) as T;

    if (method === 'GET') {
      const etag = response.headers.get('etag');
      if (etag) rememberEtag(url, { etag, data, nextPage });
    }

    return { data, nextPage };
  }
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

/* ---------- 对外 API ---------- */

export const api = {
  async getUser(token?: string): Promise<GitHubUser> {
    const result = await request<GitHubUser>('/user', { token });
    return result.data;
  },

  listRepos(page: number, perPage = 30): Promise<Paged<Repo[]>> {
    const query = new URLSearchParams({
      affiliation: 'owner,collaborator,organization_member',
      sort: 'updated',
      direction: 'desc',
      per_page: String(perPage),
      page: String(page),
    });
    return request<Repo[]>(`/user/repos?${query.toString()}`);
  },

  async getRepo(owner: string, repo: string): Promise<Repo> {
    const result = await request<Repo>(`/repos/${owner}/${repo}`);
    return result.data;
  },

  getTree(owner: string, repo: string, ref: string): Promise<Paged<TreeResponse>> {
    return request<TreeResponse>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  },

  async getReadme(owner: string, repo: string): Promise<ContentFile> {
    const result = await request<ContentFile>(`/repos/${owner}/${repo}/readme`);
    return result.data;
  },

  async getContent(owner: string, repo: string, path: string, ref?: string): Promise<ContentFile> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const result = await request<ContentFile>(`/repos/${owner}/${repo}/contents/${encodePath(path)}${suffix}`);
    return result.data;
  },

  listCommits(owner: string, repo: string, page: number, perPage = 30): Promise<Paged<CommitListItem[]>> {
    const query = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    return request<CommitListItem[]>(`/repos/${owner}/${repo}/commits?${query.toString()}`);
  },

  async getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail> {
    const result = await request<CommitDetail>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`);
    return result.data;
  },

  async createRepo(input: CreateRepoInput): Promise<Repo> {
    const result = await request<Repo>('/user/repos', { method: 'POST', body: input });
    return result.data;
  },
};

/* ---------- 内容解码 ---------- */

export function decodeContent(file: ContentFile): string {
  if (file.encoding === 'base64' && file.content) {
    const binary = atob(file.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }
  return file.content ?? '';
}
