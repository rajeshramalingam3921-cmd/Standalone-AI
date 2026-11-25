import { useState } from 'react';
import { api, type Result } from '../api';
import type { FileContent } from '@thiran/shared';
import { href, navigate } from '../router';
import { useDraft } from '../useDraft';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';
import { WorkspaceNotice } from './WorkspaceNotice';

export function FilesPanel({
  projectId,
  dir,
  file,
}: {
  projectId: string;
  dir?: string;
  file?: string;
}) {
  const [ws] = useResource(`ws:${projectId}`, () => api.workspace(projectId));
  if (ws.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (ws.state === 'error') return <ErrorBox message={ws.message} />;
  if (ws.data.state !== 'ok')
    return <WorkspaceNotice projectId={projectId} state={ws.data.state} />;
  return file !== undefined ? (
    <FileView key={file} projectId={projectId} path={file} />
  ) : (
    <DirView key={dir ?? ''} projectId={projectId} dir={dir ?? ''} />
  );
}

function Breadcrumbs({ projectId, path }: { projectId: string; path: string }) {
  const segs = path ? path.split('/') : [];
  return (
    <nav className="crumbs" aria-label="Folder path">
      <a href={href({ name: 'project', projectId, tab: 'files' })}>root</a>
      {segs.map((s, i) => {
        const p = segs.slice(0, i + 1).join('/');
        return (
          <span key={p}>
            {' / '}
            {i === segs.length - 1 ? (
              <span>{s}</span>
            ) : (
              <a href={href({ name: 'project', projectId, tab: 'files', dir: p })}>{s}</a>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function DirView({ projectId, dir }: { projectId: string; dir: string }) {
  const [entries] = useResource(`files:${projectId}:${dir}`, () => api.listFiles(projectId, dir));
  const [newName, setNewName] = useState('');

  function createFile() {
    const name = newName.trim();
    if (!name) return;
    navigate({ name: 'project', projectId, tab: 'files', file: dir ? `${dir}/${name}` : name });
  }

  return (
    <>
      <Breadcrumbs projectId={projectId} path={dir} />
      {entries.state === 'loading' && <p className="muted">ஏற்றுகிறது…</p>}
      {entries.state === 'error' && <ErrorBox message={entries.message} />}
      {entries.state === 'ready' && (
        <ul className="file-list" aria-label="Files">
          {entries.data.length === 0 && <li className="muted">காலியான folder</li>}
          {entries.data.map((e) => (
            <li key={e.path}>
              <a
                href={href({
                  name: 'project',
                  projectId,
                  tab: 'files',
                  ...(e.type === 'dir' ? { dir: e.path } : { file: e.path }),
                })}
              >
                <span aria-hidden="true">{e.type === 'dir' ? '📁' : '📄'}</span> {e.name}
                {e.size !== null && <small className="muted"> · {formatSize(e.size)}</small>}
              </a>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          createFile();
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="புதிய file பெயர் (எ.கா. login.tsx)"
          aria-label="புதிய file பெயர்"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="button button-small" disabled={!newName.trim()}>
          உருவாக்கு
        </button>
      </form>
    </>
  );
}

export function formatSize(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
}

function FileView({ projectId, path }: { projectId: string; path: string }) {
  const [file] = useResource(
    `file:${projectId}:${path}`,
    async (): Promise<Result<FileContent | null>> => {
      const r = await api.readFile(projectId, path);
      // A missing file opens as a new, empty file.
      if (!r.ok && r.code === 'file_not_found') return { ok: true, data: null };
      return r;
    },
  );
  const [editing, setEditing] = useState(false);
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  return (
    <>
      <Breadcrumbs projectId={projectId} path={path} />
      {file.state === 'loading' && <p className="muted">ஏற்றுகிறது…</p>}
      {file.state === 'error' && <ErrorBox message={file.message} />}
      {file.state === 'ready' &&
        (editing || file.data === null ? (
          <Editor
            projectId={projectId}
            path={path}
            original={file.data?.content ?? ''}
            baseSha256={file.data?.sha256 ?? null}
            onCancel={() =>
              file.data === null
                ? navigate({
                    name: 'project',
                    projectId,
                    tab: 'files',
                    ...(parent && { dir: parent }),
                  })
                : setEditing(false)
            }
          />
        ) : (
          <>
            <div className="section-head">
              <small className="muted">{formatSize(file.data.size)}</small>
              <button
                type="button"
                className="button button-small"
                onClick={() => setEditing(true)}
              >
                திருத்து
              </button>
            </div>
            <pre className="file-view" aria-label={`${path} உள்ளடக்கம்`}>
              <code>{file.data.content}</code>
            </pre>
          </>
        ))}
    </>
  );
}

function Editor({
  projectId,
  path,
  original,
  baseSha256,
  onCancel,
}: {
  projectId: string;
  path: string;
  original: string;
  baseSha256: string | null;
  onCancel: () => void;
}) {
  // Draft is tied to the exact version being edited, so a stale draft is never reused.
  const [draft, setDraft, clearDraft] = useDraft(
    `edit:${projectId}:${path}:${baseSha256 ?? 'new'}`,
    {
      content: original,
    },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function propose() {
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    const r = await api.createChange(projectId, {
      title: `${baseSha256 ? 'திருத்தம்' : 'புதிய file'}: ${path}`,
      files: [{ path, content: draft.content, baseSha256 }],
    });
    setSubmitting(false);
    if (!r.ok) return setError(r.message);
    clearDraft();
    navigate({ name: 'project', projectId, tab: 'changes', changeId: r.data.id });
  }

  return (
    <div className="form">
      <p className="muted">
        சேமிப்பது நேரடியாக file-ஐ மாற்றாது — முதலில் ஒரு மாற்றப் பரிந்துரை (diff) உருவாகும். நீங்கள் அனுமதித்த
        பிறகே எழுதப்படும்.
      </p>
      <ErrorBox message={error} />
      <textarea
        className="editor"
        value={draft.content}
        onChange={(e) => setDraft({ content: e.target.value })}
        aria-label={`${path} திருத்தம்`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={18}
      />
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => void propose()}
          disabled={submitting || draft.content === original}
        >
          {submitting ? 'உருவாக்குகிறது…' : 'மாற்றத்தைப் பரிந்துரை'}
        </button>
        <button
          type="button"
          className="button button-ghost"
          onClick={() => {
            clearDraft();
            onCancel();
          }}
        >
          ரத்து
        </button>
      </div>
    </div>
  );
}
