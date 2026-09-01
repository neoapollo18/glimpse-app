import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * The deployed DATABASE_URL points at Supabase's pgbouncer pooler with
 * connection_limit=1 — a single slot shared by EVERY concurrent request in
 * the process. A burst of product webhooks queued all session lookups for
 * the full 10s pool timeout and 500'd the whole app (P2024 storms,
 * 2026-08-31 incident). Behind pgbouncer (transaction mode, port 6543)
 * Prisma "connections" are cheap client slots, so raise the floor here and
 * give the queue more headroom; an env URL that already sets a limit of 5+
 * is respected.
 */
function pooledUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const limit = Number(url.searchParams.get("connection_limit") ?? "0");
    if (!limit || limit < 5) url.searchParams.set("connection_limit", "10");
    if (!url.searchParams.get("pool_timeout")) url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    datasources: { db: { url: pooledUrl() } },
  });

// Prevent multiple instances in development (hot reloading)
if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}

export default prisma;
