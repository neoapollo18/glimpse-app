// Client-safe hand-off between the onboarding scope and build screens
// (V3-SPEC Part 6.1/6.2). The scope screen writes it to sessionStorage;
// the build screen reads it (a reload or ?retry=1 keeps the choice).

export type ScopeChip = {
  kind: "all" | "collection" | "type" | "tag" | "freetext";
  label: string;
  detail: string;
  productIds: string[] | null;
  count: number;
};

export interface OnboardingScopeHandoff {
  chip: ScopeChip;
  productCount: number;
  collectionCount: number;
  accentColor: string | null;
  template: string;
}

export const ONBOARDING_SCOPE_KEY = "gleame.onboarding.scope";

/** sessionStorage key: the generator's non-fatal warnings (string[]) from
 * the last successful onboarding build, for the Studio to surface. */
export const GEN_WARNINGS_KEY = "gleame:gen-warnings";

export const EVERYTHING_CHIP: ScopeChip = {
  kind: "all",
  label: "Everything I sell",
  detail: "",
  productIds: null,
  count: 0,
};

export function readScopeHandoff(): OnboardingScopeHandoff | null {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_SCOPE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.chip) return null;
    return parsed as OnboardingScopeHandoff;
  } catch {
    return null;
  }
}

export function writeScopeHandoff(h: OnboardingScopeHandoff): void {
  try {
    sessionStorage.setItem(ONBOARDING_SCOPE_KEY, JSON.stringify(h));
  } catch {
    /* Build falls back to the whole catalog */
  }
}
