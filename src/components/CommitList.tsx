import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { firstLine, formatDate, relativeTime, shortSha } from '../lib/format';
import { EmptyState, ErrorState, SkeletonList, Spinner } from './State';

const MAX_PATCH_LINES = 300;

function CommitDetailPanel({ owner, repo, sha }: { owner: string; repo: string; sha: string }) {
  const detail = useQuery({
    queryKey: ['commit', owner, repo, sha],
    queryFn: () => api.getCommit(owner, repo, sha),
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (detail.isLoading) return <Spinner label="加载变更详情…" />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return null;

  const files = detail.data.files ?? [];
  const stats = detail.data.stats;

  return (
    <div className="commit-detail">
      <div className="commit-detail-head">
        <span className="muted small">提交信息</span>
        <pre className="commit-message">{detail.data.commit.message}</pre>
        <div className="commit-detail-meta small muted">
          <span>
            {detail.data.commit.author?.name ?? '未知作者'} ·{' '}
            {detail.data.commit.author ? formatDate(detail.data.commit.author.date) : '—'}
          </span>
          {stats ? (
            <span className="diff-stat">
              <b className="add">+{stats.additions}</b> <b className="del">−{stats.deletions}</b>
            </span>
          ) : null}
        </div>
      </div>

      {files.length === 0 ? <p className="muted small">这个提交没有文件变更（可能是合并提交）。</p> : null}

      {files.map((file) => {
        const patchLines = file.patch ? file.patch.split('\n') : [];
        return (
          <div className="diff-file" key={file.filename}>
            <div className="diff-file-head">
              <span className="mono diff-name">{file.filename}</span>
              <span className="small muted">
                {file.status} · <b className="add">+{file.additions}</b> <b className="del">−{file.deletions}</b>
              </span>
            </div>

            {patchLines.length > 0 ? (
              <pre className="diff-patch">
                {patchLines.slice(0, MAX_PATCH_LINES).map((line, index) => {
                  let className = 'diff-line';
                  if (line.startsWith('+') && !line.startsWith('+++')) className += ' diff-add';
                  else if (line.startsWith('-') && !line.startsWith('---')) className += ' diff-del';
                  else if (line.startsWith('@@')) className += ' diff-hunk';
                  return (
                    <div className={className} key={index}>
                      {line || ' '}
                    </div>
                  );
                })}
              </pre>
            ) : (
              <p className="muted small pad">二进制文件或变更过大，未提供 diff。</p>
            )}

            {patchLines.length > MAX_PATCH_LINES ? (
              <p className="muted small pad">diff 过长，仅显示前 {MAX_PATCH_LINES} 行。</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function CommitList({ owner, repo }: { owner: string; repo: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['commits', owner, repo],
    queryFn: ({ pageParam }) => api.listCommits(owner, repo, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 60_000,
  });

  const commits = query.data?.pages.flatMap((page) => page.data) ?? [];

  if (query.isLoading) return <SkeletonList rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  if (commits.length === 0) {
    return <EmptyState title="还没有提交" hint="这个仓库是空的，或者默认分支上没有任何提交。" />;
  }

  return (
    <div className="commit-list">
      {commits.map((commit) => {
        const isOpen = expanded === commit.sha;
        return (
          <div className={`commit-item${isOpen ? ' open' : ''}`} key={commit.sha}>
            <button
              type="button"
              className="commit-row"
              onClick={() => setExpanded(isOpen ? null : commit.sha)}
              aria-expanded={isOpen}
            >
              {commit.author ? (
                <img className="avatar" src={commit.author.avatar_url} alt="" width={28} height={28} />
              ) : (
                <span className="avatar avatar-fallback" aria-hidden="true">
                  {commit.commit.author?.name?.slice(0, 1).toUpperCase() ?? '?'}
                </span>
              )}

              <span className="commit-main">
                <span className="commit-title">{firstLine(commit.commit.message)}</span>
                <span className="commit-sub small muted">
                  {commit.commit.author?.name ?? '未知作者'} · {relativeTime(commit.commit.author?.date ?? '')}
                </span>
              </span>

              <code className="sha">{shortSha(commit.sha)}</code>
            </button>

            {isOpen ? <CommitDetailPanel owner={owner} repo={repo} sha={commit.sha} /> : null}
          </div>
        );
      })}

      {query.hasNextPage ? (
        <button
          type="button"
          className="btn btn-ghost load-more"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? '加载中…' : '加载更多提交'}
        </button>
      ) : null}
    </div>
  );
}
