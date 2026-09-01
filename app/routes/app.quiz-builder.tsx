import { redirect } from "@remix-run/node";

// The Quiz Builder page was replaced by Quiz Studio (the full-screen
// takeover editor hosted by the quiz hub). Catalog sync moved to
// /app/api/catalog-sync; everything else lives in /studio.
export const loader = () => redirect("/app?open=studio&step=build");
export const action = () => redirect("/app?open=studio&step=build");
