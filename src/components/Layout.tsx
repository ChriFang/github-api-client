import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

function RateLimitPill() {
  const { rateLimit } = useAuth();
  if (!rateLimit) return <span className="pill pill-idle">配额 —</span>;

  const ratio = rateLimit.limit === 0 ? 0 : rateLimit.remaining / rateLimit.limit;
  const tone = ratio > 0.5 ? 'ok' : ratio > 0.15 ? 'warn' : 'danger';
  const resetText = rateLimit.reset ? formatDate(new Date(rateLimit.reset * 1000).toISOString()) : '—';

  return (
    <span
      className={`pill pill-${tone}`}
      title={`本小时剩余 ${rateLimit.remaining} / ${rateLimit.limit} 次，重置时间 ${resetText}`}
    >
      <span className="pill-dot" aria-hidden="true" />
      {rateLimit.remaining}/{rateLimit.limit}
    </span>
  );
}

function AccountMenu() {
  const { accounts, user, switchAccount, removeAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (!user) return null;

  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.name ? `${user.name} (@${user.login})` : `@${user.login}`}
      >
        <img className="avatar" src={user.avatar_url} alt="" width={22} height={22} />
        <span className="user-login">{user.login}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="account-menu menu-panel" role="menu">
          <p className="menu-label">已登录账号</p>

          {accounts.map((account) => (
            <button
              key={account.login}
              type="button"
              role="menuitem"
              className={`menu-item${account.login === user.login ? ' active' : ''}`}
              onClick={() => {
                switchAccount(account.login);
                setOpen(false);
              }}
            >
              <img className="avatar" src={account.avatar_url} alt="" width={18} height={18} />
              <span className="menu-login">{account.login}</span>
              {account.login === user.login ? <span className="menu-check">✓</span> : null}
            </button>
          ))}

          <div className="menu-sep" />

          <NavLink className="menu-item" to="/login?add=1" onClick={() => setOpen(false)}>
            + 添加账号
          </NavLink>

          <button
            type="button"
            className="menu-item menu-danger"
            onClick={() => {
              removeAccount(user.login);
              setOpen(false);
            }}
          >
            移除当前账号
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" end>
            <span className="brand-mark" aria-hidden="true">
              F
            </span>
            <span className="brand-text">
              GitHub <em>Flash</em>
            </span>
          </NavLink>

          <nav className="nav">
            <NavLink to="/" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} end>
              仓库
            </NavLink>
            <NavLink to="/new" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              新建仓库
            </NavLink>
          </nav>

          <div className="topbar-right">
            <RateLimitPill />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <footer className="footer">
        <span>数据来自 api.github.com · 本客户端不经过任何第三方服务器</span>
      </footer>
    </div>
  );
}
