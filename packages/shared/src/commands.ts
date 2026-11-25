/** Names of owner-defined project commands. Kept separate to avoid import cycles. */
export const COMMAND_NAMES = ['build', 'test', 'lint'] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];
