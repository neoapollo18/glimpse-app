import type { ReactNode } from "react";

// The studio's app-shell grid. Plain CSS on purpose: Polaris has no
// full-viewport shell primitives, and Page/Layout would fight the takeover.
// Scroll containment: the shell never scrolls; each region owns its own
// overflow (rail scrolls, canvas decides per step, panel body scrolls).

const SHELL_CSS = `
  .studio-root { display: grid; grid-template-columns: 264px minmax(0, 1fr) 380px; grid-template-rows: 56px minmax(0, 1fr); height: 100dvh; overflow: hidden; background: #fff; font-size: 13px; }
  .studio-topbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 0 16px; border-bottom: 1px solid #E1E3E5; background: #fff; z-index: 20; }
  .studio-rail { overflow-y: auto; border-right: 1px solid #E1E3E5; display: flex; flex-direction: column; min-height: 0; }
  .studio-canvas { background: #F6F6F7; min-width: 0; min-height: 0; position: relative; display: flex; flex-direction: column; }
  .studio-panel { border-left: 1px solid #E1E3E5; display: flex; flex-direction: column; min-height: 0; background: #fff; }
  .studio-overlay { position: absolute; inset: 56px 0 0 0; z-index: 30; background: #fff; overflow-y: auto; }
  .studio-tree-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; text-align: left; font-size: 13px; color: #202223; }
  .studio-tree-row:hover { background: #F6F6F7; }
  .studio-tree-row[data-selected="true"] { background: #F1F1F1; box-shadow: inset 3px 0 0 #1a1a1a; }
  .studio-tree-row[data-flash="true"] { animation: studio-flash 1.5s ease-out; }
  @keyframes studio-flash { 0% { background: #FFF8E1; } 100% { background: transparent; } }
  .studio-thinking { font-size: 13px; font-weight: 500; background: linear-gradient(90deg, #8C9196 25%, #1a1a1a 50%, #8C9196 75%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: studio-shimmer 1.4s linear infinite; }
  @keyframes studio-shimmer { 0% { background-position: 200% 0; } 100% { background-position: 0% 0; } }
  .studio-step-pill { border: 0; background: transparent; border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; color: #6D7175; cursor: pointer; }
  .studio-step-pill[data-active="true"] { background: #1a1a1a; color: #fff; }
  .studio-panel-tabs { display: flex; border-bottom: 1px solid #E1E3E5; }
  .studio-panel-tab { flex: 1; border: 0; background: transparent; padding: 10px 0; font-size: 13px; font-weight: 600; color: #6D7175; cursor: pointer; border-bottom: 2px solid transparent; }
  .studio-panel-tab[data-active="true"] { color: #202223; border-bottom-color: #1a1a1a; }
  @media (max-width: 1280px) { .studio-root { grid-template-columns: 264px minmax(0, 1fr) 340px; } }
  @media (max-width: 1024px) { .studio-root { grid-template-columns: 48px minmax(0, 1fr) 340px; } .studio-rail .studio-rail-wide { display: none; } }
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
