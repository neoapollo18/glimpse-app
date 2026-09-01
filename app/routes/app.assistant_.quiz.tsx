import { redirect } from "@remix-run/node";

// The standalone quiz copy & design page is fully absorbed by Quiz Studio:
// Intro / Photo / Results slide editors + the Theme item cover every field
// (copy, images with upload, shade picker, alt audience, colors, radii,
// fonts, layout, animations), edited next to the live preview and published
// with the draft.
export const loader = () => redirect("/app?open=studio&step=build");
export const action = () => redirect("/app?open=studio&step=build");
