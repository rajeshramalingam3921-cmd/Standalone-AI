import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AI_ERROR_LABEL_TA,
  CHAT_MESSAGE_MAX_CHARS,
  type AiStatus,
  type ChatMessage,
  type Conversation,
} from '@thiran/shared';
import { api, streamChat } from '../api';
import { href, navigate } from '../router';
import { useDraft } from '../useDraft';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';
import { MessageContent } from './MessageContent';

const STATUS_NOTE_TA: Partial<Record<ChatMessage['status'], string>> = {
  truncated: 'பதில் நீள வரம்பில் துண்டிக்கப்பட்டது',
  refused: 'பாதுகாப்புக் காரணங்களால் AI இதற்குப் பதிலளிக்கவில்லை',
  stopped: 'நிறுத்தப்பட்டது',
};

export function messageNote(m: ChatMessage): string | undefined {
  if (m.status === 'error') return m.error ? AI_ERROR_LABEL_TA[m.error] : AI_ERROR_LABEL_TA.unknown;
  return STATUS_NOTE_TA[m.status];
}

export function ChatPanel({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId?: string;
}) {
  const [status] = useResource('ai-status', () => api.aiStatus());
  const [convs, reloadConvs] = useResource(`convs:${projectId}`, () =>
    api.listConversations(projectId),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  async function newConversation() {
    if (creating) return;
    setCreating(true);
    setError(undefined);
    const r = await api.createConversation(projectId);
    setCreating(false);
    if (!r.ok) return setError(r.message);
    await reloadConvs();
    navigate({ name: 'project', projectId, tab: 'chat', conversationId: r.data.id });
  }

  if (status.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (status.state === 'error') return <ErrorBox message={status.message} />;
  const ai = status.data;

  return (
    <>
      {ai.provider === 'mock' && (
        <p className="notice">Mock provider இயங்குகிறது — பதில்கள் சோதனைக்கானவை, உண்மையான AI அல்ல.</p>
      )}
      {!ai.configured && (
        <section className="card notice">
          <strong>AI இன்னும் அமைக்கப்படவில்லை</strong>
          <p>
            Server கணினியில் உள்ள <code>.env</code> file-இல் <code>ANTHROPIC_API_KEY</code>-ஐச் சேர்த்து
            server-ஐ மீண்டும் தொடங்குங்கள். Key console.anthropic.com-இல் கிடைக்கும்; Claude subscription-இல்
            API key சேர்ந்து வராது.
          </p>
        </section>
      )}
      <ErrorBox message={error} />

      {conversationId ? (
        <ConversationView
          key={conversationId}
          projectId={projectId}
          conversationId={conversationId}
          ai={ai}
          conversation={
            convs.state === 'ready' ? convs.data.find((c) => c.id === conversationId) : undefined
          }
          onActivity={() => void reloadConvs()}
        />
      ) : (
        <>
          <div className="section-head">
            <h2>உரையாடல்கள்</h2>
            <button
              type="button"
              className="button button-small"
              onClick={() => void newConversation()}
              disabled={creating || !ai.configured}
            >
              + புதிய உரையாடல்
            </button>
          </div>
          {convs.state === 'ready' && convs.data.length === 0 && (
            <p className="muted empty">இன்னும் உரையாடல் இல்லை.</p>
          )}
          {convs.state === 'error' && <ErrorBox message={convs.message} />}
          <ul className="list" aria-label="Conversations">
            {convs.state === 'ready' &&
              convs.data.map((c) => (
                <li key={c.id}>
                  <a
                    className="card card-link"
                    href={href({ name: 'project', projectId, tab: 'chat', conversationId: c.id })}
                  >
                    <strong>{c.title || 'பெயரில்லா உரையாடல்'}</strong>
                    <small className="muted">
                      {ai.models.find((m) => m.id === c.model)?.label ?? c.model} ·{' '}
                      {new Date(c.updatedAt).toLocaleString('ta-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </small>
                  </a>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}

function ConversationView({
  projectId,
  conversationId,
  ai,
  conversation,
  onActivity,
}: {
  projectId: string;
  conversationId: string;
  ai: AiStatus;
  conversation: Conversation | undefined;
  onActivity: () => void;
}) {
  const [loaded, reload] = useResource(`msgs:${conversationId}`, () =>
    api.listMessages(projectId, conversationId),
  );
  // Messages added during this screen's life (optimistic + streaming) on top of loaded ones.
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>();
  const [draft, setDraft, clearDraft] = useDraft(`chat:${conversationId}`, { content: '' });
  const [model, setModel] = useState<string>();
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const sending = streamingText !== undefined;
  const selectedModel = model ?? conversation?.model ?? ai.defaultModel;

  const base = loaded.state === 'ready' ? loaded.data : [];
  const seen = new Set(base.map((m) => m.id));
  const messages = [...base, ...live.filter((m) => !seen.has(m.id))];

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, streamingText]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(content: string) {
    if (sending || !content.trim()) return;
    setError(undefined);
    const ac = new AbortController();
    abortRef.current = ac;
    setStreamingText('');
    const r = await streamChat(
      projectId,
      conversationId,
      { content, model: selectedModel },
      (e) => {
        if (e.type === 'start') {
          setLive((l) => [...l, e.userMessage]);
          clearDraft();
        } else if (e.type === 'delta') {
          setStreamingText((t) => (t ?? '') + e.text);
        } else if (e.type === 'done' || e.type === 'error') {
          const msg = e.message;
          if (msg) setLive((l) => [...l, msg]);
          if (e.type === 'error' && !msg) setError(AI_ERROR_LABEL_TA.unknown);
        }
      },
      ac.signal,
    );
    setStreamingText(undefined);
    abortRef.current = undefined;
    if (!r.ok) setError(r.message);
    if (r.ok && r.data.stopped) {
      // The server stores the partial reply when it notices the disconnect.
      setTimeout(() => void reload().then(() => setLive([])), 400);
    }
    onActivity();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft.content);
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const last = messages.at(-1);
  const canRetry = !sending && last?.role === 'assistant' && last.status === 'error' && lastUser;

  return (
    <div className="chat">
      <div className="chat-head">
        <a className="back" href={href({ name: 'project', projectId, tab: 'chat' })}>
          ← உரையாடல்கள்
        </a>
        <label className="model-select">
          <span className="visually-hidden">Model</span>
          <select
            value={selectedModel}
            onChange={(e) => setModel(e.target.value)}
            disabled={sending}
          >
            {ai.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loaded.state === 'loading' && <p className="muted">ஏற்றுகிறது…</p>}
      {loaded.state === 'error' && <ErrorBox message={loaded.message} />}

      <ol className="messages" aria-label="Messages" aria-live="polite">
        {messages.length === 0 && loaded.state === 'ready' && (
          <li className="muted empty">
            உங்கள் project பற்றி எதையும் கேளுங்கள். இந்த உரையாடலில் AI உங்கள் files-ஐப் படிக்கவோ commands-ஐ
            ஓட்டவோ முடியாது.
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={`msg msg-${m.role}`} data-status={m.status}>
            {m.content && <MessageContent content={m.content} />}
            {messageNote(m) && (
              <p className={`msg-note ${m.status === 'error' ? 'msg-note-error' : ''}`}>
                {messageNote(m)}
              </p>
            )}
            {m.role === 'assistant' && m.model && (
              <small className="muted">
                {ai.models.find((x) => x.id === m.model)?.label ?? m.model}
                {m.usage && ` · ${m.usage.inputTokens + m.usage.outputTokens} tokens`}
              </small>
            )}
          </li>
        ))}
        {sending && (
          <li className="msg msg-assistant" data-status="streaming">
            {streamingText ? (
              <MessageContent content={streamingText} />
            ) : (
              <p className="muted">யோசிக்கிறது…</p>
            )}
          </li>
        )}
      </ol>
      <div ref={endRef} />

      <ErrorBox message={error} />
      {canRetry && (
        <button
          type="button"
          className="button button-ghost"
          onClick={() => void send(lastUser.content)}
        >
          மீண்டும் முயற்சி செய்
        </button>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="chat-input">
          செய்தி
        </label>
        <textarea
          id="chat-input"
          value={draft.content}
          onChange={(e) => setDraft({ content: e.target.value })}
          placeholder="செய்தியை எழுதுங்கள்…"
          rows={3}
          maxLength={CHAT_MESSAGE_MAX_CHARS}
          disabled={!ai.configured}
        />
        {sending ? (
          <button
            type="button"
            className="button button-danger"
            onClick={() => abortRef.current?.abort()}
          >
            நிறுத்து
          </button>
        ) : (
          <button
            type="submit"
            className="button"
            disabled={!ai.configured || !draft.content.trim()}
          >
            அனுப்பு
          </button>
        )}
      </form>
    </div>
  );
}
