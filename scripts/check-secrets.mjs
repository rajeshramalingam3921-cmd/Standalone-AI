#!/usr/bin/env node
// Scan files tracked by git for things that look like real credentials.
// Fails (exit 1) with file:line on a hit. Test fixtures use obviously fake, short values.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{32,}/],
  ['OpenAI API key', /sk-(?:proj-)?[A-Za-z0-9]{40,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{20,}/],
  // postgres URL with a non-placeholder password
  [
    'Database URL with password',
    /postgres(?:ql)?:\/\/[^:\s/]+:(?!CHANGE_ME|ci-only-password|p@|\$|\{)[^@\s'"]{8,}@/,
  ],
];
const FORBIDDEN_FILES = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$|sample$)/,
  /\.pem$/,
  /(^|\/)id_(rsa|ed25519)$/,
];

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const hits = [];
for (const f of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(f)))
    hits.push(`${f}: file type must never be committed`);
  if (f === 'pnpm-lock.yaml') continue;
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS)
      if (re.test(line)) hits.push(`${f}:${i + 1}: possible ${name}`);
  });
}
if (hits.length) {
  process.stderr.write(`Possible secrets found (${hits.length}):\n${hits.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`No secrets found in ${files.length} files.\n`);
