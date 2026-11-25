import {
  RUN_STATUS_LABEL_TA,
  type ChangeSetView,
  type Task,
  type TaskAgentState,
} from '@thiran/shared';

/**
 * Final report in Tamil, assembled from recorded facts only (plan, diff stats,
 * check results). The model's own summary is quoted and labelled as such.
 */
export function buildReport(
  task: Task,
  agent: TaskAgentState,
  outcome: 'completed' | 'needs_attention' | 'failed',
  reason: string,
  change: ChangeSetView | null,
  maxAttempts: number,
): string {
  const lines: string[] = [];
  const head = { completed: '✅ முடிந்தது', needs_attention: '⚠️ கவனம் தேவை', failed: '❌ தோல்வி' }[
    outcome
  ];
  lines.push(`# அறிக்கை: ${task.title}`, '', `**முடிவு:** ${head} — ${reason}`, '');
  lines.push(`**முயற்சி:** ${agent.attempts} / ${maxAttempts}`, '');
  if (agent.plan) {
    lines.push('## அனுமதிக்கப்பட்ட திட்டம்', agent.plan.summary, '');
    agent.plan.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  if (change) {
    lines.push('## மாற்றப்பட்ட files');
    for (const f of change.files) {
      lines.push(
        `- \`${f.path}\` ${f.action === 'create' ? '(புதியது) ' : ''}+${f.additions} −${f.deletions}`,
      );
    }
    lines.push('');
  }
  lines.push('## சோதனைகள்');
  if (agent.checks.length === 0) lines.push('- எந்தச் சோதனையும் ஓடவில்லை.');
  for (const c of agent.checks) {
    lines.push(
      `- ${c.name}: ${RUN_STATUS_LABEL_TA[c.status]}${c.exitCode !== null ? ` (exit ${c.exitCode})` : ''}`,
    );
  }
  lines.push('');
  if (agent.summary) lines.push('## AI-இன் சொந்தக் குறிப்பு (சரிபார்க்கப்படாதது)', agent.summary, '');
  lines.push(
    `_Tokens: ${agent.usage.inputTokens.toLocaleString('en')} input, ${agent.usage.outputTokens.toLocaleString('en')} output._`,
  );
  return lines.join('\n');
}
