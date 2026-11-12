import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ARCHIVE_LIMITS,
  buildArchive,
  planArchive,
  saveArchive,
} from '../lib/archive';
import type { ArchiveProgress, ArchiveResult } from '../lib/archive';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate } from '../lib/format';
import type { TreeResponse } from '../lib/types';
import { ErrorState } from './State';

type Phase = 'review' | 'running' | 'done' | 'cancelled' | 'error';

const EMPTY_PROGRESS: ArchiveProgress = {
  stage: 'fetching',
  filesDone: 0,
  filesTotal: 0,
  bytesDone: 0,
  bytesTotal: 0,
};

export default function DownloadArchive({
  owner,
  repo,
  branch,
  tree,
  treeLoading,
  treeError,
  onRetryTree,
}: {
  owner: string;
  repo: string;
  branch: string;
  tree?: TreeResponse;
  treeLoading: boolean;
  treeError: unknown;
  onRetryTree: () => void;
}) {
  const { rateLimit } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('review');
  const [progress, setProgress] = useState<ArchiveProgress>(EMPTY_PROGRESS);
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressAtRef = useRef(0);

  const plan = useMemo(() => (tree ? planArchive(tree) : null), [tree]);

  const reset = useCallback(() => {
    setPhase('review');
    setProgress(EMPTY_PROGRESS);
    setResult(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    reset();
  }, [reset]);

  const openDialog = () => {
    reset();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase !== 'running') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, phase, close]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const quotaNeeded = plan ? plan.files.length : 0;
  const quotaBlocker =
    plan && rateLimit && quotaNeeded > rateLimit.remaining
      ? `预计需要 ${quotaNeeded} 次 API 请求，当前配额只剩 ${rateLimit.remaining} 次${
          rateLimit.reset ? `（${formatDate(new Date(rateLimit.reset * 1000).toISOString())} 重置）` : ''
        }。`
      : null;

  const blockers = plan ? [...plan.blockers, ...(quotaBlocker ? [quotaBlocker] : [])] : [];
  const canStart = Boolean(plan) && blockers.length === 0 && !treeError && !treeLoading;

  const start = async () => {
    if (!plan || blockers.length > 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('running');
    setError(null);
    setResult(null);
    lastProgressAtRef.current = 0;
    setProgress({
      stage: 'fetching',
      filesDone: 0,
      filesTotal: plan.files.length,
      bytesDone: 0,
      bytesTotal: plan.totalBytes,
    });

    try {
      const next = await buildArchive({
        owner,
        repo,
        branch,
        plan,
        signal: controller.signal,
        onProgress: (value) => {
          const now = performance.now();
          // 大仓库最多每 100ms 刷新一次进度，避免逐文件 setState 造成卡顿
          if (
            value.stage === 'finalizing' ||
            value.filesDone === value.filesTotal ||
            now - lastProgressAtRef.current >= 100
          ) {
            lastProgressAtRef.current = now;
            setProgress(value);
          }
        },
      });
      if (abortRef.current !== controller) return;
      saveArchive(next.blob, next.fileName);
      setResult(next);
      setPhase('done');
    } catch (caught) {
      if (abortRef.current !== controller) return;
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setPhase('cancelled');
      } else {
        setError(caught);
        setPhase('error');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const ratio =
    progress.bytesTotal > 0
      ? progress.bytesDone / progress.bytesTotal
      : progress.filesTotal > 0
        ? progress.filesDone / progress.filesTotal
        : 0;
  const percent = progress.stage === 'finalizing' ? 100 : Math.min(100, Math.round(ratio * 100));

  const buttonTitle = treeLoading
    ? '正在读取文件树…'
    : treeError
      ? '文件树加载失败，点此查看'
      : '把当前分支的所有文件打包为 ZIP';

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={openDialog}
        disabled={treeLoading || (!tree && !treeError)}
        title={buttonTitle}
      >
        下载 ZIP
      </button>

      {open ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="modal archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-title">
            <div className="modal-head">
              <div>
                <h2 className="modal-title" id="archive-title">
                  打包下载仓库
                </h2>
                <p className="muted small modal-sub">
                  {owner}/{repo} · <code>{branch}</code>
                </p>
              </div>
              <button type="button" className="modal-close" onClick={close} aria-label="关闭">
                ×
              </button>
            </div>

            <div className="modal-body">
              {phase === 'review' ? (
                <>
                  {treeError ? (
                    <ErrorState error={treeError} onRetry={onRetryTree} />
                  ) : null}

                  {!treeError && plan ? (
                    <>
                      <div className="archive-stats">
                        <div className="archive-stat">
                          <span className="archive-stat-label">文件</span>
                          <span className="archive-stat-value">{plan.files.length} 个</span>
                        </div>
                        <div className="archive-stat">
                          <span className="archive-stat-label">原始大小</span>
                          <span className="archive-stat-value">{formatBytes(plan.totalBytes)}</span>
                        </div>
                        <div className="archive-stat">
                          <span className="archive-stat-label">预计 API 请求</span>
                          <span className="archive-stat-value">{quotaNeeded} 次</span>
                        </div>
                        <div className="archive-stat">
                          <span className="archive-stat-label">当前配额</span>
                          <span className="archive-stat-value">
                            {rateLimit ? `${rateLimit.remaining}/${rateLimit.limit}` : '—'}
                          </span>
                        </div>
                      </div>

                      {blockers.length > 0 ? (
                        <div className="archive-callout archive-blocker">
                          <strong>暂时不能打包</strong>
                          <ul>
                            {blockers.map((blocker) => (
                              <li key={blocker}>{blocker}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {plan.warnings.length > 0 ? (
                        <div className="archive-callout archive-warning">
                          <strong>需要注意</strong>
                          <ul>
                            {plan.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <p className="muted small archive-note">
                        ZIP 由浏览器在本机生成：文件逐个通过 GitHub Blobs API 读取，不经过第三方服务器。
                        不包含 <code>.git</code> 历史；超过{' '}
                        {Math.round(ARCHIVE_LIMITS.maxFileBytes / 1024 / 1024)} MB 的单个文件会被跳过。
                      </p>
                    </>
                  ) : null}

                  {!treeError && treeLoading ? <p className="muted">正在读取文件树…</p> : null}
                </>
              ) : null}

              {phase === 'running' ? (
                <>
                  <div className="archive-progress-head">
                    <span>{progress.stage === 'finalizing' ? '正在生成 ZIP…' : '正在读取文件…'}</span>
                    <span className="mono">{percent}%</span>
                  </div>
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <div className="progress-fill" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="muted small" aria-live="polite">
                    {progress.stage === 'finalizing'
                      ? `已读取 ${progress.filesTotal} 个文件（${formatBytes(progress.bytesTotal)}），正在压缩并封装…`
                      : `已读取 ${progress.filesDone} / ${progress.filesTotal} 个文件 · ${formatBytes(
                          progress.bytesDone,
                        )} / ${formatBytes(progress.bytesTotal)}`}
                  </p>
                  <p className="muted small">
                    下载中会消耗 API 配额，取消不会保留已完成的部分。
                  </p>
                </>
              ) : null}

              {phase === 'done' && result ? (
                <div className="archive-callout archive-success">
                  <strong>已开始下载</strong>
                  <p className="mono small archive-file-name">{result.fileName}</p>
                  <p className="muted small">
                    {result.files} 个文件 · ZIP {formatBytes(result.blob.size)}
                    {result.lfsPaths.length > 0 ? ` · ${result.lfsPaths.length} 个 LFS 指针未下载实际内容` : ''}
                    {result.skipped.length > 0 ? ` · 跳过 ${result.skipped.length} 个文件` : ''}
                  </p>
                  <p className="muted small">
                    如果浏览器没有弹出保存框，请检查下载权限或稍后重试。
                  </p>
                </div>
              ) : null}

              {phase === 'cancelled' ? (
                <div className="archive-callout">
                  <strong>已取消</strong>
                  <p className="muted small">没有生成压缩包，已读取的部分不会保留。</p>
                </div>
              ) : null}

              {phase === 'error' ? <ErrorState error={error} /> : null}
            </div>

            <div className="modal-foot">
              {phase === 'review' ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={close}>
                    取消
                  </button>
                  <button type="button" className="btn btn-primary" onClick={start} disabled={!canStart}>
                    开始下载
                  </button>
                </>
              ) : null}

              {phase === 'running' ? (
                <button type="button" className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>
                  取消下载
                </button>
              ) : null}

              {phase === 'done' ? (
                <button type="button" className="btn btn-primary" onClick={close}>
                  关闭
                </button>
              ) : null}

              {phase === 'cancelled' ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={close}>
                    关闭
                  </button>
                  <button type="button" className="btn" onClick={start} disabled={!canStart}>
                    重新开始
                  </button>
                </>
              ) : null}

              {phase === 'error' ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={close}>
                    关闭
                  </button>
                  <button type="button" className="btn" onClick={start} disabled={!canStart}>
                    重试
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
