import type { ReactNode } from "react";

// The studio's app-shell grid. Plain CSS on purpose: Polaris has no
// full-viewport shell primitives, and Page/Layout would fight the takeover.
// Scroll containment: the shell never scrolls; each region owns its own
// overflow (rail scrolls, canvas decides per step, panel body scrolls).
// Every region is placed explicitly so the overlay (template gallery,
// onboarding states) can sit on the whole body row whatever the top bar's
// height. Phones get one scrolling column (Built for Shopify 4.1.2).

const SHELL_CSS = `
  /* V2-SPEC 2.1: 56px topbar, 240px left rail, 320px right rail. */
  .studio-root { display: grid; grid-template-columns: 240px minmax(0, 1fr) 320px; grid-template-rows: 56px minmax(0, 1fr); height: 100dvh; overflow: hidden; background: #fff; font-size: 13px; }
  .studio-topbar { grid-column: 1 / -1; grid-row: 1; display: grid; grid-template-columns: 240px minmax(0, 1fr) 320px; align-items: center; border-bottom: 1px solid #E1E3E5; background: #fff; z-index: 20; }
  .studio-topbar-left { display: flex; align-items: center; gap: 10px; padding: 0 16px; min-width: 0; height: 100%; }
  .studio-topbar-left .Polaris-Badge { display: inline-flex; align-items: center; }
  /* Same columns as the body (even when Publish lives in the admin title
     bar and the right cell is empty) so Build / Check matches / Live sits
     centred over the quiz preview. */
  .studio-topbar-center { display: flex; justify-content: center; align-items: center; min-width: 0; height: 100%; }
  .studio-topbar-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 16px; height: 100%; }
  .studio-rail { grid-column: 1; grid-row: 2; overflow-y: auto; border-right: 1px solid #E1E3E5; display: flex; flex-direction: column; min-height: 0; }
  .studio-canvas { grid-column: 2; grid-row: 2; background: #F6F6F7; min-width: 0; min-height: 0; position: relative; display: flex; flex-direction: column; }
  .studio-panel { grid-column: 3; grid-row: 2; border-left: 1px solid #E1E3E5; display: flex; flex-direction: column; min-height: 0; background: #fff; }
  .studio-overlay { grid-column: 1 / -1; grid-row: 2; z-index: 30; background: #fff; overflow-y: auto; min-height: 0; }
  .studio-tree-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; text-align: left; font-size: 13px; color: #202223; }
  .studio-tree-row:hover { background: #F6F6F7; }
  .studio-tree-row[data-selected="true"] { background: #F1F1F1; box-shadow: inset 3px 0 0 #1a1a1a; }
  .studio-tree-row[data-flash="true"] { animation: studio-flash 1.5s ease-out; }
  @keyframes studio-flash { 0% { background: #FFF8E1; } 100% { background: transparent; } }
  .studio-thinking { font-size: 13px; font-weight: 500; background: linear-gradient(90deg, #8C9196 25%, #1a1a1a 50%, #8C9196 75%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: studio-shimmer 1.4s linear infinite; }
  @keyframes studio-shimmer { 0% { background-position: 200% 0; } 100% { background-position: 0% 0; } }
  /* Panel tabs: same look on every Studio tab, so switching never moves
     or recolors them (navigation guideline). */
  .studio-panel-tabs { display: flex; border-bottom: 1px solid #E1E3E5; background: #fff; }
  .studio-panel-tabs > * { flex: 1; min-width: 0; }
  .studio-panel-tab { flex: 1; border: 0; background: transparent; padding: 10px 0; font-size: 13px; font-weight: 600; color: #616161; cursor: pointer; border-bottom: 2px solid transparent; }
  .studio-panel-tab[data-active="true"] { color: #202223; border-bottom-color: #1a1a1a; }
  .studio-panel-tab:disabled { color: #8A8A8A; cursor: default; }
  .studio-panel-tab svg { width: 16px; height: 16px; fill: currentColor; vertical-align: -3px; margin-right: 4px; }
  @media (max-width: 1024px) {
    .studio-root { grid-template-columns: 48px minmax(0, 1fr) 320px; grid-template-rows: auto minmax(0, 1fr); }
    /* The rail goes icon-only; the top bar wraps instead of hiding the quiz
       name and its status badges. */
    .studio-rail .studio-rail-wide { display: none; }
    .studio-topbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 12px; min-height: 56px; box-sizing: border-box; }
    .studio-topbar-left { flex: 1 1 auto; padding: 0; height: auto; flex-wrap: wrap; row-gap: 6px; }
    .studio-topbar-center, .studio-topbar-right { flex: 0 0 auto; padding: 0; height: auto; }
  }
  @media (max-width: 767px) {
    /* One column that scrolls as a page: top bar, the rail as a strip of
       chips, the preview with real height, then its editor (a long
       question editor above it pushed the preview thousands of px down). */
    .studio-root { display: flex; flex-direction: column; height: auto; min-height: 100dvh; overflow: visible; }
    .studio-topbar { order: 1; }
    .studio-topbar-left, .studio-topbar-center, .studio-topbar-right { flex: 1 1 100%; justify-content: flex-start; }
    .studio-topbar-center { overflow-x: auto; }
    .studio-rail { order: 2; overflow: visible; border-right: 0; border-bottom: 1px solid #E1E3E5; }
    .studio-rail .studio-rail-wide { display: initial; }
    .studio-rail-list { flex-direction: row !important; flex-wrap: nowrap; overflow-x: auto; padding: 8px 12px !important; gap: 6px !important; }
    .studio-rail-list > .studio-rail-wide { display: none !important; }
    .studio-rail-list > .studio-tree-row { width: auto; flex: 0 0 auto; height: 32px; padding: 0 12px 0 6px !important; border: 1px solid #E1E3E5; border-radius: 999px; }
    .studio-rail-list > .studio-tree-row[data-selected="true"] { box-shadow: inset 0 0 0 1px #1a1a1a; }
    .studio-canvas { order: 3; height: 70vh; min-height: 440px; border-bottom: 1px solid #E1E3E5; }
    .studio-panel { order: 4; border-left: 0; }
    .studio-overlay { position: fixed; inset: 0; }
    .studio-stack-sm { grid-template-columns: minmax(0, 1fr) !important; gap: 4px !important; }
    .studio-stack-sm > :last-child { text-align: left !important; }
  }
`;

export function StudioShell({
  topBar,
  rail,
  canvas,
  panel,
  overlay,
}: {
  topBar: ReactNode;
  rail: ReactNode;
  canvas: ReactNode;
  panel: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="studio-root">
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />
      <div className="studio-topbar">{topBar}</div>
      <div className="studio-rail">{rail}</div>
      <div className="studio-canvas">{canvas}</div>
      <div className="studio-panel">{panel}</div>
      {overlay ? <div className="studio-overlay">{overlay}</div> : null}
    </div>
  );
}
