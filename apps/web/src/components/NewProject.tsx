import { useState, type FormEvent } from 'react';
import { api, type Result } from '../api';
import { href, navigate } from '../router';
import { useDraft } from '../useDraft';
import { ErrorBox, fieldError } from './FieldError';

const EMPTY = { name: '', description: '', techStack: '', workspacePath: '' };

export function splitStack(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function NewProject() {
  const [form, setForm, clearDraft] = useDraft('new-project', EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Extract<Result<unknown>, { ok: false }>>();

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // no duplicate submissions from double taps
    setSubmitting(true);
    setFailure(undefined);
    const r = await api.createProject({
      name: form.name,
      description: form.description,
      techStack: splitStack(form.techStack),
      workspacePath: form.workspacePath,
    });
    setSubmitting(false);
    if (!r.ok) return setFailure(r);
    clearDraft();
    navigate({ name: 'project', projectId: r.data.id });
  }

  const issues = failure?.issues;
  return (
    <>
      <a className="back" href={href({ name: 'dashboard' })}>
        ← Projects
      </a>
      <h2>புதிய project</h2>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <ErrorBox message={failure?.message} />
        <label>
          பெயர் *
          <input value={form.name} onChange={set('name')} maxLength={80} required autoFocus />
          <ErrorBox message={fieldError(issues, 'name')} />
        </label>
        <label>
          விளக்கம்
          <textarea
            value={form.description}
            onChange={set('description')}
            rows={3}
            maxLength={1000}
          />
        </label>
        <label>
          Technology stack
          <input
            value={form.techStack}
            onChange={set('techStack')}
            placeholder="React, Node.js, PostgreSQL"
            autoCapitalize="off"
          />
          <small className="muted">காற்புள்ளியால் (,) பிரிக்கவும்</small>
          <ErrorBox message={fieldError(issues, 'techStack')} />
        </label>
        <label>
          Workspace path
          <input
            value={form.workspacePath}
            onChange={set('workspacePath')}
            placeholder="C:\code\my-project"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <small className="muted">
            குறிப்புக்காக மட்டும் சேமிக்கப்படும். File அணுகல் Phase 6-இல் வரும்.
          </small>
          <ErrorBox message={fieldError(issues, 'workspacePath')} />
        </label>
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'உருவாக்குகிறது…' : 'Project உருவாக்கு'}
        </button>
      </form>
    </>
  );
}
