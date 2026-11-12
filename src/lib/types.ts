export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  public_repos: number;
  followers: number;
  following: number;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  fork: boolean;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export interface RepoSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: Repo[];
}

export interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

export interface ContentFile {
  type: string;
  encoding?: string;
  size: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
  date: string;
}

export interface CommitListItem {
  sha: string;
  commit: {
    message: string;
    author: CommitAuthor | null;
    committer: CommitAuthor | null;
  };
  author: { login: string; avatar_url: string } | null;
  html_url: string;
}

export interface CommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface CommitDetail extends CommitListItem {
  stats?: { total: number; additions: number; deletions: number };
  files?: CommitFile[];
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface CreateRepoInput {
  name: string;
  description?: string;
  private: boolean;
  auto_init?: boolean;
  gitignore_template?: string;
  license_template?: string;
}
