/**
 * Append-only record of security-relevant actions. Details hold identifiers,
 * paths, counts and outcomes only — never file contents, passwords or tokens.
 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_set',
  'project.created',
  'project.updated',
  'task.created',
  'task.action',
  'agent.plan_ready',
  'agent.change_proposed',
  'agent.finished',
  'change.created',
  'change.applied',
  'change.rejected',
  'change.reverted',
  'change.conflict',
  'command.started',
  'command.finished',
  'data.imported',
  'backup.created',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditActor = 'owner' | 'agent' | 'system';

export type AuditDetail = Record<string, string | number | boolean | null | string[]>;

export interface AuditEvent {
  id: string;
  at: string;
  actor: AuditActor;
  action: AuditAction;
  projectId: string | null;
  /** e.g. "task", "change", "run", "project", "session" */
  targetType: string | null;
  targetId: string | null;
  detail: AuditDetail;
}

export const AUDIT_ACTION_LABEL_TA: Readonly<Record<AuditAction, string>> = {
  'auth.login': 'உள்நுழைவு',
  'auth.login_failed': 'தோல்வியடைந்த உள்நுழைவு முயற்சி',
  'auth.logout': 'வெளியேற்றம்',
  'auth.password_set': 'கடவுச்சொல் அமைக்கப்பட்டது',
  'project.created': 'Project உருவாக்கப்பட்டது',
  'project.updated': 'Project மாற்றப்பட்டது',
  'task.created': 'Task உருவாக்கப்பட்டது',
  'task.action': 'Task செயல்',
  'agent.plan_ready': 'AI திட்டம் தயார்',
  'agent.change_proposed': 'AI மாற்றங்களைப் பரிந்துரைத்தது',
  'agent.finished': 'AI ஓட்டம் முடிந்தது',
  'change.created': 'மாற்றம் பரிந்துரைக்கப்பட்டது',
  'change.applied': 'மாற்றம் files-இல் எழுதப்பட்டது',
  'change.rejected': 'மாற்றம் நிராகரிக்கப்பட்டது',
  'change.reverted': 'மாற்றம் திரும்பப் பெறப்பட்டது',
  'change.conflict': 'மாற்றம் மறுக்கப்பட்டது (files மாறியிருந்தன)',
  'command.started': 'Command தொடங்கியது',
  'command.finished': 'Command முடிந்தது',
  'data.imported': 'தரவு import செய்யப்பட்டது',
  'backup.created': 'Backup எடுக்கப்பட்டது',
};

export const AUDIT_ACTOR_LABEL_TA: Readonly<Record<AuditActor, string>> = {
  owner: 'நீங்கள்',
  agent: 'AI agent',
  system: 'System',
};

/** GET /api/system/status */
export interface SystemStatus {
  version: string;
  store: 'json' | 'postgres';
  aiConfigured: boolean;
  aiProvider: 'anthropic' | 'mock';
  workspaceRoots: number;
  lastBackupAt: string | null;
  /** Rough age warning so the owner notices stale backups. */
  backupStale: boolean;
}
