import { redirect } from "@remix-run/node";

// The standalone recommendation-logic page was replaced by Quiz Studio's
// Logic step. Semantics change to note: the studio saves generated logic to
// the DRAFT (goes live at publish) instead of writing live immediately.
export const loader = () => redirect("/app?open=studio&step=logic");
export const action = () => redirect("/app?open=studio&step=logic");
