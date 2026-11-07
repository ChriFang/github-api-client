import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, GitHubError } from '../lib/api';
import type { GitHubUser } from '../lib/types';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=GitHub%20Flash';
const FINE_GRAINED_URL = 'https://github.com/settings/personal-access-tokens/new';
const TOKEN_PATTERN = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

type CheckState = 'idle' | 'checking' | 'valid' | 'invalid';

function SavedAccounts() {
  const { accounts, user, switchAccount, removeAccount } = useAuth();
  const navigate = useNavigate();

  if (accounts.length === 0) return null;

  return (
    <div className="saved-accounts">
      <p className="field-label">本机已保存的账号</p>
      {accounts.map((account) => {
        const isActive = account.login === user?.login;
        return (
          <div className="saved-account" key={account.login}>
            <img className="avatar" src={account.avatar_url} alt="" width={28} height={28} />
            <div className="grow">
              <div className="saved-login">{account.login}</div>
              {account.name ? <div className="saved-name">{account.name}</div> : null}
            </div>
            {isActive ? (
              <span className="badge badge-current">当前</span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  switchAccount(account.login);
                  navigate('/');
                }}
              >
                切换
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => removeAccount(account.login)}
              title="从本机移除该 Token"
            >
              移除
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function LoginPage() {
  const { token, signIn, sessionExpired, clearSessionExpired } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adding = params.get('add') === '1';

  const [value, setValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<CheckState>('idle');
  const [profile, setProfile] = useState<GitHubUser | null>(null);
  const [checkMessage, setCheckMessage] = useState('');
  const [copied, setCopied] = useState(false);

  // 边输入边校验：只对形似真实 Token 的串发请求，避免无意义的 401
  useEffect(() => {
    const candidate = value.trim();
    if (!TOKEN_PATTERN.test(candidate)) {
      setCheck('idle');
      setProfile(null);
      setCheckMessage('');
      return;
    }

    let cancelled = false;
    setCheck('checking');
    const timer = setTimeout(() => {
      api
        .getUser(candidate)
        .then((result) => {
          if (cancelled) return;
          setProfile(result);
          setCheck('valid');
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setProfile(null);
          setCheck('invalid');
          setCheckMessage(
            caught instanceof GitHubError && caught.kind === 'auth'
              ? 'Token 无效，检查是否复制完整或已过期'
              : '校验失败：连不上 api.github.com',
          );
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  if (token && !adding) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(value);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const errorText =
    error instanceof GitHubError
      ? error.kind === 'auth'
        ? 'Token 无效或已过期'
        : error.message
      : error
        ? '登录失败，请重试'
        : null;

  const canSubmit = !busy && value.trim() !== '' && check !== 'invalid';

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <span className="brand-text">
            GitHub <em>Flash</em>
          </span>
        </div>

        <h1>{adding ? '再添加一个账号' : '连接你的 GitHub'}</h1>

        {sessionExpired ? (
          <p className="banner">
            上次登录的 Token 已失效（可能过期或被撤销），重新粘贴后即可继续使用。
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                clearSessionExpired();
              }}
            >
              知道了
            </button>
          </p>
        ) : null}

        <p className="muted">
          客户端直接调用 <code>api.github.com</code>，不经过任何中间服务器；Token 只保存在本机浏览器。
        </p>

        <SavedAccounts />

        <form onSubmit={submit} className="login-form">
          <label className="field">
            <span className="field-label">Personal Access Token</span>
            <input
              className="input"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="ghp_… 或 github_pat_…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>

          {check === 'checking' ? <p className="token-check checking">正在校验…</p> : null}

          {check === 'valid' && profile ? (
            <p className="token-check ok">
              <img className="avatar" src={profile.avatar_url} alt="" width={18} height={18} />
              已识别：{profile.name ? `${profile.name} (@${profile.login})` : `@${profile.login}`}
            </p>
          ) : null}

          {check === 'invalid' ? <p className="token-check bad">{checkMessage}</p> : null}

          {errorText ? <p className="form-error">{errorText}</p> : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>

        <div className="login-help">
          <h2>怎么拿到 Token</h2>
          <ol>
            <li>
              打开{' '}
              <a href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
                github.com/settings/tokens
              </a>{' '}
              并生成 classic token
            </li>
            <li>
              勾选 <code>repo</code> 权限
            </li>
            <li>复制后粘贴到上面，输入框会自动识别账号</li>
          </ol>

          <div className="link-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
              {copied ? '已复制 ✓' : '复制生成链接'}
            </button>
            <span className="small muted">已预填 repo 权限，打开即可生成</span>
          </div>

          <p className="hint-box">
            <b>网络提示：</b>
            <code>github.com</code> 在中国大陆的部分线路（尤其移动宽带）可能打不开，但{' '}
            <code>api.github.com</code> 通常是通的。如果上面的链接打不开，可以先用手机或其它网络生成 Token，再回来粘贴。
          </p>

          <p className="muted small">
            更安全的选择：用{' '}
            <a href={FINE_GRAINED_URL} target="_blank" rel="noreferrer noopener">
              Fine-grained token
            </a>
            ，只授权指定仓库的 <code>Contents</code> 读写（创建仓库还需 <code>Administration</code> 读写）。
          </p>
        </div>
      </div>
    </div>
  );
}
