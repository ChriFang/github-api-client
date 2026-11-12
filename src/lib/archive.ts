import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { api } from './api';
import { formatBytes } from './format';
import type { TreeEntry, TreeResponse } from './types';

/**
 * 在浏览器里用 Git Data API 组 ZIP。
 *
 * 不直接用 GitHub 的 /zipball：它会 302 到 codeload.github.com，
 * 而该域名的 CORS 只允许 render.githubusercontent.com，浏览器 fetch 会被拦。
 * Tree + Blobs 都走 api.github.com，符合本项目"只依赖 API 域名"的前提。
 */
export const ARCHIVE_LIMITS = {
  /** 单文件上限（Git Blobs API 文档上限为 100MB） */
  maxFileBytes: 100 * 1024 * 1024,
  /** 一次打包的总大小上限，避免浏览器内存被撑爆 */
  maxTotalBytes: 250 * 1024 * 1024,
  /** 一次打包的文件数上限，约等于消耗的 API 配额次数 */
  maxFiles: 3000,
  /** 超过这些阈值时在界面上给出更醒目的提醒 */
  warnFiles: 300,
  warnTotalBytes: 50 * 1024 * 1024,
  /** 并发请求数，过高容易触发 GitHub 的 secondary rate limit */
  concurrency: 6,
} as const;

export interface ArchiveSkipped {
  path: string;
  size: number;
  reason: string;
}

export interface ArchivePlan {
  /** 可打包的 blob，按路径排序 */
  files: TreeEntry[];
  totalBytes: number;
  skipped: ArchiveSkipped[];
  submodules: number;
  symlinks: number;
  warnings: string[];
  /** 非空表示不能开始下载 */
  blockers: string[];
}

export interface ArchiveProgress {
  stage: 'fetching' | 'finalizing';
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface BuildArchiveOptions {
  owner: string;
  repo: string;
  branch: string;
  plan: ArchivePlan;
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (progress: ArchiveProgress) => void;
}

export interface ArchiveResult {
  blob: Blob;
  fileName: string;
  files: number;
  skipped: ArchiveSkipped[];
  lfsPaths: string[];
}

const WINDOWS_ILLEGAL = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const STORE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar',
  'exe', 'dll', 'so', 'dylib', 'class', 'pyc', 'apk', 'dmg', 'iso',
  'mp3', 'm4a', 'ogg', 'wav', 'mp4', 'mov', 'mkv', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

function isSafePath(path: string): boolean {
  if (!path || path.length > 1024) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function windowsPathIssue(path: string): string | null {
  if (path.length > 240) return '路径过长';
  for (const segment of path.split('/')) {
    if (WINDOWS_ILLEGAL.test(segment)) return '含 Windows 不支持的字符';
    if (/[. ]$/.test(segment)) return '文件名以点或空格结尾';
    if (WINDOWS_RESERVED.test(segment)) return '是 Windows 保留名';
  }
  return null;
}

function isCompressible(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return true;
  return !STORE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * 从文件树计算可打包清单：过滤子模块、超大文件、不安全路径，
 * 并提前收集 Windows 解压/配额方面的警告。
 */
export function planArchive(tree: TreeResponse): ArchivePlan {
  const files: TreeEntry[] = [];
  const skipped: ArchiveSkipped[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const casePaths = new Map<string, string>();
  const caseCollisions = new Set<string>();
  const windowsIssues: string[] = [];
  let windowsIssueCount = 0;
  let totalBytes = 0;
  let submodules = 0;
  let symlinks = 0;

  for (const entry of tree.tree) {
    if (entry.type === 'commit') {
      submodules += 1;
      continue;
    }
    if (entry.type !== 'blob') continue;

    const size = entry.size ?? 0;
    if (!isSafePath(entry.path)) {
      skipped.push({ path: entry.path, size, reason: '路径不合法，可能造成解压越界' });
      continue;
    }
    if (size > ARCHIVE_LIMITS.maxFileBytes) {
      skipped.push({ path: entry.path, size, reason: `超过 ${formatBytes(ARCHIVE_LIMITS.maxFileBytes)} 单文件上限` });
      continue;
    }

    const lower = entry.path.toLowerCase();
    const previous = casePaths.get(lower);
    if (previous && previous !== entry.path) caseCollisions.add(`${previous} / ${entry.path}`);
    else casePaths.set(lower, entry.path);

    const windowsIssue = windowsPathIssue(entry.path);
    if (windowsIssue) {
      windowsIssueCount += 1;
      if (windowsIssues.length < 5) windowsIssues.push(`${entry.path}（${windowsIssue}）`);
    }

    if (entry.mode === '120000') symlinks += 1;

    totalBytes += size;
    files.push(entry);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  if (tree.truncated) {
    blockers.push('GitHub 返回的文件树已被截断（超过 10 万项或 7MB），无法保证打包完整。');
  }
  if (files.length === 0) {
    blockers.push('这个分支下没有可下载的文件。');
  }
  if (files.length > ARCHIVE_LIMITS.maxFiles) {
    blockers.push(
      `文件数 ${files.length} 超过上限 ${ARCHIVE_LIMITS.maxFiles}；一次打包会消耗同等数量的 API 配额。`,
    );
  }
  if (totalBytes > ARCHIVE_LIMITS.maxTotalBytes) {
    blockers.push(
      `总大小 ${formatBytes(totalBytes)} 超过上限 ${formatBytes(ARCHIVE_LIMITS.maxTotalBytes)}，建议改用 git clone。`,
    );
  }

  if (files.length > ARCHIVE_LIMITS.warnFiles) {
    warnings.push(`文件较多（${files.length} 个），预计消耗约 ${files.length} 次 API 配额，下载可能需要几分钟。`);
  }
  if (totalBytes > ARCHIVE_LIMITS.warnTotalBytes) {
    warnings.push(`总大小 ${formatBytes(totalBytes)}，浏览器需要先缓存整个 ZIP，移动端可能较慢。`);
  }
  if (submodules > 0) {
    warnings.push(`包含 ${submodules} 个子模块，压缩包内不会包含子模块内容。`);
  }
  if (symlinks > 0) {
    warnings.push(`${symlinks} 个符号链接会按普通文本文件保存（内容是链接目标路径）。`);
  }
  if (caseCollisions.size > 0) {
    const examples = Array.from(caseCollisions).slice(0, 3).join('；');
    warnings.push(`存在仅大小写不同的路径，Windows 解压时会冲突：${examples}${caseCollisions.size > 3 ? ' …' : ''}`);
  }
  if (windowsIssues.length > 0) {
    warnings.push(
      `部分路径在 Windows 上可能无法解压：${windowsIssues.join('；')}${windowsIssueCount > 5 ? ' …' : ''}`,
    );
  }
  if (skipped.length > 0) {
    warnings.push(`${skipped.length} 个文件因过大或路径不合法被跳过，详见导出说明。`);
  }

  return { files, totalBytes, skipped, submodules, symlinks, warnings, blockers };
}

function abortError(): DOMException {
  return new DOMException('已取消', 'AbortError');
}

function fileAttributes(mode: string): number {
  const parsed = Number.parseInt(mode, 8);
  const permissions = (Number.isFinite(parsed) ? parsed : 0o644) & 0o777;
  // 符号链接（120000）按普通文本文件保存，需要补上常规读写位，避免解压出 000 权限的文件
  return ((0o100000 | (permissions || 0o644)) << 16) >>> 0;
}

function readLfsPointer(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.length > 1024) return false;
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  return head.startsWith('version https://git-lfs.github.com/spec/v1');
}

function exportReport(plan: ArchivePlan, lfsPaths: string[], owner: string, repo: string, branch: string): string | null {
  const notes: string[] = [];
  if (plan.skipped.length > 0) {
    notes.push('跳过的文件：');
    plan.skipped.slice(0, 50).forEach((item) => {
      notes.push(`- ${item.path}（${formatBytes(item.size)}）：${item.reason}`);
    });
    if (plan.skipped.length > 50) notes.push(`- … 另有 ${plan.skipped.length - 50} 个`);
  }
  if (plan.submodules > 0) notes.push(`子模块：${plan.submodules} 个，未包含内容。`);
  if (plan.symlinks > 0) notes.push(`符号链接：${plan.symlinks} 个，已按普通文本文件保存。`);
  if (lfsPaths.length > 0) {
    notes.push(`Git LFS：${lfsPaths.length} 个文件只有指针，未包含实际内容（需要 LFS 协议，本客户端不支持）。`);
    lfsPaths.slice(0, 20).forEach((path) => notes.push(`- ${path}`));
    if (lfsPaths.length > 20) notes.push(`- … 另有 ${lfsPaths.length - 20} 个`);
  }
  if (plan.warnings.length > 0) notes.push(...plan.warnings.map((warning) => `提示：${warning}`));

  if (notes.length === 0) return null;

  return [
    'GitHub Flash 导出说明',
    '',
    `仓库：${owner}/${repo}`,
    `分支：${branch}`,
    `导出时间：${new Date().toISOString()}`,
    `文件数：${plan.files.length}`,
    `原始大小：${formatBytes(plan.totalBytes)}`,
    '',
    ...notes,
    '',
    '说明：本文件由 GitHub Flash 自动生成，仅当存在跳过文件 / 子模块 / 符号链接 / LFS 或打包提示时出现。',
  ].join('\n');
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let index = 1;
  while (used.has(name.toLowerCase())) {
    name = base.replace(/\.txt$/, `-${index}.txt`);
    index += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function archiveFileName(repo: string, branch: string): string {
  const safeRepo = repo.replace(/[^\w.-]+/g, '-');
  const safeBranch = branch.replace(/[^\w.-]+/g, '-');
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${safeRepo}-${safeBranch}-${stamp}.zip`;
}

class ZipBuilder {
  private readonly chunks: Uint8Array[] = [];
  private readonly zip: Zip;
  private blob: Blob | null = null;
  private failure: Error | null = null;
  private settle: { resolve: (blob: Blob) => void; reject: (error: unknown) => void } | null = null;

  constructor() {
    this.zip = new Zip((error, chunk, final) => {
      if (error) {
        this.failure = error;
        this.settle?.reject(error);
        this.settle = null;
        return;
      }
      if (chunk.length > 0) this.chunks.push(chunk);
      if (final) {
        this.blob = new Blob(this.chunks as BlobPart[], { type: 'application/zip' });
        this.settle?.resolve(this.blob);
        this.settle = null;
      }
    });
  }

  add(path: string, data: Uint8Array, mode: string): void {
    if (this.failure) throw this.failure;

    const entry = isCompressible(path) ? new ZipDeflate(path, { level: 4 }) : new ZipPassThrough(path);
    entry.os = 3;
    entry.attrs = fileAttributes(mode);
    this.zip.add(entry);
    entry.push(data, true);
  }

  finish(): Promise<Blob> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.blob) return Promise.resolve(this.blob);
    return new Promise<Blob>((resolve, reject) => {
      this.settle = { resolve, reject };
      try {
        this.zip.end();
      } catch (error) {
        this.settle = null;
        reject(error);
      }
    });
  }
}

/**
 * 并发拉取 blob 并流式写入 ZIP，返回最终 Blob。
 * 调用方负责在浏览器里触发保存（saveArchive）。
 */
export async function buildArchive(options: BuildArchiveOptions): Promise<ArchiveResult> {
  const { owner, repo, branch, plan, signal } = options;
  if (plan.blockers.length > 0) throw new Error(plan.blockers[0]);
  if (plan.files.length === 0) throw new Error('没有可打包的文件');

  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });

  const progress: ArchiveProgress = {
    stage: 'fetching',
    filesDone: 0,
    filesTotal: plan.files.length,
    bytesDone: 0,
    bytesTotal: plan.totalBytes,
  };
  const emit = () => options.onProgress?.({ ...progress });

  const zip = new ZipBuilder();
  const lfsPaths: string[] = [];
  let cursor = 0;
  let firstError: unknown;

  const worker = async () => {
    while (true) {
      if (controller.signal.aborted) throw abortError();
      const index = cursor;
      cursor += 1;
      if (index >= plan.files.length) return;

      const file = plan.files[index];
      const data = await api.getBlob(owner, repo, file.sha, controller.signal);
      if (controller.signal.aborted) throw abortError();

      if (readLfsPointer(data)) lfsPaths.push(file.path);
      zip.add(file.path, data, file.mode);

      progress.filesDone += 1;
      progress.bytesDone += data.length;
      emit();
    }
  };

  const runWorker = async () => {
    try {
      await worker();
    } catch (error) {
      if (firstError === undefined) firstError = error;
      // 一个 worker 失败后立刻中止其它请求，但保留最先发生的错误
      controller.abort();
      throw error;
    }
  };

  try {
    const concurrency = Math.max(
      1,
      Math.min(options.concurrency ?? ARCHIVE_LIMITS.concurrency, plan.files.length),
    );
    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

    progress.stage = 'finalizing';
    emit();

    const report = exportReport(plan, lfsPaths, owner, repo, branch);
    if (report) {
      const used = new Set(plan.files.map((file) => file.path.toLowerCase()));
      const reportName = uniqueName('_github-flash-export.txt', used);
      zip.add(reportName, new TextEncoder().encode(report), '100644');
    }

    const blob = await zip.finish();
    return {
      blob,
      fileName: archiveFileName(repo, branch),
      files: plan.files.length,
      skipped: plan.skipped,
      lfsPaths,
    };
  } catch (error) {
    controller.abort();
    throw firstError === undefined ? error : firstError;
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

/** 触发浏览器保存。放在单独函数里，方便以后换成 File System Access API 流式落盘。 */
export function saveArchive(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
