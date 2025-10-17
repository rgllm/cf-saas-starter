import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  driver: 'd1-http',
  dialect: 'sqlite',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    token: process.env.CLOUDFLARE_D1_API_TOKEN!,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID!,
  },
} satisfies Config;
