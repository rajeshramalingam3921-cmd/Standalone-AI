import { z } from 'zod';
import { COMMAND_NAMES } from './commands.js';

/** Where the agent is in the plan → approve → execute → review diff → verify → report flow. */
export const AGENT_PHASES = [
  'planning',
  'awaiting_plan_approval',
  'executing',
  'awaiting_diff',
  'verifying',
  'done',
  'stopped',
] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export const AgentPlanSchema = z.object({
  summary: z.string().min(1).max(4000),
  steps: z.array(z.string().min(1).max(1000)).min(1).max(30),
  files: z.array(z.string().min(1).max(400)).max(50),
  checks: z.array(z.enum(COMMAND_NAMES)).max(3),
});
export type AgentPlan = z.output<typeof AgentPlanSchema>;

export const AgentActivitySchema = z.object({
  at: z.iso.datetime(),
  kind: z.enum(['info', 'tool', 'error']),
  text: z.string().max(2000),
});
export type AgentActivity = z.output<typeof AgentActivitySchema>;

export const AgentCheckResultSchema = z.object({
  name: z.enum(COMMAND_NAMES),
  status: z.enum(['running', 'passed', 'failed', 'timeout', 'error']),
  exitCode: z.number().int().nullable(),
  runId: z.string(),
});
export type AgentCheckResult = z.output<typeof AgentCheckResultSchema>;

export const TaskAgentStateSchema = z.object({
  /** Execution attempts used (each approve → execute counts one). */
  attempts: z.number().int().min(0),
  /** Plans produced (re-plans after feedback or failure count too). */
  plans: z.number().int().min(0),
  phase: z.enum(AGENT_PHASES),
  plan: AgentPlanSchema.nullable(),
  /** Owner feedback for the next plan (request changes). */
  feedback: z.string().max(4000).nullable(),
  changeSetId: z.string().nullable(),
  checks: z.array(AgentCheckResultSchema),
  /** Agent's own short summary (Tamil) of what it changed. */
  summary: z.string().max(4000).nullable(),
  /** Final Tamil report, built by the server from facts (not by the model). */
  report: z.string().max(20000).nullable(),
  error: z.string().max(2000).nullable(),
  activity: z.array(AgentActivitySchema).max(300),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
});
export type TaskAgentState = z.output<typeof TaskAgentStateSchema>;

export const AGENT_PHASE_LABEL_TA: Readonly<Record<AgentPhase, string>> = {
  planning: 'AI திட்டமிடுகிறது',
  awaiting_plan_approval: 'திட்டம் உங்கள் அனுமதிக்காகக் காத்திருக்கிறது',
  executing: 'AI மாற்றங்களைத் தயாரிக்கிறது',
  awaiting_diff: 'மாற்றங்கள் (diff) உங்கள் அனுமதிக்காகக் காத்திருக்கின்றன',
  verifying: 'சோதனைகள் ஓடுகின்றன',
  done: 'முடிந்தது',
  stopped: 'நிறுத்தப்பட்டது',
};
