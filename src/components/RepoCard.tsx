import { Link } from 'react-router-dom';
import type { Repo } from '../lib/types';
import { relativeTime } from '../lib/format';

export default function RepoCard({ repo }: { repo: Repo }) {
  return (
    <Link className="repo-card" to={`/r/${repo.owner.login}/${repo.name}`}>
      <div className="repo-card-head">
        <span className="repo-name">{repo.name}</span>
        {repo.private ? <span className="badge badge-private">私有</span> : null}
        {repo.fork ? <span className="badge badge-muted">Fork</span> : null}
      </div>

      <p className="repo-desc">{repo.description?.trim() || '暂无描述'}</p>

      <div className="repo-meta">
        {repo.language ? (
          <span className="meta-item">
            <i className="lang-dot" aria-hidden="true" />
            {repo.language}
          </span>
        ) : null}
        <span className="meta-item">★ {repo.stargazers_count}</span>
        <span className="meta-item">⑂ {repo.forks_count}</span>
        <span className="meta-item muted">更新于 {relativeTime(repo.pushed_at)}</span>
      </div>
    </Link>
  );
}
