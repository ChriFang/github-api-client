import { api, decodeContent, GitHubError, setAuthToken, subscribeRateLimit } from '../.tmp/api.mjs';

const log = (...args) => console.log(...args);
let lastRate = null;
subscribeRateLimit((info) => {
  lastRate = info;
});

async function expectError(label, fn, kind) {
  try {
    await fn();
    log(`FAIL ${label}: 没有抛出错误`);
  } catch (error) {
    if (error instanceof GitHubError && error.kind === kind) {
      log(`PASS ${label}: kind=${error.kind} status=${error.status}`);
    } else {
      log(`FAIL ${label}: 错误类型不符`, error?.kind ?? error?.message);
    }
  }
}

setAuthToken(null);

await expectError('未登录访问 /user', () => api.getUser(), 'auth');
await expectError('不存在的仓库', () => api.getRepo('microsoft', 'repo-does-not-exist-zz9'), 'not-found');

const repo = await api.getRepo('microsoft', 'vscode');
log(`PASS 仓库详情: ${repo.full_name} branch=${repo.default_branch} stars=${repo.stargazers_count}`);

const remainingBefore = lastRate?.remaining;
const started = Date.now();
const cached = await api.getRepo('microsoft', 'vscode');
const cachedMs = Date.now() - started;
const remainingAfter = lastRate?.remaining;
log(
  `PASS 条件请求: 第二次 ${cachedMs}ms（${cachedMs < 200 ? '命中 304' : '未命中'}），配额 ${remainingBefore} -> ${remainingAfter}`,
);

const commits = await api.listCommits('microsoft', 'vscode', 1, 3);
log(`PASS 提交列表: ${commits.data.length} 条, nextPage=${commits.nextPage}`);

const tree = await api.getTree('microsoft', 'vscode', repo.default_branch);
const files = tree.data.tree.filter((entry) => entry.type === 'blob');
log(`PASS 文件树: 共 ${tree.data.tree.length} 项, 文件 ${files.length} 个, truncated=${tree.data.truncated}`);

try {
  const found = await api.searchRepos('react in:name', 1, 3);
  log(
    `PASS 仓库搜索: total=${found.data.total_count}, 返回 ${found.data.items.length} 项, nextPage=${found.nextPage}, 首项=${found.data.items[0]?.full_name ?? '-'}`,
  );
} catch (error) {
  // 搜索配额按出口 IP 计且只有 10 次/分钟，共享 IP 下可能被邻居耗尽；不让它拖垮其它冒烟项
  if (error instanceof GitHubError && error.kind === 'search-limit') {
    log('SKIP 仓库搜索: 未认证搜索配额已用完，稍后重试');
  } else {
    throw error;
  }
}

const target = tree.data.tree.find((entry) => entry.type === 'blob' && entry.path === 'package.json');
const file = await api.getContent('microsoft', 'vscode', target.path);
const text = decodeContent(file);
log(`PASS 文件内容: ${file.path} ${text.length} 字符, 首行="${text.split('\n')[0].slice(0, 40)}"`);

const detail = await api.getCommit('microsoft', 'vscode', commits.data[0].sha);
log(`PASS 提交详情: files=${detail.files?.length ?? 0} stats=${detail.stats ? '+' + detail.stats.additions + '/-' + detail.stats.deletions : '-'}`);

log(`配额状态: ${lastRate?.remaining}/${lastRate?.limit}`);
