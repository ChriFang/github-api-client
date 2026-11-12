import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { buildArchive, planArchive } from '../.tmp/archive.mjs';

/**
 * 真实请求 GitHub，验证 Blobs API 原始二进制读取 + 浏览器端 ZIP 组包。
 * 需要访问 api.github.com；未认证约消耗 3 次配额。
 */
const OWNER = 'octocat';
const REPO = 'Hello-World';
const HEADERS = { Accept: 'application/vnd.github+json' };

// 纯本地的规划逻辑：截断、子模块、符号链接、超大文件、Windows 冲突
const synthetic = {
  sha: 'root',
  truncated: false,
  tree: [
    { path: 'src/a.ts', mode: '100644', type: 'blob', sha: 'a', size: 10 },
    { path: 'src/A.ts', mode: '100644', type: 'blob', sha: 'b', size: 10 },
    { path: 'link', mode: '120000', type: 'blob', sha: 'l', size: 5 },
    { path: 'huge.bin', mode: '100644', type: 'blob', sha: 'h', size: 101 * 1024 * 1024 },
    { path: 'bad\\name.txt', mode: '100644', type: 'blob', sha: 'x', size: 1 },
    { path: 'CON.txt', mode: '100644', type: 'blob', sha: 'c', size: 1 },
    { path: 'vendor/lib', mode: '160000', type: 'commit', sha: 's' },
    { path: 'docs', mode: '040000', type: 'tree', sha: 'd' },
  ],
};
const syntheticPlan = planArchive(synthetic);
assert.equal(syntheticPlan.files.length, 4);
assert.equal(syntheticPlan.skipped.length, 2);
assert.equal(syntheticPlan.submodules, 1);
assert.equal(syntheticPlan.symlinks, 1);
assert.ok(syntheticPlan.warnings.some((warning) => warning.includes('大小写')));
assert.ok(syntheticPlan.warnings.some((warning) => warning.includes('Windows')));
assert.equal(planArchive({ ...synthetic, truncated: true }).blockers.length > 0, true);
console.log('PASS 规划逻辑：过滤超大/非法路径、子模块、符号链接、Windows 冲突与截断');

const repoResponse = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: HEADERS });
if (!repoResponse.ok) throw new Error(`仓库详情请求失败：HTTP ${repoResponse.status}`);
const repo = await repoResponse.json();
const branch = repo.default_branch ?? 'master';

const treeResponse = await fetch(
  `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  { headers: HEADERS },
);
if (!treeResponse.ok) throw new Error(`文件树请求失败：HTTP ${treeResponse.status}`);
const tree = await treeResponse.json();

const plan = planArchive(tree);
assert.equal(plan.blockers.length, 0, `意外的阻止项：${plan.blockers.join('；')}`);
assert.ok(plan.files.length > 0, '文件树里没有可下载的文件');

const progress = [];
const result = await buildArchive({
  owner: OWNER,
  repo: REPO,
  branch,
  plan,
  onProgress: (value) => progress.push(value),
});

assert.equal(result.files, plan.files.length);
assert.ok(result.blob.size > 0);
assert.match(result.fileName, /\.zip$/);

const entries = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
assert.equal(Object.keys(entries).length, plan.files.length);

const first = plan.files[0];
assert.ok(entries[first.path], `ZIP 中缺少 ${first.path}`);
const progressEnd = progress.at(-1);
assert.equal(progressEnd.stage, 'finalizing');
assert.equal(progressEnd.filesDone, plan.files.length);
assert.equal(progressEnd.bytesDone, plan.totalBytes);

const sample = entries[first.path];
const text = strFromU8(sample);
console.log(`PASS archive smoke：${OWNER}/${REPO}@${branch}`);
console.log(`  文件 ${plan.files.length} 个 / 原始 ${plan.totalBytes} B / ZIP ${result.blob.size} B`);
console.log(`  ${first.path} 首行：${text.split('\n')[0].slice(0, 60)}`);
