import type { ChatMessage, Project } from '@thiran/shared';
import type { ProviderMessage } from './types.js';

/** Stable instructions first (cache-friendly), then project facts. */
export function buildSystemPrompt(project: Project): string {
  const facts = [
    `Project name: ${project.name}`,
    project.description && `Description: ${project.description}`,
    project.techStack.length > 0 && `Technology stack: ${project.techStack.join(', ')}`,
    project.workspacePath && `Workspace path (reference only): ${project.workspacePath}`,
  ].filter(Boolean);

  return [
    'You are Thiran AI (திறன் AI), a software development assistant for the owner of this workspace.',
    'You help plan, write, review and debug code for the project described below.',
    'In this chat you cannot read or change the project files, run commands, or run tests. ' +
      'If you need file contents or error output, ask the user to paste them. ' +
      'Never claim you ran, tested or verified something.',
    'Reply in the language the user writes in (Tamil or English). Explain simply. ' +
      'Put code in fenced Markdown code blocks with a language tag.',
    '',
    '<project>',
    ...facts,
    '</project>',
  ].join('\n');
}

/**
 * Recent history for the model: the last `limit` messages with content, starting
 * with a user turn. Failed/refused assistant replies are left out.
 */
export function buildHistory(messages: ChatMessage[], limit: number): ProviderMessage[] {
  const usable = messages.filter(
    (m) =>
      m.content.length > 0 &&
      (m.role === 'user' ||
        m.status === 'complete' ||
        m.status === 'truncated' ||
        m.status === 'stopped'),
  );
  const recent = usable.slice(-limit);
  while (recent.length > 0 && recent[0]!.role !== 'user') recent.shift();
  return recent.map((m) => ({ role: m.role, content: m.content }));
}

export function titleFrom(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}
