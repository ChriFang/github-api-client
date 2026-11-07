import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, GitHubError } from '../lib/api';
import type { CreateRepoInput } from '../lib/types';

const GITIGNORE_TEMPLATES = [
  ['', '不添加'],
  ['Node', 'Node'],
  ['Python', 'Python'],
  ['Go', 'Go'],
  ['Rust', 'Rust'],
  ['Java', 'Java'],
  ['C++', 'C++'],
  ['Unity', 'Unity'],
  ['VisualStudio', 'Visual Studio'],
  ['macOS', 'macOS'],
  ['Windows', 'Windows'],
] as const;

const LICENSE_TEMPLATES = [
  ['', '不添加'],
  ['mit', 'MIT'],
  ['apache-2.0', 'Apache 2.0'],
  ['gpl-3.0', 'GPL 3.0'],
  ['bsd-3-clause', 'BSD 3-Clause'],
  ['mpl-2.0', 'MPL 2.0'],
  ['unlicense', 'Unlicense'],
] as const;

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export default function NewRepoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [autoInit, setAutoInit] = useState(true);
  const [gitignore, setGitignore] = useState('');
  const [license, setLicense] = useState('');

  const needsInit = autoInit || gitignore !== '' || license !== '';

  const mutation = useMutation({
    mutationFn: (input: CreateRepoInput) => api.createRepo(input),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      navigate(`/r/${created.owner.login}/${created.name}`, { replace: true });
    },
  });

  const nameError =
    name.length === 0
      ? null
      : !NAME_PATTERN.test(name)
        ? '只能包含字母、数字、点、下划线和连字符'
        : name.length > 100
          ? '名称不能超过 100 个字符'
          : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nameError || name.length === 0) return;

    const input: CreateRepoInput = {
      name,
      private: isPrivate,
      auto_init: needsInit,
    };
    if (description.trim()) input.description = description.trim();
    if (gitignore) input.gitignore_template = gitignore;
    if (license) input.license_template = license;

    mutation.mutate(input);
  };

  const errorText =
    mutation.error instanceof GitHubError
      ? mutation.error.kind === 'validation'
        ? `创建失败：${mutation.error.message}`
        : mutation.error.message
      : mutation.error
        ? '创建失败，请重试'
        : null;

  return (
    <div className="stack narrow">
      <section className="page-head">
        <div>
          <h1>新建仓库</h1>
          <p className="muted">
            对应接口 <code>POST /user/repos</code>，需要 Token 具备 <code>repo</code> 权限。
          </p>
        </div>
      </section>

      <form className="card form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">
            仓库名称 <b className="req">*</b>
          </span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="my-project"
            autoFocus
            spellCheck={false}
          />
          {nameError ? <span className="form-error">{nameError}</span> : null}
        </label>

        <label className="field">
          <span className="field-label">描述</span>
          <input
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="一句话说明这个仓库是做什么的"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">.gitignore 模板</span>
            <select
              className="input"
              value={gitignore}
              onChange={(event) => setGitignore(event.target.value)}
            >
              {GITIGNORE_TEMPLATES.map(([value, label]) => (
                <option value={value} key={value || 'none'}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">开源许可证</span>
            <select
              className="input"
              value={license}
              onChange={(event) => setLicense(event.target.value)}
            >
              {LICENSE_TEMPLATES.map(([value, label]) => (
                <option value={value} key={value || 'none'}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="checks">
          <label className="check">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
            />
            <span>私有仓库</span>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={autoInit || gitignore !== '' || license !== ''}
              disabled={gitignore !== '' || license !== ''}
              onChange={(event) => setAutoInit(event.target.checked)}
            />
            <span>初始化 README（选择模板时必开）</span>
          </label>
        </div>

        {errorText ? <p className="form-error">{errorText}</p> : null}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending || name === '' || !!nameError}>
            {mutation.isPending ? '创建中…' : '创建仓库'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
