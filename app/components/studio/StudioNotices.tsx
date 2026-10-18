import type { ReactNode } from "react";
import { Banner } from "@shopify/polaris";
import { FALLBACK_HINT, type ArrivalBanner } from "../../lib/arrival-banner";

// The banner slot above the Studio canvas. Several notices can apply at
// once (an error, a template that isn't live, generator warnings, the
// draft-era notice, the arrival banner), but stacked banners overwhelm
// (Built for Shopify 4.3.4), so the slot shows ONE: the first in the list,
// which callers order critical, then warning, then info. Dismissing it
// reveals the next.

export interface StudioNotice {
  key: string;
  node: ReactNode;
}

export function NoticeSlot({ notices }: { notices: Array<StudioNotice | null | false | undefined | ""> }) {
  const first = notices.find((n): n is StudioNotice => Boolean(n));
  if (!first) return null;
  return (
    <div style={{ padding: "12px 16px 0" }} data-notice={first.key}>
      {first.node}
    </div>
  );
}

/** Arrival banner (V3-SPEC 6.5), assembled ONLY from the generation report
 * via arrivalBannerChips. A chip renders only when its value is real. */
export function ArrivalNotice({
  banner,
  onPlay,
  onStyle,
  onDismiss,
}: {
  banner: ArrivalBanner;
  onPlay: () => void;
  onStyle: () => void;
  onDismiss: () => void;
}) {
  // No title: Polaris draws the compact one-row banner, so the arrival
  // note doesn't push the preview down.
  return (
    <Banner
      tone="info"
      action={{ content: "Play the quiz", onAction: onPlay }}
      secondaryAction={banner.fallback ? { content: FALLBACK_HINT, onAction: onStyle } : undefined}
      onDismiss={onDismiss}
    >
      <strong>{banner.lead}</strong>{" "}
      {banner.fallback
        ? null
        : [banner.chips.length > 0 ? `${banner.chips.join(" · ")}.` : "", "Nothing is live until you publish."]
            .filter(Boolean)
            .join(" ")}
    </Banner>
  );
}
