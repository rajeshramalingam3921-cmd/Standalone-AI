import { useState, type FormEvent } from 'react';
import { COMMAND_NAMES, type CommandName, type Project } from '@thiran/shared';
import { api } from '../api';
import { useResource } from '../useResource';
import { ErrorBox, fieldError } from './FieldError';
import { WorkspaceNotice } from './WorkspaceNotice';

/** "pnpm test --run" → ["pnpm","test","--run"]. Arguments containing spaces are not supported here. */
export function splitArgs(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

export function SettingsPanel({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [ws, reloadWs] = useResource(`ws:${project.id}`, () => api.workspace(project.id));
  const [path, setPath] = useState(project.workspacePath);
  const [cmds, setCmds] = useState<Record<CommandName, string>>(() => ({
    build: project.commands.build?.join(' ') ?? '',
    test: project.commands.test?.join(' ') ?? '',
    lint: project.commands.lint?.join(' ') ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    issues?: { path: string; message: string }[];
  }>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setFailure(undefined);
    const commands = Object.fromEntries(
      COMMAND_NAMES.filter((n) => cmds[n].trim()).map((n) => [n, splitArgs(cmds[n])]),
    );
    const r = await api.updateProject(project.id, { workspacePath: path.trim(), commands });
    setSaving(false);
    if (!r.ok) return setFailure(r);
    setSaved(true);
    onSaved();
    await reloadWs();
  }

  return (
    <form className="card form" onSubmit={onSubmit} aria-label="Project settings">
      <h3>Project folder</h3>
      {ws.state === 'ready' && ws.data.state === 'ok' && (
        <p className="badge tone-done">Folder அணுகக்கூடியது ✓</p>
      )}
      {ws.state === 'ready' && <WorkspaceNotice projectId={project.id} state={ws.data.state} />}
      <ErrorBox message={failure?.message} />
      <label>
        Folder பாதை (server கணினியில்)
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\code\restaurant-pos"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <small className="muted">
          WORKSPACE_ROOTS-க்குள் இருக்க வேண்டும். .env, keys, .git, node_modules போன்றவை ஒருபோதும்
          படிக்கப்படாது.
        </small>
      </label>

      <h3>அனுமதிக்கப்பட்ட commands</h3>
      <p className="muted">
        இவை மட்டுமே project folder-இல் ஓட முடியும். Shell இல்லை (|, &amp;&amp;, &gt; வேலை செய்யாது). AI
        இவற்றை மாற்ற முடியாது.
      </p>
      {COMMAND_NAMES.map((n) => (
        <label key={n}>
          {n}
          <input
            value={cmds[n]}
            onChange={(e) => setCmds((c) => ({ ...c, [n]: e.target.value }))}
            placeholder={n === 'build' ? 'pnpm build' : n === 'test' ? 'pnpm test' : 'pnpm lint'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <ErrorBox message={fieldError(failure?.issues, `commands.${n}`)} />
        </label>
      ))}
      <button type="submit" className="button" disabled={saving}>
        {saving ? 'சேமிக்கிறது…' : 'சேமி'}
      </button>
      {saved && <p className="badge tone-done">சேமிக்கப்பட்டது</p>}
    </form>
  );
}
