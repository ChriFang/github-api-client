import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, decodeContent } from '../lib/api';
import type { ContentFile, TreeEntry } from '../lib/types';
import { formatBytes } from '../lib/format';
import { EmptyState, ErrorState, SkeletonList, Spinner } from './State';

const MAX_RENDERED_LINES = 4000;
const MAX_FILE_CHARS = 400_000;
const MAX_LISTED_FILES = 800;
const MAX_CHILDREN = 200;

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

/* ---------- 文件树 ---------- */

interface MutableDir {
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  files: TreeEntry[];
  submodules: TreeEntry[];
}

interface BrowserFileNode {
  kind: 'file' | 'submodule';
  name: string;
  path: string;
  entry: TreeEntry;
}

interface BrowserDirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: BrowserNode[];
}

type BrowserNode = BrowserDirNode | BrowserFileNode;

function toBrowserNodes(dir: MutableDir): BrowserNode[] {
  const dirs: BrowserDirNode[] = Array.from(dir.dirs.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      kind: 'dir',
      name: child.name,
      path: child.path,
      children: toBrowserNodes(child),
    }));

  const leaves: BrowserFileNode[] = [
    ...dir.files.map((entry) => ({
      kind: 'file' as const,
      name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
      path: entry.path,
      entry,
    })),
    ...dir.submodules.map((entry) => ({
      kind: 'submodule' as const,
      name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
      path: entry.path,
      entry,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return [...dirs, ...leaves];
}

function buildBrowserTree(entries: TreeEntry[]): BrowserNode[] {
  const root: MutableDir = { name: '', path: '', dirs: new Map(), files: [], submodules: [] };

  const ensureDir = (path: string): MutableDir => {
    let node = root;
    if (!path) return node;

    let currentPath = '';
    for (const segment of path.split('/')) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = node.dirs.get(segment);
      if (!child) {
        child = { name: segment, path: currentPath, dirs: new Map(), files: [], submodules: [] };
        node.dirs.set(segment, child);
      }
      node = child;
    }
    return node;
  };

  for (const entry of entries) {
    if (!entry.path) continue;
    if (entry.type === 'tree') {
      ensureDir(entry.path);
      continue;
    }
    if (entry.type !== 'blob' && entry.type !== 'commit') continue;

    const slash = entry.path.lastIndexOf('/');
    const parent = ensureDir(slash >= 0 ? entry.path.slice(0, slash) : '');
    if (entry.type === 'commit') parent.submodules.push(entry);
    else parent.files.push(entry);
  }

  return toBrowserNodes(root);
}

function ancestorPaths(path: string): string[] {
  const segments = path.split('/');
  const result: string[] = [];
  for (let i = 1; i < segments.length; i += 1) result.push(segments.slice(0, i).join('/'));
  return result;
}

function TreeNodeRows({
  nodes,
  depth,
  expanded,
  showAll,
  selected,
  onToggle,
  onSelect,
  onShowAll,
}: {
  nodes: BrowserNode[];
  depth: number;
  expanded: Set<string>;
  showAll: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onShowAll: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const indent = 8 + depth * 14;

        if (node.kind === 'dir') {
          const open = expanded.has(node.path);
          const allVisible = showAll.has(node.path);
          const children = allVisible ? node.children : node.children.slice(0, MAX_CHILDREN);
          const remaining = node.children.length - MAX_CHILDREN;

          return (
            <Fragment key={node.path}>
              <button
                type="button"
                className="file-row dir-row"
                style={{ paddingLeft: indent }}
                aria-expanded={open}
                onClick={() => onToggle(node.path)}
                title={node.path}
              >
                <span className="file-name">
                  <span className="tree-caret" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="file-base">{node.name}</span>
                </span>
                <span className="file-size muted">{node.children.length}</span>
              </button>

              {open ? (
                <TreeNodeRows
                  nodes={children}
                  depth={depth + 1}
                  expanded={expanded}
                  showAll={showAll}
                  selected={selected}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onShowAll={onShowAll}
                />
              ) : null}

              {open && !allVisible && remaining > 0 ? (
                <button
                  type="button"
                  className="file-more"
                  style={{ paddingLeft: indent + 18 }}
                  onClick={() => onShowAll(node.path)}
                >
                  显示更多（剩余 {remaining} 项）
                </button>
              ) : null}
            </Fragment>
          );
        }

        if (node.kind === 'submodule') {
          return (
            <button
              key={node.path}
              type="button"
              className="file-row"
              style={{ paddingLeft: indent }}
              disabled
              title={`${node.path}（子模块，暂不支持预览）`}
            >
              <span className="file-name mono">
                <span className="file-base">{node.name}</span>
              </span>
              <span className="file-size muted">子模块</span>
            </button>
          );
        }

        return (
          <button
            key={node.path}
            type="button"
            className={`file-row${selected === node.path ? ' active' : ''}`}
            style={{ paddingLeft: indent }}
            onClick={() => onSelect(node.path)}
            title={node.path}
          >
            <span className="file-name mono">
              <span className="file-base">{node.name}</span>
            </span>
            <span className="file-size muted">{formatBytes(node.entry.size)}</span>
          </button>
        );
      })}
    </>
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());

  // 切换到另一个仓库/分支时，清空折叠与选中状态
  useEffect(() => {
    setKeyword('');
    setSelected(null);
    setExpanded(new Set());
    setShowAll(new Set());
  }, [owner, repo, branch]);

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

  const treeNodes = useMemo(
    () => buildBrowserTree(treeQuery.data?.data.tree ?? []),
    [treeQuery.data],
  );

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, keyword]);

  const searching = keyword.trim().length > 0;

  const contentQuery = useQuery({
    queryKey: ['content', owner, repo, selected, branch],
    queryFn: () => api.getContent(owner, repo, selected as string, branch),
    enabled: selected !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const toggleFolder = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const showAllChildren = (path: string) => {
    setShowAll((previous) => new Set(previous).add(path));
  };

  const selectFile = (path: string) => {
    setSelected(path);
    setExpanded((previous) => {
      const next = new Set(previous);
      ancestorPaths(path).forEach((ancestor) => next.add(ancestor));
      return next;
    });
  };

  const rootVisible = showAll.has('') ? treeNodes : treeNodes.slice(0, MAX_CHILDREN);

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

          {!treeQuery.isLoading && !treeQuery.isError && !searching && treeNodes.length === 0 ? (
            <p className="muted small pad">仓库没有可显示的文件</p>
          ) : null}

          {!treeQuery.isLoading && !treeQuery.isError && searching && filtered.length === 0 ? (
            <p className="muted small pad">没有匹配的文件</p>
          ) : null}

          {!searching ? (
            <>
              {rootVisible.length > 0 ? (
                <TreeNodeRows
                  nodes={rootVisible}
                  depth={0}
                  expanded={expanded}
                  showAll={showAll}
                  selected={selected}
                  onToggle={toggleFolder}
                  onSelect={selectFile}
                  onShowAll={showAllChildren}
                />
              ) : null}

              {!showAll.has('') && treeNodes.length > MAX_CHILDREN ? (
                <button
                  type="button"
                  className="file-more"
                  style={{ paddingLeft: 26 }}
                  onClick={() => showAllChildren('')}
                >
                  显示更多（剩余 {treeNodes.length - MAX_CHILDREN} 项）
                </button>
              ) : null}
            </>
          ) : (
            filtered.slice(0, MAX_LISTED_FILES).map((file) => {
              const slash = file.path.lastIndexOf('/');
              const dir = slash >= 0 ? file.path.slice(0, slash + 1) : '';
              const base = slash >= 0 ? file.path.slice(slash + 1) : file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  className={`file-row${selected === file.path ? ' active' : ''}`}
                  onClick={() => selectFile(file.path)}
                  title={file.path}
                >
                  <span className="file-name mono">
                    {dir ? <span className="file-dir">{dir}</span> : null}
                    <span className="file-base">{base}</span>
                  </span>
                  <span className="file-size muted">{formatBytes(file.size)}</span>
                </button>
              );
            })
          )}

          {searching && filtered.length > MAX_LISTED_FILES ? (
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
          <EmptyState title="选择左侧文件查看内容" hint="文件通过 Contents API 按需读取；下载整个分支请用上方的「下载 ZIP」。" />
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
