import { defineConfig } from 'drizzle-kit';

// Used only to *generate* SQL migration files from src/db/schema.ts.
// Applying them is a separate, explicit step: `pnpm db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
