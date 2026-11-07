import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, decodeContent } from '../lib/api';
import type { ContentFile } from '../lib/types';
import { formatBytes } from '../lib/format';
import { EmptyState, ErrorState, SkeletonList, Spinner } from './State';

const MAX_RENDERED_LINES = 4000;
const MAX_FILE_CHARS = 400_000;
const MAX_LISTED_FILES = 800;

function CodeView({ file }: { file: ContentFile }) {
  const text = decodeContent(file);
  const isBinary = file.encoding !== 'base64' && !text;
  const tooLarge = text.length > MAX_FILE_CHARS;
  const allLines = tooLarge ? [] : text.split('\n');
  const lines = allLines.slice(0, MAX_RENDERED_LINES);

  if (isBinary) {
    return (
      <div className="state-box">
        <div className="state-icon" aria-hidden="true">
          ⌘
        </div>
        <div>
          <h3>二进制文件</h3>
          <p className="muted">该文件无法以文本形式预览（{formatBytes(file.size)}）。</p>
        </div>
      </div>
    );
  }

  if (tooLarge) {
    return (
      <div className="state-box">
        <div className="state-icon" aria-hidden="true">
          ⤢
        </div>
        <div>
          <h3>文件太大</h3>
          <p className="muted">
            文件 {formatBytes(file.size)}，超过 {Math.round(MAX_FILE_CHARS / 1000)} 千字符的预览上限。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="code-panel">
      <div className="code-head">
        <span className="mono code-path">{file.path}</span>
        <span className="muted small">
          {formatBytes(file.size)} · {allLines.length} 行
        </span>
      </div>

      <div className="code-body">
        {lines.map((line, index) => (
          <div className="code-line" key={index}>
            <span className="line-no">{index + 1}</span>
            <span className="line-text">{line === '' ? ' ' : line}</span>
          </div>
        ))}
      </div>

      {allLines.length > MAX_RENDERED_LINES ? (
        <p className="muted small code-truncated">
          仅渲染前 {MAX_RENDERED_LINES} 行（共 {allLines.length} 行）。
        </p>
      ) : null}
    </div>
  );
}

export default function FileBrowser({
  owner,
  repo,
  branch,
}: {
  owner: string;
  repo: string;
  branch: string;
}) {
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: ['tree', owner, repo, branch],
    queryFn: () => api.getTree(owner, repo, branch),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const files = useMemo(() => {
    const entries = treeQuery.data?.data.tree ?? [];
    return entries
      .filter((entry) => entry.type === 'blob')
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [treeQuery.data]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, keyword]);

  const contentQuery = useQuery({
    queryKey: ['content', owner, repo, selected, branch],
    queryFn: () => api.getContent(owner, repo, selected as string, branch),
    enabled: selected !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="browser">
      <aside className="browser-list">
        <input
          className="input input-sm"
          type="search"
          placeholder="搜索文件路径…"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />

        <div className="file-list">
          {treeQuery.isLoading ? <SkeletonList rows={8} /> : null}
          {treeQuery.isError ? (
            <ErrorState error={treeQuery.error} onRetry={() => treeQuery.refetch()} />
          ) : null}

          {!treeQuery.isLoading && !treeQuery.isError && filtered.length === 0 ? (
            <p className="muted small pad">没有匹配的文件</p>
          ) : null}

          {filtered.slice(0, MAX_LISTED_FILES).map((file) => {
            const slash = file.path.lastIndexOf('/');
            const dir = slash >= 0 ? file.path.slice(0, slash + 1) : '';
            const base = slash >= 0 ? file.path.slice(slash + 1) : file.path;
            return (
              <button
                key={file.path}
                type="button"
                className={`file-row${selected === file.path ? ' active' : ''}`}
                onClick={() => setSelected(file.path)}
                title={file.path}
              >
                <span className="file-name mono">
                  {dir ? <span className="file-dir">{dir}</span> : null}
                  <span className="file-base">{base}</span>
                </span>
                <span className="file-size muted">{formatBytes(file.size)}</span>
              </button>
            );
          })}

          {filtered.length > MAX_LISTED_FILES ? (
            <p className="muted small pad">
              共 {filtered.length} 个文件，仅列出前 {MAX_LISTED_FILES} 个，用搜索缩小范围。
            </p>
          ) : null}
        </div>

        {treeQuery.data?.data.truncated ? (
          <p className="small warn pad">仓库文件过多，服务端已截断文件树。</p>
        ) : null}
      </aside>

      <section className="browser-view">
        {!selected ? (
          <EmptyState title="选择左侧文件查看内容" hint="文件通过 Contents API 按需读取，不克隆整个仓库。" />
        ) : null}

        {selected && contentQuery.isLoading ? <Spinner label="读取文件…" /> : null}

        {selected && contentQuery.isError ? (
          <ErrorState error={contentQuery.error} onRetry={() => contentQuery.refetch()} />
        ) : null}

        {selected && contentQuery.data ? <CodeView file={contentQuery.data} /> : null}
      </section>
    </div>
  );
}
