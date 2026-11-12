import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import RepoCard from '../components/RepoCard';
import { EmptyState, ErrorState, SkeletonList } from '../components/State';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 600;
const PAGE_SIZE = 30;
/** GitHub Search API 最多只返回前 1000 条结果 */
const RESULT_CAP = 1000;

const EXAMPLES = [
  'react language:TypeScript',
  'user:microsoft',
  'org:vercel stars:>10000',
  'topic:cli language:Go',
];

const numberFormat = new Intl.NumberFormat('zh-CN');

export default function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => setQuery(trimmed), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  const search = useInfiniteQuery({
    queryKey: ['repo-search', query],
    queryFn: ({ pageParam }) => api.searchRepos(query, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: query.length >= MIN_QUERY_LENGTH,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => {
    const seen = new Set<number>();
    return (
      search.data?.pages
        .flatMap((page) => page.data.items)
        .filter((repo) => {
          if (seen.has(repo.id)) return false;
          seen.add(repo.id);
          return true;
        }) ?? []
    );
  }, [search.data]);

  const totalCount = search.data?.pages[0]?.data.total_count ?? 0;
  const incomplete = search.data?.pages.some((page) => page.data.incomplete_results) ?? false;
  const showResults = query.length >= MIN_QUERY_LENGTH;
  const isNewSearch = search.isPlaceholderData || (search.isFetching && !search.isFetchingNextPage);
  const hasMore = Boolean(search.hasNextPage) && items.length < RESULT_CAP;

  const submit = () => {
    const trimmed = input.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    // 输入已经对应当前结果时无需重复请求，避免消耗搜索配额
    if (trimmed !== query) setQuery(trimmed);
  };

  const runExample = (example: string) => {
    setInput(example);
    setQuery(example);
  };

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>搜索仓库</h1>
          <p className="muted">
            搜索 GitHub 上的公开仓库，支持 <code>user:</code>、<code>org:</code>、
            <code>language:</code>、<code>stars:&gt;N</code> 等限定词。
          </p>
        </div>
      </section>

      <form
        className="search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          className="input search-input"
          type="search"
          placeholder="搜索仓库，例如 react language:TypeScript"
          aria-label="搜索仓库"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={input.trim().length < MIN_QUERY_LENGTH}>
          搜索
        </button>
      </form>

      <div className="search-examples">
        <span className="muted small">试试：</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="search-example"
            onClick={() => runExample(example)}
          >
            {example}
          </button>
        ))}
      </div>

      {!showResults ? (
        <EmptyState
          title="搜索全站仓库"
          hint={`输入至少 ${MIN_QUERY_LENGTH} 个字符开始搜索；搜索有独立的 30 次/分钟配额，结果最多展示前 ${RESULT_CAP} 条。`}
        />
      ) : null}

      {showResults && search.isLoading ? <SkeletonList rows={6} /> : null}

      {showResults && search.isError ? (
        <ErrorState error={search.error} onRetry={() => search.refetch()} />
      ) : null}

      {showResults && !search.isLoading && !search.isError && search.data ? (
        <>
          <div className="search-summary">
            {isNewSearch ? (
              <span className="muted small">搜索中…</span>
            ) : (
              <span>
                约 <strong>{numberFormat.format(totalCount)}</strong> 个结果
              </span>
            )}
            <span className="muted small">
              最多展示前 {RESULT_CAP} 条 · 搜索配额 30 次/分钟
            </span>
          </div>

          {incomplete ? (
            <p className="search-warning">
              GitHub 搜索超时，结果可能不完整；缩小关键词范围或加限定词后重试。
            </p>
          ) : null}

          {items.length === 0 && !isNewSearch ? (
            <EmptyState
              title="没有找到匹配的仓库"
              hint="试试更短的关键词，或者用 user:/org: 指定作者、用 language: 指定语言。"
            />
          ) : null}

          {items.length > 0 ? (
            <div className="repo-grid" aria-busy={isNewSearch}>
              {items.map((repo) => (
                <RepoCard repo={repo} key={repo.id} showOwner />
              ))}
            </div>
          ) : null}

          {hasMore ? (
            <button
              type="button"
              className="btn btn-ghost load-more"
              disabled={isNewSearch || search.isFetchingNextPage}
              onClick={() => search.fetchNextPage()}
            >
              {search.isFetchingNextPage ? '加载中…' : '加载更多结果'}
            </button>
          ) : null}

          {items.length >= RESULT_CAP ? (
            <p className="muted small search-cap">
              已达到 GitHub 搜索的 {RESULT_CAP} 条结果上限，请加限定词缩小范围。
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
