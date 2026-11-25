import { useState } from 'react';

type Part = { kind: 'text'; text: string } | { kind: 'code'; lang: string; code: string };

/** Split Markdown-style ``` fences. Everything is rendered as text — never as HTML. */
export function splitFences(content: string): Part[] {
  const parts: Part[] = [];
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push({ kind: 'text', text: content.slice(last, m.index) });
    parts.push({ kind: 'code', lang: m[1] ?? '', code: (m[2] ?? '').replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < content.length) parts.push({ kind: 'text', text: content.slice(last) });
  return parts;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) */
    }
  }
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{lang || 'code'}</span>
        <button type="button" className="link-button" onClick={() => void copy()}>
          {copied ? 'நகலெடுக்கப்பட்டது ✓' : 'நகலெடு'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MessageContent({ content }: { content: string }) {
  return (
    <>
      {splitFences(content).map((p, i) =>
        p.kind === 'code' ? (
          <CodeBlock key={i} lang={p.lang} code={p.code} />
        ) : (
          <p key={i} className="pre msg-text">
            {p.text.replace(/^\n+|\n+$/g, '')}
          </p>
        ),
      )}
    </>
  );
}
