import type { ReactNode } from 'react';
import { GitHubError } from '../lib/api';
import { formatDate } from '../lib/format';

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  let title = '出了点问题';
  let hint = '请稍后重试。';

  if (error instanceof GitHubError) {
    switch (error.kind) {
      case 'auth':
        title = '登录已失效';
        hint = 'Token 无效或已过期，请重新登录。';
        break;
      case 'rate-limit':
        title = 'API 配额已用完';
        hint = error.resetAt
          ? `配额将在 ${formatDate(new Date(error.resetAt).toISOString())} 重置。`
          : '请稍后再试。';
        break;
      case 'search-limit':
        title = '搜索配额已用完';
        hint = error.resetAt
          ? `Search API 限制为每分钟 30 次，配额将在 ${formatDate(new Date(error.resetAt).toISOString())} 重置。`
          : 'Search API 限制为每分钟 30 次，请等一分钟再试。';
        break;
      case 'secondary-limit':
        title = '请求过于频繁';
        hint = error.resetAt
          ? `GitHub 暂时限制了请求频率，${formatDate(new Date(error.resetAt).toISOString())} 后重试。`
          : 'GitHub 暂时限制了请求频率，请等几分钟再试；下载大仓库时会逐文件请求，更容易触发。';
        break;
      case 'network':
        title = '连不上 api.github.com';
        hint = '检查网络连接；如果你在中国大陆，GitHub 的连通性可能波动，稍后重试。';
        break;
      case 'not-found':
        title = '找不到这个资源';
        hint = '仓库可能已删除、改名，或当前 Token 没有访问权限。';
        break;
      case 'forbidden':
        title = '权限不足';
        hint = '请在 Token 中勾选 repo 权限（细粒度 Token 需要 Contents / Administration 读写）。';
        break;
      case 'validation':
        title = '请求不合法';
        hint = error.message;
        break;
      default:
        hint = error.message;
    }
  }

  return (
    <div className="state-box state-error">
      <div className="state-icon" aria-hidden="true">
        !
      </div>
      <div>
        <h3>{title}</h3>
        <p className="muted">{hint}</p>
        {onRetry ? (
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            重试
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-box">
      <div className="state-icon" aria-hidden="true">
        ∅
      </div>
      <div>
        <h3>{title}</h3>
        {hint ? <p className="muted">{hint}</p> : null}
        {action}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <div className="skeleton skeleton-line" style={{ width: `${40 + ((index * 13) % 45)}%` }} />
          <div className="skeleton skeleton-line skeleton-dim" style={{ width: `${20 + ((index * 7) % 30)}%` }} />
        </div>
      ))}
    </div>
  );
}
