import { redirect } from "@remix-run/node";

// The standalone questions editor was replaced by Quiz Studio's Build step
// (slide tree + live preview + branching). Patch-merge editing logic lives
// on in app/lib/question-axis.server.ts consumers and the studio appliers.
export const loader = () => redirect("/app/quiz?open=studio&step=build");
export const action = () => redirect("/app/quiz?open=studio&step=build");
