import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import RepoCard from '../components/RepoCard';
import { EmptyState, ErrorState, SkeletonList } from '../components/State';

export default function ReposPage() {
  const { user } = useAuth();
  const [keyword, setKeyword] = useState('');

  const query = useInfiniteQuery({
    queryKey: ['repos'],
    queryFn: ({ pageParam }) => api.listRepos(pageParam, 30),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 60_000,
  });

  const repos = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter((repo) =>
      `${repo.full_name} ${repo.description ?? ''} ${repo.language ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [repos, keyword]);

  const privateCount = repos.filter((repo) => repo.private).length;

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>你好，{user?.name ?? user?.login ?? '开发者'}</h1>
          <p className="muted">
            已加载 {repos.length} 个仓库 · {privateCount} 个私有
            {query.hasNextPage ? ' · 还有更多' : ''}
          </p>
        </div>
        <Link to="/new" className="btn btn-primary">
          新建仓库
        </Link>
      </section>

      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="按名称、描述或语言筛选…"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        {keyword ? <span className="muted small">匹配 {visible.length} 个</span> : null}
      </div>

      {query.isLoading ? <SkeletonList rows={6} /> : null}

      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {!query.isLoading && !query.isError && visible.length === 0 ? (
        keyword ? (
          <EmptyState title="没有匹配的仓库" hint="换个关键词试试。" />
        ) : (
          <EmptyState
            title="还没有仓库"
            hint="创建第一个仓库，或者去 GitHub 上建一个再回来刷新。"
            action={
              <Link to="/new" className="btn btn-primary">
                新建仓库
              </Link>
            }
          />
        )
      ) : null}

      {visible.length > 0 ? (
        <div className="repo-grid">
          {visible.map((repo) => (
            <RepoCard repo={repo} key={repo.id} />
          ))}
        </div>
      ) : null}

      {query.hasNextPage && !keyword ? (
        <button
          type="button"
          className="btn btn-ghost load-more"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? '加载中…' : '加载更多仓库'}
        </button>
      ) : null}
    </div>
  );
}
