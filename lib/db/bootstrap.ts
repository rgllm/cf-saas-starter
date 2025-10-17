const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT(100),
    email TEXT(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT(20) DEFAULT 'member' NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch()) NOT NULL,
    deleted_at INTEGER
  );`,
  `CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT(100) NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch()) NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_product_id TEXT,
    plan_name TEXT(50),
    subscription_status TEXT(20)
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS teams_stripe_customer_id_unique ON teams (stripe_customer_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS teams_stripe_subscription_id_unique ON teams (stripe_subscription_id);`,
  `CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    role TEXT(50) NOT NULL,
    joined_at INTEGER DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON UPDATE NO ACTION ON DELETE NO ACTION
  );`,
  `CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    team_id INTEGER NOT NULL,
    email TEXT(255) NOT NULL,
    role TEXT(50) NOT NULL,
    invited_by INTEGER NOT NULL,
    invited_at INTEGER DEFAULT (unixepoch()) NOT NULL,
    status TEXT(20) DEFAULT 'pending' NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
    FOREIGN KEY (invited_by) REFERENCES users(id) ON UPDATE NO ACTION ON DELETE NO ACTION
  );`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    team_id INTEGER NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    timestamp INTEGER DEFAULT (unixepoch()) NOT NULL,
    ip_address TEXT(45),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE NO ACTION ON DELETE NO ACTION
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);`
] as const;

type D1PreparedStatement = {
  run(): Promise<unknown>;
  bind(...params: unknown[]): D1PreparedStatement;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatement;
};

let bootstrapPromise: Promise<void> | null = null;

function isD1DatabaseLike(candidate: unknown): candidate is D1DatabaseLike {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as D1DatabaseLike).prepare === "function"
  );
}

export async function ensureD1Schema(db: unknown): Promise<void> {
  if (!isD1DatabaseLike(db)) {
    throw new Error("Cloudflare D1 binding is not available.");
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      for (const statement of MIGRATION_STATEMENTS) {
        await db.prepare(statement).run();
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  await bootstrapPromise;
}

export const BOOTSTRAP_STATEMENTS = MIGRATION_STATEMENTS;
