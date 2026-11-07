import { useEffect, useRef, useState } from 'react';
import type { Repo } from '../lib/types';

interface AddressOption {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

function fallbackCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export default function RepoAddressMenu({ repo }: { repo: Pick<Repo, 'full_name' | 'html_url'> }) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!copiedKey) return;
    const timer = setTimeout(() => setCopiedKey(null), 1800);
    return () => clearTimeout(timer);
  }, [copiedKey]);

  const options: AddressOption[] = [
    {
      key: 'ssh',
      label: 'SSH',
      value: `git@github.com:${repo.full_name}.git`,
      hint: '22 端口通常可用，本网络下最稳',
    },
    {
      key: 'https',
      label: 'HTTPS',
      value: `${repo.html_url}.git`,
      hint: '需要 github.com 的 443 端口可达',
    },
    {
      key: 'web',
      label: '网页地址',
      value: repo.html_url,
    },
    {
      key: 'cli',
      label: 'GitHub CLI',
      value: `gh repo clone ${repo.full_name}`,
    },
  ];

  const copy = async (option: AddressOption) => {
    setFailed(false);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(option.value);
        setCopiedKey(option.key);
        return;
      }
      if (fallbackCopy(option.value)) setCopiedKey(option.key);
      else setFailed(true);
    } catch {
      if (fallbackCopy(option.value)) setCopiedKey(option.key);
      else setFailed(true);
    }
  };

  return (
    <div className="dropdown" ref={containerRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        获取地址
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="menu-panel addr-menu" role="menu">
          <p className="menu-label">克隆 / 仓库地址</p>

          {options.map((option) => (
            <div className="addr-row" key={option.key}>
              <div className="addr-info">
                <span className="addr-label">{option.label}</span>
                <code className="addr-value" title={option.value}>
                  {option.value}
                </code>
                {option.hint ? <span className="addr-hint">{option.hint}</span> : null}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => copy(option)}
                aria-label={`复制 ${option.label} 地址`}
              >
                {copiedKey === option.key ? '已复制 ✓' : '复制'}
              </button>
            </div>
          ))}

          {failed ? <p className="addr-error">复制失败，请手动选中文本复制</p> : null}

          <div className="menu-sep" />

          <a className="menu-item" href={repo.html_url} target="_blank" rel="noreferrer noopener">
            在 GitHub 网页打开 ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}
