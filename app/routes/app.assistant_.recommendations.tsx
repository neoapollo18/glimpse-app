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
type EditorAxisValue = { value: string; label: string };
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
};
type EditorQuestion = {
  axisKey: string;
  prompt: string;
  options: EditorQuestionOption[];
};
type EditorRule = {
  criteria: Record<string, string>;
  // Encoded target from the picker: "v:<variantId>" or "p:<productId>".
  target: string;
  rank: number;
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
    values: a.values.map((v: any) => ({ value: v.value, label: v.label })),
  }));

  const initialQuestions: EditorQuestion[] = (config?.questions || []).map(
    (q: any) => {
      const owningAxis = (config?.axes || []).find((a: any) => a.id === q.axisId);
      const axisKey = owningAxis?.key || "";
      return {
        axisKey,
        prompt: q.prompt,
        options: q.options.map((opt: any) => {
          const av = owningAxis?.values.find((v: any) => v.id === opt.axisValueId);
          return {
            label: opt.label,
            axisValueValue: av?.value || "",
            botResponse: opt.botResponse || "",
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
          qs.map((q) => (q.axisKey === oldKey ? { ...q, axisKey: newKey } : q)),
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
      // hunt down orphans.
      setQuestions((qs) => qs.filter((q) => q.axisKey !== removed.key));
      setRules((rs) => rs.filter((r) => !(removed.key in r.criteria)));
      return next;
    });
  }, []);

  const addAxisValue = useCallback((axisIdx: number) => {
    setAxes((prev) =>
      prev.map((a, i) =>
        i === axisIdx ? { ...a, values: [...a.values, { value: "", label: "" }] } : a,
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
            qs.map((q) =>
              q.axisKey === axisKey
                ? {
                    ...q,
                    options: q.options.map((o) =>
                      o.axisValueValue === oldValue ? { ...o, axisValueValue: newValue } : o,
                    ),
                  }
                : q,
            ),
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
      // Prune options + rules that referenced this value.
      setQuestions((qs) =>
        qs.map((q) =>
          q.axisKey === axis.key
            ? { ...q, options: q.options.filter((o) => o.axisValueValue !== removed.value) }
            : q,
        ),
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
      const newQ: EditorQuestion = { axisKey, prompt: "", options: [] };
      setQuestions((prev) => [...prev, newQ]);
      return newQ;
    },
    [questions],
  );

  const updateQuestion = useCallback((axisKey: string, patch: Partial<EditorQuestion>) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.axisKey === axisKey);
      if (idx === -1) return [...prev, { axisKey, prompt: "", options: [], ...patch }];
      return prev.map((q, i) => (i === idx ? { ...q, ...patch } : q));
    });
  }, []);

  const addQuestionOption = useCallback((axisKey: string) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.axisKey === axisKey);
      const newOpt: EditorQuestionOption = { label: "", axisValueValue: "", botResponse: "" };
      if (idx === -1) return [...prev, { axisKey, prompt: "", options: [newOpt] }];
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
        const next = prev.filter(
          (r) => !(criteriaKey(r.criteria) === k && r.rank === rank),
        );
        if (target) {
          next.push({ criteria, target, rank });
        }
        return next;
      });
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
      }
    }

    // Build the wire payload. Positions are derived from array order so the
    // merchant doesn't have to manage position numbers manually.
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
        })),
      })),
      questions: questions
        .filter((q) => axes.some((a) => a.key === q.axisKey && a.source === "user_question"))
        .map((q, qi) => ({
          axisKey: q.axisKey,
          prompt: q.prompt,
          position: qi,
          options: q.options
            .filter((o) => o.label.trim() && o.axisValueValue)
            .map((o, i) => ({
              label: o.label,
              axisValueValue: o.axisValueValue,
              botResponse: o.botResponse || null,
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
                  options: [],
                };
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
                            return (
                              <div key={rank} style={{ flex: 1 }}>
                                <Select
                                  label={`Rank ${rank}${rank === 1 ? " (Top Match)" : ""}`}
                                  options={variantOptions}
                                  value={getRuleTarget(combo, rank)}
                                  onChange={(v) => setRuleTarget(combo, rank, v)}
                                />
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
