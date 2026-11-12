/**
 * 本地 mock 服务：在没有 Token / 网络不通时也能把界面跑起来。
 *   npm run mock          # 监听 8799
 *   VITE_API_BASE=http://127.0.0.1:8799 npm run dev
 */
import { createServer } from 'node:http';

const PORT = 8799;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

const user = {
  login: 'octocat',
  name: 'Octo Cat',
  avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
  html_url: 'https://github.com/octocat',
  public_repos: 8,
  followers: 16000,
  following: 9,
};

const repo = {
  id: 1,
  name: 'git-client-flash',
  full_name: 'octocat/git-client-flash',
  private: false,
  fork: false,
  html_url: 'https://github.com/octocat/git-client-flash',
  description: '基于 api.github.com 的轻量 GitHub 客户端，支持浏览仓库、查看提交、创建仓库。',
  language: 'TypeScript',
  stargazers_count: 1284,
  forks_count: 96,
  open_issues_count: 7,
  size: 2048,
  default_branch: 'main',
  updated_at: new Date(Date.now() - 3600_000).toISOString(),
  pushed_at: new Date(Date.now() - 3600_000).toISOString(),
  owner: { login: 'octocat', avatar_url: user.avatar_url },
};

const repos = [
  repo,
  {
    ...repo,
    id: 2,
    name: 'notes',
    full_name: 'octocat/notes',
    description: '零散的工程笔记。',
    language: 'Markdown',
    stargazers_count: 42,
    forks_count: 3,
    private: true,
    pushed_at: new Date(Date.now() - 86_400_000 * 3).toISOString(),
  },
  {
    ...repo,
    id: 3,
    name: 'dsh-plugins',
    full_name: 'octocat/dsh-plugins',
    description: null,
    language: 'Go',
    stargazers_count: 8,
    forks_count: 0,
    pushed_at: new Date(Date.now() - 86_400_000 * 21).toISOString(),
  },
];

const files = {
  'README.md': `# GitHub Flash

一个直接调用 \`api.github.com\` 的轻量客户端。

## 特性

- 浏览仓库与文件树
- 查看提交记录与 diff
- 创建仓库

> 所有请求直连 GitHub，不经过第三方服务器。

| 功能 | 接口 |
| --- | --- |
| 仓库列表 | \`GET /user/repos\` |
| 文件树 | \`GET /git/trees/{ref}\` |
`,
  'package.json': `{
  "name": "git-client-flash",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build"
  }
}
`,
  'src/main.tsx': `import ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n`,
  'src/lib/api.ts': `const BASE_URL = 'https://api.github.com';\n\nexport async function request<T>(path: string): Promise<T> {\n  const res = await fetch(BASE_URL + path, { headers: { Accept: 'application/vnd.github+json' } });\n  if (!res.ok) throw new Error(String(res.status));\n  return (await res.json()) as T;\n}\n`,
  'docs/architecture.md': `# 架构\n\n三层：API 客户端 / Query 缓存 / 页面组件。\n`,
  '.github/workflows/ci.yml': `name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm run build\n`,
  'scripts/deploy.sh': `#!/bin/sh\nset -eu\necho "deploy"\n`,
};

const fileModes = {
  'scripts/deploy.sh': '100755',
};

const tree = Object.keys(files).map((path, index) => ({
  path,
  mode: fileModes[path] ?? '100644',
  type: 'blob',
  sha: `sha${index}`,
  size: Buffer.byteLength(files[path]),
}));
tree.push({ path: 'src', mode: '040000', type: 'tree', sha: 't1' });
tree.push({ path: 'docs', mode: '040000', type: 'tree', sha: 't2' });

const commits = Array.from({ length: 6 }).map((_, index) => ({
  sha: `${['3f9a1b2', '7c4d5e6', '9e8f7a0', '1b3c5d7', '5d7e9f1', '8a2b4c6'][index]}${'0'.repeat(33)}`,
  commit: {
    message: [
      'feat: 支持按需读取文件内容\n\n通过 Contents API 拉取单个文件，避免克隆整个仓库。',
      'fix: 修正提交列表分页参数',
      'docs: 补充 README 与接口对照表',
      'refactor: 抽出 GitHubError 统一错误分类',
      'chore: 升级依赖',
      'test: 增加 API 层冒烟测试',
    ][index],
    author: {
      name: ['Octo Cat', 'Mona Lisa', 'Hubot'][index % 3],
      email: 'octo@example.com',
      date: new Date(Date.now() - index * 3600_000 * 9).toISOString(),
    },
    committer: null,
  },
  author:
    index % 3 === 2
      ? null
      : { login: 'octocat', avatar_url: user.avatar_url },
  html_url: 'https://github.com/octocat/git-client-flash/commit/abc',
}));

const detail = {
  ...commits[0],
  stats: { total: 42, additions: 34, deletions: 8 },
  files: [
    {
      filename: 'src/lib/api.ts',
      status: 'modified',
      additions: 24,
      deletions: 6,
      changes: 30,
      patch: `@@ -1,6 +1,10 @@\n-const BASE_URL = 'https://api.github.com';\n+const BASE_URL = 'https://api.github.com';\n+const ETAG_CACHE = new Map();\n \n export async function request<T>(path: string): Promise<T> {\n   const res = await fetch(BASE_URL + path);\n+  if (res.status === 304) return ETAG_CACHE.get(path);\n   return (await res.json()) as T;\n }`,
    },
    {
      filename: 'README.md',
      status: 'added',
      additions: 10,
      deletions: 2,
      changes: 12,
      patch: `@@ -1,3 +1,9 @@\n # GitHub Flash\n+\n+直接调用 api.github.com。\n+\n+## 快速开始\n+\n+\`\`\`bash\n+npm install && npm run dev\n+\`\`\``,
    },
  ],
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,if-none-match,x-github-api-version',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Expose-Headers':
    'ETag,Link,Location,Retry-After,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset',
};

const workUser = {
  ...user,
  login: 'octocat-work',
  name: 'Octo Cat (Work)',
  avatar_url: 'https://avatars.githubusercontent.com/u/9919?v=4',
};

function userForToken(header) {
  const token = String(header ?? '').replace(/^Bearer\s+/i, '');
  return token.includes('work') ? workUser : user;
}

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...cors,
    'Content-Type': 'application/json',
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4321',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  });
  res.end(payload);
}

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (path === '/user') return send(res, 200, userForToken(req.headers.authorization));
  if (path === '/user/repos') return send(res, 200, repos);
  if (/^\/repos\/[^/]+\/[^/]+\/readme$/.test(path)) {
    return send(res, 200, {
      type: 'file',
      encoding: 'base64',
      size: Buffer.byteLength(files['README.md']),
      name: 'README.md',
      path: 'README.md',
      sha: 'r1',
      content: b64(files['README.md']),
    });
  }
  if (/^\/repos\/[^/]+\/[^/]+\/git\/trees\//.test(path)) {
    return send(res, 200, { sha: 'root', tree, truncated: false });
  }
  if (/^\/repos\/[^/]+\/[^/]+\/git\/blobs\/[^/]+$/.test(path)) {
    const sha = path.split('/git/blobs/')[1];
    const entry = tree.find((item) => item.type === 'blob' && item.sha === sha);
    if (!entry) return send(res, 404, { message: 'Not Found' });
    const content = Buffer.from(files[entry.path] ?? '', 'utf8');
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(content.length),
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4321',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    });
    res.end(content);
    return;
  }
  if (/^\/repos\/[^/]+\/[^/]+\/contents\//.test(path)) {
    const filePath = path.split('/contents/')[1] ?? '';
    const content = files[filePath];
    if (content === undefined) return send(res, 404, { message: 'Not Found' });
    return send(res, 200, {
      type: 'file',
      encoding: 'base64',
      size: Buffer.byteLength(content),
      name: filePath.split('/').pop(),
      path: filePath,
      sha: 'sha',
      content: b64(content),
    });
  }
  if (/^\/repos\/[^/]+\/[^/]+\/commits\/[^/]+$/.test(path)) return send(res, 200, detail);
  if (/^\/repos\/[^/]+\/[^/]+\/commits$/.test(path)) return send(res, 200, commits);
  if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return send(res, 200, repo);
  if (req.method === 'POST' && path === '/user/repos') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const input = body ? JSON.parse(body) : {};
      send(res, 201, { ...repo, id: 99, name: input.name ?? 'new-repo', full_name: `octocat/${input.name}` });
    });
    return;
  }

  send(res, 404, { message: 'Not Found' });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock GitHub API listening on http://127.0.0.1:${PORT}`);
});
