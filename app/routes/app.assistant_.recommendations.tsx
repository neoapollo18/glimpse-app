import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Checkbox,
  Tag,
  Banner,
  Divider,
  Box,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useMemo } from "react";
import { authenticate } from "../shopify.server";
import {
  findShopByDomain,
  getRecommendationAdminConfig,
  saveRecommendationConfig,
  getShopVariantsFlat,
} from "../lib/supabase.server";

// ---------------------------------------------------------------------
// Loader: pull current matrix config + flat variant list (for cell pickers)
// ---------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await findShopByDomain(shopDomain);
  if (!shop) {
    return json({ error: "Shop not found", config: null, variants: [] }, { status: 404 });
  }

  const [config, variants] = await Promise.all([
    getRecommendationAdminConfig(shop.id),
    getShopVariantsFlat(shop.id),
  ]);

  return json({ shopDomain, config, variants });
};

// ---------------------------------------------------------------------
// Action: single intent (save). Wipe-and-rewrite — see saveRecommendationConfig.
// ---------------------------------------------------------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return json({ success: false, error: "Session expired. Please reload." }, { status: 401 });
    }
    throw err;
  }
  const shopDomain = session.shop;

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ success: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    return json({ success: false, error: "Missing payload" }, { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return json({ success: false, error: "Malformed payload" }, { status: 400 });
  }

  const result = await saveRecommendationConfig(shop.id, payload);
  if (!result.ok) return json({ success: false, error: result.error });
  return json({ success: true });
};

// ---------------------------------------------------------------------
// Types used in editor state
// ---------------------------------------------------------------------
// swatchColor: optional hex ("#8b5a2b") for the quiz shade-picker dot.
// Empty string = no swatch (the value renders as a text chip on the quiz).
type EditorAxisValue = { value: string; label: string; swatchColor: string };
type EditorAxis = {
  key: string;
  label: string;
  source: "photo" | "user_question";
  values: EditorAxisValue[];
};
type EditorQuestionOption = {
  label: string;
  axisValueValue: string;
  botResponse: string;
  // Optional reason bullet on quiz result cards when this option was picked.
  reasonText: string;
  // Optional image URL — options with images render as visual cards on the quiz.
  imageUrl: string;
  // Optional render condition: only show this option when a prior answer for
  // showIfAxisKey was showIfAxisValue. Held as two plain strings ('' = always
  // shown) so the pair of Selects can bind directly; serialized on save as
  // snake_case {"axis_key","axis_value"} — the shape the RPC stores verbatim
  // and the storefront quiz reads back.
  showIfAxisKey: string;
  showIfAxisValue: string;
  // "Open to anything" option — stands for every value of the axis and
  // deselects specific picks on the quiz.
  selectAll: boolean;
  // Optional card-display metadata (migration 046). Held as plain strings
  // ('' = unset; meterPct parsed on save) so the TextFields can bind
  // directly; serialized on save into a single `displayMeta` object with
  // only the non-empty keys, or null when everything is empty.
  displaySublabel: string;
  displayTag: string;
  displayMeterLabel: string;
  displayMeterPct: string;
  displaySwatch: string;
  displaySwatch2: string;
};
type EditorQuestion = {
  axisKey: string;
  prompt: string;
  // Optional sub-line under the question heading on the quiz page.
  helperText: string;
  // Shopper may pick several options; the quiz shows a Continue button.
  multiSelect: boolean;
  // Optional group key — consecutive questions with the same group render
  // together on one quiz screen. '' = its own screen.
  screenGroup: string;
  options: EditorQuestionOption[];
};
type EditorRule = {
  criteria: Record<string, string>;
  // Encoded target from the picker: "v:<variantId>" or "p:<productId>".
  target: string;
  rank: number;
  // Units of the target recommended ("2 sets"). Kept as a string so the
  // TextField can hold transient states while typing; parsed on save
  // (empty = 1).
  quantity: string;
};

// ---------------------------------------------------------------------
// Helpers: derive the cartesian product of axis values for the matrix grid.
// ---------------------------------------------------------------------
function cartesianProduct(axes: EditorAxis[]): Array<Record<string, string>> {
  if (axes.length === 0) return [];
  const lists = axes.map((a) => a.values.map((v) => ({ key: a.key, value: v.value })));
  let combos: Array<Record<string, string>> = [{}];
  for (const list of lists) {
    if (list.length === 0) return [];
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const item of list) {
        next.push({ ...combo, [item.key]: item.value });
      }
    }
    combos = next;
  }
  return combos;
}

function criteriaKey(c: Record<string, string>): string {
  return Object.keys(c)
    .sort()
    .map((k) => `${k}=${c[k]}`)
    .join(";");
}

// snake_case-only identifier guard for axis/value keys. Matches the DB
// CHECK constraint exactly so the merchant sees a friendly error before
// hitting a 500.
function isValidIdentifier(s: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(s);
}

// Lenient hex check shared by the swatch fields — #rgb through #rrggbbaa.
// Not a DB constraint, just sanity so the quiz renders a real color.
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

// Live color-dot preview for swatch TextFields (same treatment as the
// axis-value swatch field). Invalid/empty hex shows a transparent dot.
function swatchDotPrefix(value: string) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "1px solid rgba(0,0,0,0.2)",
        background: HEX_RE.test(value.trim()) ? value.trim() : "transparent",
      }}
    />
  );
}

// Collapse the six per-option card-display strings into the wire object.
// Only non-empty keys are included; all-empty collapses to null so the RPC
// stores NULL instead of an empty jsonb object.
function buildDisplayMeta(o: EditorQuestionOption): Record<string, string | number> | null {
  const meta: Record<string, string | number> = {};
  if (o.displaySublabel.trim()) meta.sublabel = o.displaySublabel.trim();
  if (o.displayTag.trim()) meta.tag = o.displayTag.trim();
  if (o.displayMeterLabel.trim()) meta.meterLabel = o.displayMeterLabel.trim();
  if (o.displayMeterPct.trim()) meta.meterPct = parseInt(o.displayMeterPct.trim(), 10);
  if (o.displaySwatch.trim()) meta.swatch = o.displaySwatch.trim();
  if (o.displaySwatch2.trim()) meta.swatch2 = o.displaySwatch2.trim();
  return Object.keys(meta).length > 0 ? meta : null;
}

// ---------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------
export default function AssistantRecommendations() {
  const { config, variants } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const isSaving = fetcher.state !== "idle";

  // Hydrate editor state from loader output. We use the storage keys (value
  // strings) as the canonical references; DB ids are only relevant on read.
  const initialAxes: EditorAxis[] = (config?.axes || []).map((a: any) => ({
    key: a.key,
    label: a.label,
    source: a.source,
    values: a.values.map((v: any) => ({
      value: v.value,
      label: v.label,
      swatchColor: v.swatchColor || "",
    })),
  }));

  const initialQuestions: EditorQuestion[] = (config?.questions || []).map(
    (q: any) => {
      const owningAxis = (config?.axes || []).find((a: any) => a.id === q.axisId);
      const axisKey = owningAxis?.key || "";
      return {
        axisKey,
        prompt: q.prompt,
        helperText: q.helperText || "",
        multiSelect: q.multiSelect || false,
        screenGroup: q.screenGroup || "",
        options: q.options.map((opt: any) => {
          const av = owningAxis?.values.find((v: any) => v.id === opt.axisValueId);
          return {
            label: opt.label,
            axisValueValue: av?.value || "",
            botResponse: opt.botResponse || "",
            reasonText: opt.reasonText || "",
            imageUrl: opt.imageUrl || "",
            // AdminQuestionOption.showIf arrives camelCase (already parsed
            // from the stored snake_case jsonb) — split into the two Select
            // binding fields.
            showIfAxisKey: opt.showIf?.axisKey || "",
            showIfAxisValue: opt.showIf?.axisValue || "",
            selectAll: opt.selectAll || false,
            // AdminQuestionOption.displayMeta (already type-checked per key
            // on read) — split into the six TextField binding strings.
            displaySublabel: opt.displayMeta?.sublabel || "",
            displayTag: opt.displayMeta?.tag || "",
            displayMeterLabel: opt.displayMeta?.meterLabel || "",
            displayMeterPct:
              typeof opt.displayMeta?.meterPct === "number"
                ? String(opt.displayMeta.meterPct)
                : "",
            displaySwatch: opt.displayMeta?.swatch || "",
            displaySwatch2: opt.displayMeta?.swatch2 || "",
          };
        }),
      };
    },
  );

  const initialRules: EditorRule[] = (config?.rules || []).map((r: any) => ({
    criteria: r.criteria,
    // Rebuild the encoded picker value from whichever target the rule stored.
    target: r.productId ? `p:${r.productId}` : r.variantId ? `v:${r.variantId}` : "",
    rank: r.rank,
    quantity: String(r.quantity ?? 1),
  }));

  const [axes, setAxes] = useState<EditorAxis[]>(initialAxes);
  const [questions, setQuestions] = useState<EditorQuestion[]>(initialQuestions);
  const [rules, setRules] = useState<EditorRule[]>(initialRules);
  const [validationError, setValidationError] = useState<string | null>(null);

  // -----------------------------------------------------------------
  // Derived: matrix combinations + a lookup from criteria → rules
  // -----------------------------------------------------------------
  const combinations = useMemo(() => cartesianProduct(axes), [axes]);
  const rulesByCriteria = useMemo(() => {
    const m = new Map<string, EditorRule[]>();
    for (const r of rules) {
      const k = criteriaKey(r.criteria);
      const arr = m.get(k);
      if (arr) arr.push(r);
      else m.set(k, [r]);
    }
    return m;
  }, [rules]);

  // -----------------------------------------------------------------
  // Target picker options. Polaris Select expects { label, value }. The
  // value is the encoded target ("v:<id>" / "p:<id>") from getShopVariantsFlat
  // — covers both specific variants and whole products (no variant).
  // -----------------------------------------------------------------
  const variantOptions = useMemo(
    () => [
      { label: "— Unassigned —", value: "" },
      ...variants.map((v: any) => ({ label: v.label, value: v.value })),
    ],
    [variants],
  );

  // -----------------------------------------------------------------
  // Axis mutators
  // -----------------------------------------------------------------
  const addAxis = useCallback(() => {
    setAxes((prev) => [
      ...prev,
      { key: "", label: "", source: "user_question", values: [] },
    ]);
  }, []);

  const updateAxis = useCallback((idx: number, patch: Partial<EditorAxis>) => {
    setAxes((prev) => {
      const old = prev[idx];
      // Renaming an axis key must follow through to the question and every
      // rule's criteria — otherwise the rules vanish from the matrix UI
      // (combos use the new key) but still get saved with the stale key,
      // becoming permanently unmatchable rows.
      if (patch.key !== undefined && old && patch.key !== old.key) {
        const oldKey = old.key;
        const newKey = patch.key;
        setQuestions((qs) =>
          qs.map((q) => {
            const renamed = q.axisKey === oldKey ? { ...q, axisKey: newKey } : q;
            // "Show only if" conditions on ANY question's options reference
            // axes by key too — follow the rename so conditional options
            // don't silently orphan (they'd save fine but never render).
            if (!renamed.options.some((o) => o.showIfAxisKey === oldKey)) return renamed;
            return {
              ...renamed,
              options: renamed.options.map((o) =>
                o.showIfAxisKey === oldKey ? { ...o, showIfAxisKey: newKey } : o,
              ),
            };
          }),
        );
        setRules((rs) =>
          rs.map((r) => {
            if (!(oldKey in r.criteria)) return r;
            const { [oldKey]: moved, ...rest } = r.criteria;
            return { ...r, criteria: { ...rest, [newKey]: moved } };
          }),
        );
      }
      return prev.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    });
  }, []);

  const removeAxis = useCallback((idx: number) => {
    setAxes((prev) => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      // Also drop any question + any rule referencing this axis key, so the
      // state stays internally consistent without the merchant having to
      // hunt down orphans. Surviving options whose "Show only if" condition
      // pointed at the removed axis fall back to always-shown.
      setQuestions((qs) =>
        qs
          .filter((q) => q.axisKey !== removed.key)
          .map((q) =>
            q.options.some((o) => o.showIfAxisKey === removed.key)
              ? {
                  ...q,
                  options: q.options.map((o) =>
                    o.showIfAxisKey === removed.key
                      ? { ...o, showIfAxisKey: "", showIfAxisValue: "" }
                      : o,
                  ),
                }
              : q,
          ),
      );
      setRules((rs) => rs.filter((r) => !(removed.key in r.criteria)));
      return next;
    });
  }, []);

  const addAxisValue = useCallback((axisIdx: number) => {
    setAxes((prev) =>
      prev.map((a, i) =>
        i === axisIdx
          ? { ...a, values: [...a.values, { value: "", label: "", swatchColor: "" }] }
          : a,
      ),
    );
  }, []);

  const updateAxisValue = useCallback(
    (axisIdx: number, valueIdx: number, patch: Partial<EditorAxisValue>) => {
      setAxes((prev) => {
        const axis = prev[axisIdx];
        const old = axis?.values[valueIdx];
        // Same follow-through as axis-key renames: question options and
        // rule criteria reference values by string, so a rename must
        // propagate or the assignments silently orphan.
        if (patch.value !== undefined && axis && old && patch.value !== old.value) {
          const axisKey = axis.key;
          const oldValue = old.value;
          const newValue = patch.value;
          setQuestions((qs) =>
            qs.map((q) => ({
              ...q,
              options: q.options.map((o) => {
                let next = o;
                if (q.axisKey === axisKey && o.axisValueValue === oldValue) {
                  next = { ...next, axisValueValue: newValue };
                }
                // "Show only if" conditions on OTHER questions' options can
                // reference this value too — rename follows through there as
                // well, or the condition would never match again.
                if (o.showIfAxisKey === axisKey && o.showIfAxisValue === oldValue) {
                  next = { ...next, showIfAxisValue: newValue };
                }
                return next;
              }),
            })),
          );
          setRules((rs) =>
            rs.map((r) =>
              r.criteria[axisKey] === oldValue
                ? { ...r, criteria: { ...r.criteria, [axisKey]: newValue } }
                : r,
            ),
          );
        }
        return prev.map((a, i) =>
          i === axisIdx
            ? {
                ...a,
                values: a.values.map((v, j) => (j === valueIdx ? { ...v, ...patch } : v)),
              }
            : a,
        );
      });
    },
    [],
  );

  const removeAxisValue = useCallback((axisIdx: number, valueIdx: number) => {
    setAxes((prev) => {
      const axis = prev[axisIdx];
      const removed = axis.values[valueIdx];
      const nextAxes = prev.map((a, i) =>
        i === axisIdx ? { ...a, values: a.values.filter((_, j) => j !== valueIdx) } : a,
      );
      // Prune options + rules that referenced this value. Options elsewhere
      // whose "Show only if" condition pointed at the removed value fall
      // back to always-shown rather than dangling.
      setQuestions((qs) =>
        qs.map((q) => {
          const pruned =
            q.axisKey === axis.key
              ? q.options.filter((o) => o.axisValueValue !== removed.value)
              : q.options;
          return {
            ...q,
            options: pruned.map((o) =>
              o.showIfAxisKey === axis.key && o.showIfAxisValue === removed.value
                ? { ...o, showIfAxisKey: "", showIfAxisValue: "" }
                : o,
            ),
          };
        }),
      );
      setRules((rs) => rs.filter((r) => r.criteria[axis.key] !== removed.value));
      return nextAxes;
    });
  }, []);

  // -----------------------------------------------------------------
  // Question mutators (1:1 with user_question axes)
  // -----------------------------------------------------------------
  const userQuestionAxes = axes.filter((a) => a.source === "user_question");

  const getOrCreateQuestion = useCallback(
    (axisKey: string): EditorQuestion => {
      const existing = questions.find((q) => q.axisKey === axisKey);
      if (existing) return existing;
      const newQ: EditorQuestion = {
        axisKey,
        prompt: "",
        helperText: "",
        multiSelect: false,
        screenGroup: "",
        options: [],
      };
      setQuestions((prev) => [...prev, newQ]);
      return newQ;
    },
    [questions],
  );

  const updateQuestion = useCallback((axisKey: string, patch: Partial<EditorQuestion>) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.axisKey === axisKey);
      if (idx === -1) {
        return [
          ...prev,
          { axisKey, prompt: "", helperText: "", multiSelect: false, screenGroup: "", options: [], ...patch },
        ];
      }
      return prev.map((q, i) => (i === idx ? { ...q, ...patch } : q));
    });
  }, []);

  const addQuestionOption = useCallback((axisKey: string) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.axisKey === axisKey);
      const newOpt: EditorQuestionOption = {
        label: "",
        axisValueValue: "",
        botResponse: "",
        reasonText: "",
        imageUrl: "",
        showIfAxisKey: "",
        showIfAxisValue: "",
        selectAll: false,
        displaySublabel: "",
        displayTag: "",
        displayMeterLabel: "",
        displayMeterPct: "",
        displaySwatch: "",
        displaySwatch2: "",
      };
      if (idx === -1) {
        return [
          ...prev,
          { axisKey, prompt: "", helperText: "", multiSelect: false, screenGroup: "", options: [newOpt] },
        ];
      }
      return prev.map((q, i) =>
        i === idx ? { ...q, options: [...q.options, newOpt] } : q,
      );
    });
  }, []);

  const updateQuestionOption = useCallback(
    (axisKey: string, optIdx: number, patch: Partial<EditorQuestionOption>) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.axisKey === axisKey
            ? {
                ...q,
                options: q.options.map((o, i) => (i === optIdx ? { ...o, ...patch } : o)),
              }
            : q,
        ),
      );
    },
    [],
  );

  const removeQuestionOption = useCallback((axisKey: string, optIdx: number) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.axisKey === axisKey
          ? { ...q, options: q.options.filter((_, i) => i !== optIdx) }
          : q,
      ),
    );
  }, []);

  // -----------------------------------------------------------------
  // Rule mutators (per criteria combination × rank)
  // -----------------------------------------------------------------
  // numRanks: how many variant slots per matrix cell. Driven by chat config's
  // num_recommendations conceptually, but we let the merchant pick here so
  // the matrix editor doesn't have to round-trip another config field. Cap
  // at 5 to match the chat-config slider.
  const NUM_RANKS = 3;

  const setRuleTarget = useCallback(
    (criteria: Record<string, string>, rank: number, target: string) => {
      const k = criteriaKey(criteria);
      setRules((prev) => {
        // Carry the previous quantity through a target swap — re-picking the
        // product in a cell shouldn't silently reset "2 sets" back to 1.
        const existing = prev.find(
          (r) => criteriaKey(r.criteria) === k && r.rank === rank,
        );
        const next = prev.filter(
          (r) => !(criteriaKey(r.criteria) === k && r.rank === rank),
        );
        if (target) {
          next.push({ criteria, target, rank, quantity: existing?.quantity ?? "1" });
        }
        return next;
      });
    },
    [],
  );

  const setRuleQuantity = useCallback(
    (criteria: Record<string, string>, rank: number, quantity: string) => {
      const k = criteriaKey(criteria);
      setRules((prev) =>
        prev.map((r) =>
          criteriaKey(r.criteria) === k && r.rank === rank ? { ...r, quantity } : r,
        ),
      );
    },
    [],
  );

  const getRuleTarget = useCallback(
    (criteria: Record<string, string>, rank: number): string => {
      const k = criteriaKey(criteria);
      const matched = rulesByCriteria.get(k) || [];
      const found = matched.find((r) => r.rank === rank);
      return found?.target || "";
    },
    [rulesByCriteria],
  );

  const getRuleQuantity = useCallback(
    (criteria: Record<string, string>, rank: number): string => {
      const k = criteriaKey(criteria);
      const matched = rulesByCriteria.get(k) || [];
      const found = matched.find((r) => r.rank === rank);
      return found?.quantity ?? "1";
    },
    [rulesByCriteria],
  );

  // -----------------------------------------------------------------
  // Save: client-side validation, then POST the full state as JSON.
  // -----------------------------------------------------------------
  const handleSave = useCallback(() => {
    setValidationError(null);

    // Identifier validation — fail fast with a clear message rather than
    // letting the DB constraints reject the save.
    const seenAxisKeys = new Set<string>();
    for (const axis of axes) {
      if (!isValidIdentifier(axis.key)) {
        setValidationError(`Axis key "${axis.key}" must be lower snake_case (e.g. "undertone")`);
        return;
      }
      if (seenAxisKeys.has(axis.key)) {
        setValidationError(`Two axes share the key "${axis.key}" — axis keys must be unique`);
        return;
      }
      seenAxisKeys.add(axis.key);
      if (!axis.label.trim()) {
        setValidationError(`Axis "${axis.key}" needs a display label`);
        return;
      }
      if (axis.values.length === 0) {
        setValidationError(`Axis "${axis.key}" needs at least one value`);
        return;
      }
      const seenValues = new Set<string>();
      for (const v of axis.values) {
        if (!isValidIdentifier(v.value)) {
          setValidationError(`Value "${v.value}" in axis "${axis.key}" must be lower snake_case`);
          return;
        }
        if (seenValues.has(v.value)) {
          setValidationError(`Axis "${axis.key}" has the value "${v.value}" twice — values must be unique`);
          return;
        }
        seenValues.add(v.value);
        if (!v.label.trim()) {
          setValidationError(`Value "${v.value}" in axis "${axis.key}" needs a display label`);
          return;
        }
        // Swatch is optional; when set it must look like a hex color so the
        // quiz shade picker renders a real dot. Lenient on length (#rgb
        // through #rrggbbaa) — this isn't a DB constraint, just sanity.
        const swatch = v.swatchColor.trim();
        if (swatch && !/^#[0-9a-fA-F]{3,8}$/.test(swatch)) {
          setValidationError(`Swatch for value "${v.value}" in axis "${axis.key}" must be a hex color like #8b5a2b (or left empty)`);
          return;
        }
      }
    }

    // Every "Ask the shopper" axis must be collectible at runtime: a prompt
    // plus at least one fully-mapped option. Without this, the chat never
    // gathers that axis, the criteria stays incomplete, and the strict
    // rule lookup silently misses — every recommendation falls back to AI.
    for (const axis of axes) {
      if (axis.source !== "user_question") continue;
      const q = questions.find((qq) => qq.axisKey === axis.key);
      if (!q || !q.prompt.trim()) {
        setValidationError(`Axis "${axis.key}" needs a question prompt — without it the chat can't collect this axis and no matrix rule can match`);
        return;
      }
      // Screen group is optional; when set it must be a snake_case
      // identifier like the axis keys, so grouped questions compare cleanly.
      const group = q.screenGroup.trim();
      if (group && !isValidIdentifier(group)) {
        setValidationError(`Screen group "${group}" for axis "${axis.key}" must be lower snake_case (e.g. "style_screen") or left empty`);
        return;
      }
      const validOptions = q.options.filter((o) => o.label.trim() && o.axisValueValue);
      if (validOptions.length === 0) {
        setValidationError(`The question for axis "${axis.key}" needs at least one answer option with a label and a mapped value`);
        return;
      }
      for (const o of q.options) {
        if (o.label.trim() && !o.axisValueValue) {
          setValidationError(`Option "${o.label}" for axis "${axis.key}" isn't mapped to a value`);
          return;
        }
        if (!o.label.trim() && o.axisValueValue) {
          setValidationError(`An option for axis "${axis.key}" is missing its button label`);
          return;
        }
        // "Show only if" must be complete AND reference a live axis + value.
        // The Selects enforce this in the UI, and the axis/value cascades
        // clear conditions on rename/delete — but stale state from older
        // saves still deserves a friendly message over a silent never-shown
        // option in the quiz.
        if (o.showIfAxisKey || o.showIfAxisValue) {
          if (!o.showIfAxisKey || !o.showIfAxisValue) {
            setValidationError(`Option "${o.label}" for axis "${axis.key}" has an incomplete "Show only if" condition — pick both an axis and a value, or set it back to Always shown`);
            return;
          }
          const condAxis = axes.find((a) => a.key === o.showIfAxisKey);
          if (!condAxis || !condAxis.values.some((v) => v.value === o.showIfAxisValue)) {
            setValidationError(`Option "${o.label}" for axis "${axis.key}" has a "Show only if" condition pointing at "${o.showIfAxisKey}: ${o.showIfAxisValue}", which no longer exists`);
            return;
          }
          // The referenced answer must exist when the option renders: only a
          // shopper-question axis asked EARLIER in the flow qualifies. Photo
          // axes resolve after all questions (at the try-on gate) and later
          // questions haven't been answered yet — the option would save fine
          // but never show for any shopper. The Select only offers valid
          // choices now, but stale showIfs from older saves (or from
          // reordering) still need catching here.
          const qFlowIdx = questions.findIndex((qq) => qq.axisKey === axis.key);
          const condFlowIdx = questions.findIndex((qq) => qq.axisKey === o.showIfAxisKey);
          if (
            condAxis.source !== "user_question" ||
            condFlowIdx === -1 ||
            condFlowIdx >= qFlowIdx
          ) {
            setValidationError(`Option "${o.label}" (question ${qFlowIdx + 1}): "Show only if" must reference an earlier question's answer — photo-based traits and later questions aren't known yet when this option renders`);
            return;
          }
        }
        // Card display: meter fill must be a whole number 0-100 (empty is
        // fine — meaningful only alongside a meter label anyway), and the
        // swatches must be hex colors so the quiz renders real chips.
        const meterPct = o.displayMeterPct.trim();
        if (meterPct !== "" && !(/^\d{1,3}$/.test(meterPct) && parseInt(meterPct, 10) <= 100)) {
          setValidationError(`Option "${o.label}" for axis "${axis.key}": meter fill must be a whole number from 0 to 100 (or left empty)`);
          return;
        }
        for (const [swatchName, swatchValue] of [
          ["Swatch", o.displaySwatch],
          ["Second swatch", o.displaySwatch2],
        ] as const) {
          const s = swatchValue.trim();
          if (s && !HEX_RE.test(s)) {
            setValidationError(`Option "${o.label}" for axis "${axis.key}": ${swatchName.toLowerCase()} must be a hex color like #e8b4c8 (or left empty)`);
            return;
          }
        }
      }
    }

    // Questions sharing a screen group must sit next to each other in the
    // flow — buildScreens in the storefront widget only merges CONSECUTIVE
    // questions with the same screenGroup, so a split group would silently
    // render as separate quiz screens. Checked against the same filtered
    // list the payload ships (stale questions for removed axes don't count).
    const flowQuestions = questions.filter((q) =>
      axes.some((a) => a.key === q.axisKey && a.source === "user_question"),
    );
    const lastGroupIdx = new Map<string, number>();
    for (let i = 0; i < flowQuestions.length; i++) {
      const group = flowQuestions[i].screenGroup.trim();
      if (!group) continue;
      const prev = lastGroupIdx.get(group);
      if (prev !== undefined && prev !== i - 1) {
        setValidationError(`Screen group "${group}": questions sharing a group must be consecutive — move them next to each other or they'll render as separate quiz screens`);
        return;
      }
      lastGroupIdx.set(group, i);
    }

    // Every assigned rule's quantity must be a positive whole number. Empty
    // is fine — it saves as the default of 1 (see the payload builder).
    for (const r of rules) {
      if (!r.target) continue;
      const qty = r.quantity.trim();
      if (qty !== "" && !/^[1-9]\d*$/.test(qty)) {
        setValidationError(`Quantity "${qty}" in the matrix must be a whole number of 1 or more`);
        return;
      }
    }

    // Build the wire payload. Positions are derived from array order so the
    // merchant doesn't have to manage position numbers manually. The quiz
    // fields (swatchColor / helperText / reasonText) send null when empty —
    // the RPC nullifies '' too, so either spelling stores NULL.
    const payload = {
      axes: axes.map((a, i) => ({
        key: a.key,
        label: a.label,
        source: a.source,
        position: i,
        values: a.values.map((v, j) => ({
          value: v.value,
          label: v.label,
          position: j,
          swatchColor: v.swatchColor.trim() || null,
        })),
      })),
      questions: questions
        .filter((q) => axes.some((a) => a.key === q.axisKey && a.source === "user_question"))
        .map((q, qi) => ({
          axisKey: q.axisKey,
          prompt: q.prompt,
          position: qi,
          helperText: q.helperText || null,
          multiSelect: q.multiSelect,
          screenGroup: q.screenGroup.trim() || null,
          options: q.options
            .filter((o) => o.label.trim() && o.axisValueValue)
            .map((o, i) => ({
              label: o.label,
              axisValueValue: o.axisValueValue,
              botResponse: o.botResponse || null,
              reasonText: o.reasonText || null,
              imageUrl: o.imageUrl.trim() || null,
              // Serialize the two editor fields back into the snake_case
              // object the RPC stores verbatim and the storefront reads
              // (rawShowIf in getRecommendationFlow). Incomplete = none.
              showIf:
                o.showIfAxisKey && o.showIfAxisValue
                  ? { axis_key: o.showIfAxisKey, axis_value: o.showIfAxisValue }
                  : null,
              selectAll: o.selectAll,
              // Camelcase object stored verbatim as jsonb by the RPC; only
              // non-empty keys ship, all-empty collapses to null.
              displayMeta: buildDisplayMeta(o),
              position: i,
            })),
        })),
      rules: rules
        .filter((r) => r.target)
        // Drop rules whose criteria no longer line up with the current
        // axes/values (stale rows from before rename-propagation existed,
        // or hand-edited data). They'd never match at runtime and would
        // silently accumulate in the DB otherwise.
        .filter((r) => {
          const keys = Object.keys(r.criteria);
          if (keys.length !== axes.length) return false;
          return keys.every((k) => {
            const axis = axes.find((a) => a.key === k);
            return !!axis && axis.values.some((v) => v.value === r.criteria[k]);
          });
        })
        .map((r) => {
          // Decode "v:<id>" / "p:<id>" back into the two DB columns.
          const isProduct = r.target.startsWith("p:");
          const id = r.target.slice(2);
          return {
            criteria: r.criteria,
            variantId: isProduct ? null : id,
            productId: isProduct ? id : null,
            rank: r.rank,
            // Validated above as empty-or-positive-int; empty means default 1.
            quantity: r.quantity.trim() ? parseInt(r.quantity.trim(), 10) : 1,
          };
        }),
    };

    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    fetcher.submit(fd, { method: "POST" });
  }, [axes, questions, rules, fetcher]);

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  return (
    <Page
      backAction={{ content: "Assistant", url: "/app/assistant" }}
      title="Recommendation Logic"
    >
      <TitleBar title="Recommendation Logic" />
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner tone="success">Recommendation logic saved.</Banner>
        )}
        {fetcher.data?.error && (
          <Banner tone="critical">Save failed: {fetcher.data.error}</Banner>
        )}
        {validationError && (
          <Banner tone="warning" onDismiss={() => setValidationError(null)}>
            {validationError}
          </Banner>
        )}

        {/* Explainer */}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              How it works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Define <strong>criteria axes</strong> like "skin depth" and "undertone". Some
              axes come from a question you ask the shopper, others come from analyzing
              their photo. For each combination of axis values, assign the variants you'd
              recommend in rank order. Top of rank gets the "Top Match" badge.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              If you leave a combination blank, the assistant falls back to its existing
              AI-pick behavior for that combination — so partial configs work too.
            </Text>
          </BlockStack>
        </Card>

        {/* Axes editor */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Criteria Axes</Text>
              <Button onClick={addAxis} size="slim">Add axis</Button>
            </InlineStack>
            {axes.length === 0 && (
              <Text as="p" variant="bodySm" tone="subdued">
                No axes yet. Add one to start building your recommendation matrix.
              </Text>
            )}
            {axes.map((axis, axisIdx) => (
              <Box
                key={axisIdx}
                padding="400"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={axis.source === "photo" ? "info" : "success"}>
                        {axis.source === "photo" ? "From photo" : "From question"}
                      </Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Axis #{axisIdx + 1}
                      </Text>
                    </InlineStack>
                    <Button
                      size="slim"
                      variant="plain"
                      tone="critical"
                      onClick={() => removeAxis(axisIdx)}
                    >
                      Remove axis
                    </Button>
                  </InlineStack>

                  <InlineStack gap="400" wrap={false}>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Key (machine-readable)"
                        value={axis.key}
                        onChange={(v) => updateAxis(axisIdx, { key: v })}
                        autoComplete="off"
                        helpText="Lower snake_case, e.g. undertone"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Label (shown in admin)"
                        value={axis.label}
                        onChange={(v) => updateAxis(axisIdx, { label: v })}
                        autoComplete="off"
                        helpText="e.g. Undertone"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Select
                        label="Source"
                        options={[
                          { label: "Ask the shopper", value: "user_question" },
                          { label: "Analyze the photo", value: "photo" },
                        ]}
                        value={axis.source}
                        onChange={(v) => updateAxis(axisIdx, { source: v as any })}
                        helpText={
                          axis.source === "photo"
                            ? "Classified automatically from the shopper's photo by AI — pick clear, visually distinct values."
                            : "A button-choice question in the chat"
                        }
                      />
                    </div>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Possible values
                      </Text>
                      <Button size="slim" onClick={() => addAxisValue(axisIdx)}>
                        Add value
                      </Button>
                    </InlineStack>
                    {axis.values.length === 0 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        No values yet. e.g. for "depth" you might add fair / medium / deep.
                      </Text>
                    )}
                    {axis.values.map((v, valueIdx) => (
                      <InlineStack key={valueIdx} gap="200" blockAlign="end">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Value"
                            labelHidden
                            value={v.value}
                            onChange={(val) =>
                              updateAxisValue(axisIdx, valueIdx, { value: val })
                            }
                            autoComplete="off"
                            placeholder="fair (lower snake_case)"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Label"
                            labelHidden
                            value={v.label}
                            onChange={(val) =>
                              updateAxisValue(axisIdx, valueIdx, { label: val })
                            }
                            autoComplete="off"
                            placeholder="Fair"
                          />
                        </div>
                        <div style={{ width: 140 }}>
                          <TextField
                            label="Swatch color"
                            labelHidden
                            value={v.swatchColor}
                            onChange={(val) =>
                              updateAxisValue(axisIdx, valueIdx, { swatchColor: val })
                            }
                            autoComplete="off"
                            placeholder="#8b5a2b"
                            // Live preview dot so the merchant can eyeball the
                            // hex without leaving the field.
                            prefix={swatchDotPrefix(v.swatchColor)}
                          />
                        </div>
                        <Button
                          size="slim"
                          variant="plain"
                          tone="critical"
                          onClick={() => removeAxisValue(axisIdx, valueIdx)}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Box>
            ))}
          </BlockStack>
        </Card>

        {/* Question editor — one per user_question axis */}
        {userQuestionAxes.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Shopper Questions</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                For each "Ask the shopper" axis, define the question and how the answer
                options map to axis values. The optional "bot response" is the personality
                line the assistant says after the shopper picks — e.g. "Warm undertones —
                beautiful. You'll pull off some shades cool-toned folks can't."
              </Text>
              {userQuestionAxes.map((axis) => {
                const q = questions.find((qq) => qq.axisKey === axis.key) || {
                  axisKey: axis.key,
                  prompt: "",
                  helperText: "",
                  multiSelect: false,
                  screenGroup: "",
                  options: [] as EditorQuestionOption[],
                };
                // "Show only if" can only reference an answer that exists when
                // this option renders: a shopper-question axis whose question
                // comes EARLIER in the flow (the questions array order). Photo
                // axes resolve after all questions (at the try-on gate) and
                // later questions haven't been answered yet — either would
                // save fine but the option would never show for any shopper.
                const qFlowIdx = questions.findIndex((qq) => qq.axisKey === axis.key);
                const earlierAxisKeys = new Set(
                  questions.slice(0, Math.max(qFlowIdx, 0)).map((qq) => qq.axisKey),
                );
                const showIfAxisOptions = axes.filter(
                  (a) => a.key && a.source === "user_question" && earlierAxisKeys.has(a.key),
                );
                return (
                  <Box
                    key={axis.key}
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">
                        Question for {axis.label || axis.key}
                      </Text>
                      <TextField
                        label="Prompt"
                        value={q.prompt}
                        onChange={(v) => updateQuestion(axis.key, { prompt: v })}
                        autoComplete="off"
                        multiline={2}
                        helpText='e.g. "First — does gold or silver jewelry suit you better?"'
                      />
                      <TextField
                        label="Helper text (optional)"
                        value={q.helperText}
                        onChange={(v) => updateQuestion(axis.key, { helperText: v })}
                        autoComplete="off"
                        placeholder="This helps us pick the right shade for you."
                        helpText="Sub-line under the question heading on the quiz page. The chat ignores it."
                      />
                      <InlineStack gap="400" blockAlign="start" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <Checkbox
                            label="Multi-select"
                            checked={q.multiSelect}
                            onChange={(v) => updateQuestion(axis.key, { multiSelect: v })}
                            helpText="Shopper can pick several options; the quiz shows a Continue button instead of auto-advancing."
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Screen group (optional)"
                            value={q.screenGroup}
                            onChange={(v) => updateQuestion(axis.key, { screenGroup: v })}
                            autoComplete="off"
                            placeholder="style_screen"
                            helpText="Consecutive questions with the same group render together on one quiz screen (e.g. style_screen)"
                          />
                        </div>
                      </InlineStack>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          Answer options
                        </Text>
                        <Button size="slim" onClick={() => addQuestionOption(axis.key)}>
                          Add option
                        </Button>
                      </InlineStack>
                      {q.options.length === 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          No options yet. Add one per axis value.
                        </Text>
                      )}
                      {q.options.map((opt, optIdx) => (
                        <Box
                          key={optIdx}
                          padding="300"
                          background="bg-surface"
                          borderRadius="200"
                        >
                          <BlockStack gap="200">
                            <InlineStack gap="300" wrap={false}>
                              <div style={{ flex: 1 }}>
                                <TextField
                                  label="Button label"
                                  value={opt.label}
                                  onChange={(v) =>
                                    updateQuestionOption(axis.key, optIdx, { label: v })
                                  }
                                  autoComplete="off"
                                  placeholder="Gold suits me"
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <Select
                                  label="Mapped value"
                                  options={[
                                    { label: "— Pick a value —", value: "" },
                                    ...axis.values.map((v) => ({
                                      label: v.label || v.value,
                                      value: v.value,
                                    })),
                                  ]}
                                  value={opt.axisValueValue}
                                  onChange={(v) =>
                                    updateQuestionOption(axis.key, optIdx, {
                                      axisValueValue: v,
                                    })
                                  }
                                />
                              </div>
                            </InlineStack>
                            <TextField
                              label="Bot response (optional)"
                              value={opt.botResponse}
                              onChange={(v) =>
                                updateQuestionOption(axis.key, optIdx, { botResponse: v })
                              }
                              autoComplete="off"
                              multiline={2}
                              placeholder="Warm undertones — beautiful..."
                              helpText="Personality line shown after the shopper picks this option. Optional."
                            />
                            <TextField
                              label="Reason shown on result card (optional)"
                              value={opt.reasonText}
                              onChange={(v) =>
                                updateQuestionOption(axis.key, optIdx, { reasonText: v })
                              }
                              autoComplete="off"
                              placeholder="Adds length past your shoulders"
                              helpText='Reason bullet on quiz result cards when this option was picked. Empty falls back to "{question}: {answer}".'
                            />
                            <InlineStack gap="300" wrap={false} blockAlign="start">
                              <div style={{ flex: 1 }}>
                                <TextField
                                  label="Image URL (optional)"
                                  value={opt.imageUrl}
                                  onChange={(v) =>
                                    updateQuestionOption(axis.key, optIdx, { imageUrl: v })
                                  }
                                  autoComplete="off"
                                  placeholder="https://cdn.shopify.com/..."
                                  helpText="Options with images render as visual cards on the quiz."
                                />
                              </div>
                              {/* Conditional render: only offer shopper-question
                                  axes asked EARLIER in the flow (see
                                  showIfAxisOptions above) — anything else could
                                  never be satisfied when this option renders.
                                  Changing the axis resets the value so a stale
                                  pairing can't survive. */}
                              <div style={{ flex: 1 }}>
                                <Select
                                  label="Show only if (optional)"
                                  options={[
                                    { label: "Always shown", value: "" },
                                    ...showIfAxisOptions.map((a) => ({
                                      label: a.label || a.key,
                                      value: a.key,
                                    })),
                                  ]}
                                  value={opt.showIfAxisKey}
                                  onChange={(v) =>
                                    updateQuestionOption(axis.key, optIdx, {
                                      showIfAxisKey: v,
                                      showIfAxisValue: "",
                                    })
                                  }
                                  helpText="Only show this option after a matching answer to an earlier question."
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <Select
                                  label="Required answer"
                                  options={[
                                    { label: "— Pick a value —", value: "" },
                                    ...(
                                      axes.find((a) => a.key === opt.showIfAxisKey)?.values || []
                                    ).map((v) => ({
                                      label: v.label || v.value,
                                      value: v.value,
                                    })),
                                  ]}
                                  value={opt.showIfAxisValue}
                                  disabled={!opt.showIfAxisKey}
                                  onChange={(v) =>
                                    updateQuestionOption(axis.key, optIdx, {
                                      showIfAxisValue: v,
                                    })
                                  }
                                />
                              </div>
                            </InlineStack>
                            {/* Card display (migration 046): optional richer
                                option-card rendering on the quiz — sublabel,
                                tag chip, wear meter, swatch chips. All empty
                                = plain card, saved as displayMeta: null. */}
                            <BlockStack gap="150">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                Card display (optional)
                              </Text>
                              <InlineStack gap="300" wrap={false}>
                                <div style={{ flex: 1 }}>
                                  <TextField
                                    label="Sublabel"
                                    value={opt.displaySublabel}
                                    onChange={(v) =>
                                      updateQuestionOption(axis.key, optIdx, { displaySublabel: v })
                                    }
                                    autoComplete="off"
                                    placeholder="Everyday sweet spot"
                                    helpText="Second line on the option card."
                                  />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <TextField
                                    label="Tag"
                                    value={opt.displayTag}
                                    onChange={(v) =>
                                      updateQuestionOption(axis.key, optIdx, { displayTag: v })
                                    }
                                    autoComplete="off"
                                    placeholder="NO GLUE"
                                    helpText="Small chip on the card."
                                  />
                                </div>
                              </InlineStack>
                              <InlineStack gap="300" wrap={false} blockAlign="start">
                                <div style={{ flex: 1 }}>
                                  <TextField
                                    label="Meter label"
                                    value={opt.displayMeterLabel}
                                    onChange={(v) =>
                                      updateQuestionOption(axis.key, optIdx, { displayMeterLabel: v })
                                    }
                                    autoComplete="off"
                                    placeholder="UP TO 2 WEEKS"
                                  />
                                </div>
                                <div style={{ width: 90 }}>
                                  <TextField
                                    label="Meter fill %"
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={opt.displayMeterPct}
                                    onChange={(v) =>
                                      updateQuestionOption(axis.key, optIdx, { displayMeterPct: v })
                                    }
                                    autoComplete="off"
                                    placeholder="60"
                                  />
                                </div>
                                <div style={{ width: 140 }}>
                                  <TextField
                                    label="Swatch"
                                    value={opt.displaySwatch}
                                    onChange={(v) =>
                                      updateQuestionOption(axis.key, optIdx, { displaySwatch: v })
                                    }
                                    autoComplete="off"
                                    placeholder="#e8b4c8"
                                    prefix={swatchDotPrefix(opt.displaySwatch)}
                                    helpText="One swatch = color chip dot; two = two-tone style card."
                                  />
                                </div>
                                <div style={{ width: 140 }}>
                                  <TextField
                                    label="Second swatch"
                                    value={opt.displaySwatch2}
                                    onChange={(v) =>
                                      updateQuestionOption(axis.key, optIdx, { displaySwatch2: v })
                                    }
                                    autoComplete="off"
                                    placeholder="#2b2b33"
                                    prefix={swatchDotPrefix(opt.displaySwatch2)}
                                  />
                                </div>
                              </InlineStack>
                            </BlockStack>
                            <Checkbox
                              label='"Open to anything" option'
                              checked={opt.selectAll}
                              onChange={(v) =>
                                updateQuestionOption(axis.key, optIdx, { selectAll: v })
                              }
                              helpText="Picking it stands for every value of this axis and clears specific picks."
                            />
                            <InlineStack align="end">
                              <Button
                                size="slim"
                                variant="plain"
                                tone="critical"
                                onClick={() => removeQuestionOption(axis.key, optIdx)}
                              >
                                Remove option
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  </Box>
                );
              })}
            </BlockStack>
          </Card>
        )}

        {/* Matrix */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Recommendation Matrix</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Each row is one combination of axis values. Assign up to {NUM_RANKS}{" "}
              products or shades per cell in rank order — rank 1 gets the Top Match
              badge in the chat. Leave blank to fall back to AI for that combination.
            </Text>
            {combinations.length === 0 && (
              <Banner tone="info">
                Add at least one axis with values to see the matrix.
              </Banner>
            )}
            {combinations.length > 0 && variants.length === 0 && (
              <Banner tone="warning">
                You have no products configured. Add products on the Products page
                first, then come back to assign them here.
              </Banner>
            )}
            {combinations.length > 0 && variants.length > 0 && (
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="300">
                  {combinations.map((combo, comboIdx) => (
                    <Box
                      key={criteriaKey(combo)}
                      padding="300"
                      background="bg-surface"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <InlineStack gap="200" wrap>
                          {axes.map((a) => (
                            <Tag key={a.key}>
                              {a.label || a.key}:{" "}
                              {a.values.find((v) => v.value === combo[a.key])?.label ||
                                combo[a.key]}
                            </Tag>
                          ))}
                        </InlineStack>
                        <InlineStack gap="300" wrap={false}>
                          {Array.from({ length: NUM_RANKS }).map((_, rankIdx) => {
                            const rank = rankIdx + 1;
                            const target = getRuleTarget(combo, rank);
                            return (
                              <div key={rank} style={{ flex: 1 }}>
                                <InlineStack gap="150" blockAlign="end" wrap={false}>
                                  <div style={{ flex: 1 }}>
                                    <Select
                                      label={`Rank ${rank}${rank === 1 ? " (Top Match)" : ""}`}
                                      options={variantOptions}
                                      value={target}
                                      onChange={(v) => setRuleTarget(combo, rank, v)}
                                    />
                                  </div>
                                  {/* Units recommended per rule ("2 sets") —
                                      applied to cart adds on both surfaces:
                                      quiz add-to-bag and the chat bundle.
                                      Only meaningful once a target is
                                      assigned. */}
                                  <div style={{ width: 64 }}>
                                    <TextField
                                      label="Qty"
                                      type="number"
                                      min={1}
                                      value={getRuleQuantity(combo, rank)}
                                      onChange={(v) => setRuleQuantity(combo, rank, v)}
                                      autoComplete="off"
                                      disabled={!target}
                                      helpText="Units added to cart"
                                    />
                                  </div>
                                </InlineStack>
                              </div>
                            );
                          })}
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>

        {/* Save bar */}
        <InlineStack align="end" gap="300">
          <Button url="/app/assistant">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            Save recommendation logic
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
