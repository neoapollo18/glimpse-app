// Shared plumbing for one-off ops scripts that need a shop's offline
// Admin API access: session-token lookup (Prisma Session table) + a
// fetch-based GraphQL callback shaped like the app's admin callbacks.
//
// API version tracks app/shopify.server.ts (ApiVersion.January25) — the
// same version authenticate.admin uses, so script-built data matches the
// in-app builds it mirrors. Bump both together.

import { PrismaClient } from "@prisma/client";

export const APP_ADMIN_API_VERSION = "2025-01";

export type AdminGraphql = (
  query: string,
  variables?: Record<string, unknown>
) => Promise<unknown>;

export async function offlineAdminGraphql(shopDomain: string): Promise<AdminGraphql> {
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
  });
  await prisma.$disconnect();
  if (!session?.accessToken) {
    throw new Error(`No offline session token for ${shopDomain}`);
  }
  const accessToken = session.accessToken;

  return async (query, variables) => {
    const res = await fetch(
      `https://${shopDomain}/admin/api/${APP_ADMIN_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      }
    );
    if (!res.ok) throw new Error(`Admin API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: unknown; errors?: Array<{ message?: string }> };
    if (body.errors?.length) {
      throw new Error(`offline-admin graphql: ${body.errors[0]?.message ?? "error"}`);
    }
    return body.data;
  };
}
