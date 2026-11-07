import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { decodeContent } from '../lib/api';
import { formatBytes, relativeTime } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import FileBrowser from '../components/FileBrowser';
import CommitList from '../components/CommitList';
import RepoAddressMenu from '../components/RepoAddressMenu';
import { ErrorState, SkeletonList } from '../components/State';

function ReadmeCard({ owner, repo, branch }: { owner: string; repo: string; branch: string }) {
  const readme = useQuery({
    queryKey: ['readme', owner, repo, branch],
    queryFn: () => api.getReadme(owner, repo),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const html = useMemo(() => {
    if (!readme.data) return null;
    const decoded = decodeContent(readme.data);
    if (!decoded.trim()) return null;
    return renderMarkdown(decoded);
  }, [readme.data]);

  if (readme.isLoading) {
    return (
      <div className="card readme-card">
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (readme.isError || !html) return null;

  return (
    <div className="card readme-card">
      <div className="card-head">
        <span className="muted small">
          README · <code>{readme.data?.name}</code>
        </span>
      </div>
      <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default function RepoPage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'commits' ? 'commits' : 'code';

  const repoQuery = useQuery({
    queryKey: ['repo', owner, repo],
    queryFn: () => api.getRepo(owner, repo),
    enabled: Boolean(owner && repo),
    retry: false,
    staleTime: 60_000,
  });

  if (repoQuery.isLoading) return <SkeletonList rows={4} />;
  if (repoQuery.isError) return <ErrorState error={repoQuery.error} onRetry={() => repoQuery.refetch()} />;
  if (!repoQuery.data) return null;

  const detail = repoQuery.data;

  return (
    <div className="stack">
      <section className="repo-head">
        <div className="breadcrumb small muted">
          <Link to="/">仓库</Link>
          <span className="sep">/</span>
          <span>{owner}</span>
          <span className="sep">/</span>
          <span className="current">{repo}</span>
        </div>

        <div className="repo-title-row">
          <h1 className="repo-title">
            {detail.name}
            {detail.private ? <span className="badge badge-private">私有</span> : null}
          </h1>
          <RepoAddressMenu repo={detail} />
        </div>

        <p className="repo-desc">{detail.description?.trim() || '暂无描述'}</p>

        <div className="repo-meta">
          <span className="meta-item mono">{detail.default_branch}</span>
          {detail.language ? (
            <span className="meta-item">
              <i className="lang-dot" aria-hidden="true" />
              {detail.language}
            </span>
          ) : null}
          <span className="meta-item">★ {detail.stargazers_count}</span>
          <span className="meta-item">⑂ {detail.forks_count}</span>
          <span className="meta-item">大小 {formatBytes(detail.size * 1024)}</span>
          <span className="meta-item muted">更新于 {relativeTime(detail.pushed_at)}</span>
        </div>
      </section>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'code'}
          className={`tab${tab === 'code' ? ' active' : ''}`}
          onClick={() => setSearchParams({})}
        >
          代码
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'commits'}
          className={`tab${tab === 'commits' ? ' active' : ''}`}
          onClick={() => setSearchParams({ tab: 'commits' })}
        >
          提交记录
        </button>
      </div>

      {tab === 'code' ? (
        <>
          <ReadmeCard owner={owner} repo={repo} branch={detail.default_branch} />
          <FileBrowser owner={owner} repo={repo} branch={detail.default_branch} />
        </>
      ) : (
        <CommitList owner={owner} repo={repo} />
      )}
    </div>
  );
}
