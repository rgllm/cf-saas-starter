import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";

import { ensureD1Schema } from "./bootstrap";
import * as schema from "./schema";

type D1Client = Parameters<typeof drizzle>[0];

function resolveD1Database(env: unknown): D1Client {
  if (!env || typeof env !== "object") {
    throw new Error("Cloudflare bindings are not available.");
  }

  const envRecord = env as Record<string, unknown>;
  const configuredBinding =
    process.env.CLOUDFLARE_D1_BINDING ??
    (typeof envRecord.CLOUDFLARE_D1_BINDING === "string"
      ? envRecord.CLOUDFLARE_D1_BINDING
      : undefined);
  const preferredBindingName = configuredBinding?.trim() || "DB";
  const binding =
    envRecord[preferredBindingName] ?? envRecord.MY_D1 ?? envRecord.DB;

  if (!binding) {
    const available = Object.keys(envRecord).sort().join(", ") || "none";
    throw new Error(
      `Missing Cloudflare D1 binding "${preferredBindingName}". Available bindings: ${available}.`
    );
  }

  return binding as D1Client;
}

export const getDb = cache(async () => {
  const { env } = await getCloudflareContext({ async: true });
  const binding = resolveD1Database(env);
  await ensureD1Schema(binding);
  return drizzle(binding, { schema });
});

export const getDbAsync = getDb;
