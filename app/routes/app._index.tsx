import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Box,
  Icon,
  Badge,
  Button,
  ProgressBar,
  IndexTable,
  EmptyState,
  InlineGrid,
} from "@shopify/polaris";
import {
  ProductIcon,
  ViewIcon,
  PlusCircleIcon,
  EditIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getConfiguredProducts,
  getAnalytics,
  getOnboardingState,
  updateOnboardingStep,
  saveOnboardingSurvey,
  completeOnboarding as completeOnboardingDb,
} from "../lib/supabase.server";
import { sendOnboardingCompleteEmail } from "../lib/email.server";
import { useCatalogSync } from "../lib/use-catalog-sync";

// ============================================================
// Types
// ============================================================

interface ConfiguredProduct {
  id: string;
  product_name: string;
  shopify_id: string;
  transformation_prompt: string;
  created_at: string;
}

interface ProductStat {
  product_id: string;
  product_name: string;
  shopify_id: string;
  transformations: number;
}

interface LoaderData {
  shopDomain: string;
  ownerName: string;
  configuredProducts: ConfiguredProduct[];
  configuredProductsCount: number;
  activeProducts: number;
  productStats: ProductStat[];
  allStepsComplete: boolean;
  onboarding: {
    step: number;
    completed: boolean;
    goals: string[];
    attribution: string[];
  };
}

// ============================================================
// Loader
// ============================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let ownerName = "";
  try {
    const response = await admin.graphql(`
      query GetShopOwner {
        shop {
          shopOwnerName
        }
      }
    `);
    const data = await response.json();
    ownerName = data.data?.shop?.shopOwnerName || "";
  } catch (error) {
    console.error("Error fetching shop owner name:", error);
  }

  const [allProducts, analytics, onboarding] = await Promise.all([
    getConfiguredProducts(shopDomain),
    getAnalytics(shopDomain, 365),
    getOnboardingState(shopDomain),
  ]);

  console.log(`[Onboarding Loader] shop=${shopDomain}, step=${onboarding.step}, completed=${onboarding.completed}`);

  // "Configured" means TRY-ON configured (has a transformation prompt).
  // Catalog sync inserts prompt-less rows into the same table mid-onboarding;
  // counting those flipped the wizard-skip heuristic below and dumped
  // merchants onto the dashboard in the middle of the Connect Catalog step.
  const configuredProducts = allProducts.filter(
    (p: any) => typeof p.transformation_prompt === "string" && p.transformation_prompt.length > 0,
  );
  const configuredProductsCount = configuredProducts.length;
  const activeProducts = analytics?.productBreakdown?.length || 0;
  const productStats = (analytics?.productBreakdown || []) as ProductStat[];
  const allStepsComplete = configuredProductsCount > 0 && activeProducts > 0;

  return json<LoaderData>({
    shopDomain,
    ownerName,
    configuredProducts,
    configuredProductsCount,
    activeProducts,
    productStats,
    allStepsComplete,
    onboarding,
  });
};

// ============================================================
// Action
// ============================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // All intents can optionally include a step update to avoid race conditions
  const stepRaw = formData.get("step") as string | null;
  const goalsRaw = formData.get("goals") as string | null;
  const attributionRaw = formData.get("attribution") as string | null;

  console.log(`[Onboarding Action] intent=${intent}, step=${stepRaw}, shop=${shopDomain}`);

  switch (intent) {
    case "updateStep": {
      const step = parseInt(stepRaw!, 10);
      console.log(`[Onboarding Action] Saving step ${step} for ${shopDomain}`);
      await updateOnboardingStep(shopDomain, step);
      console.log(`[Onboarding Action] Step ${step} saved successfully`);
      return json({ ok: true });
    }
    case "saveSurveyAndStep": {
      // Combined: save survey data AND update step in sequence (no race)
      const goals = goalsRaw ? JSON.parse(goalsRaw) : undefined;
      const attribution = attributionRaw ? JSON.parse(attributionRaw) : undefined;
      await saveOnboardingSurvey(shopDomain, goals, attribution);
      if (stepRaw) {
        await updateOnboardingStep(shopDomain, parseInt(stepRaw, 10));
      }
      return json({ ok: true });
    }
    case "completeOnboarding": {
      const goals = goalsRaw ? JSON.parse(goalsRaw) : [];
      const attribution = attributionRaw ? JSON.parse(attributionRaw) : [];
      await completeOnboardingDb(shopDomain);
      sendOnboardingCompleteEmail(shopDomain, goals, attribution).catch(() => {});
      return json({ ok: true });
    }
    default:
      return json({ error: "Unknown intent" }, { status: 400 });
  }
};

// ============================================================
// Constants
// ============================================================

const TOTAL_STEPS = 7;

const CONTACT_URL = "https://www.gleame.ai/contact";

const GOAL_OPTIONS = [
  {
    id: "conversion",
    label: "Improve conversion rates",
    description: "Help customers make faster purchasing decisions",
    emoji: "📈",
  },
  {
    id: "returns",
    label: "Reduce return rates",
    description: "Minimize returns due to sizing or fit issues",
    emoji: "📦",
  },
  {
    id: "other",
    label: "Other",
    description: "",
    emoji: "✨",
  },
];

const ATTRIBUTION_OPTIONS = [
  { id: "shopify_app_store", label: "Shopify App Store", emoji: "🏪" },
  { id: "google_search", label: "Google Search", emoji: "🔍" },
  { id: "social_media", label: "Social Media", emoji: "📱" },
  { id: "tiktok", label: "TikTok", emoji: "📣" },
  { id: "another_store", label: "Saw it on another store", emoji: "🌐" },
  { id: "ai_tools", label: "ChatGPT / AI tools", emoji: "🤖" },
  { id: "word_of_mouth", label: "Word of mouth", emoji: "💬" },
  { id: "other", label: "Other", emoji: "✨" },
];

const LOOM_EMBED_URL = "https://www.loom.com/embed/f9049be91b344462980e623eaf232f81";

// ============================================================
// Selectable Card Component
// ============================================================

function SelectableCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: selected ? "2px solid #2C6ECB" : "1px solid #E1E3E5",
        borderRadius: "12px",
        padding: "16px",
        cursor: "pointer",
        background: selected ? "#F2F7FE" : "#FFFFFF",
        transition: "all 0.15s ease",
      }}
    >
      {children}
    </div>
  );
}

// ============================================================
// Step Components
// ============================================================

function Step1Welcome({ onNext }: { onNext: () => void }) {
  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="h2" variant="headingLg" alignment="center">
          What you can do with Gleame
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          Here's a quick overview of how Gleame will help your store
        </Text>
      </BlockStack>

      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
        <div
          style={{
            border: "1px solid #E1E3E5",
            borderRadius: "12px",
            padding: "24px",
            background: "#FFFFFF",
          }}
        >
          <BlockStack gap="300">
            <Text as="span" variant="headingXl">
              👕
            </Text>
            <Text as="h3" variant="headingMd">
              Show shoppers how they'd look
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Allow shoppers to upload their photo and see how your products look
              on them instantly.
            </Text>
          </BlockStack>
        </div>

        <div
          style={{
            border: "1px solid #E1E3E5",
            borderRadius: "12px",
            padding: "24px",
            background: "#FFFFFF",
          }}
        >
          <BlockStack gap="300">
            <Text as="span" variant="headingXl">
              📊
            </Text>
            <Text as="h3" variant="headingMd">
              Increase Conversion Rate & Reduce Returns
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Help customers make confident purchasing decisions with AI-powered
              try-on.
            </Text>
          </BlockStack>
        </div>
      </InlineGrid>

      <InlineStack align="center">
        <Button variant="primary" size="large" onClick={onNext}>
          Get Started
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function Step2Goals({
  selectedGoals,
  onGoalsChange,
  onNext,
  onBack,
}: {
  selectedGoals: string[];
  onGoalsChange: (goals: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const toggleGoal = (id: string) => {
    onGoalsChange(
      selectedGoals.includes(id)
        ? selectedGoals.filter((g) => g !== id)
        : [...selectedGoals, id]
    );
  };

  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="h2" variant="headingLg" alignment="center">
          What do you want to achieve?
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          Select all that apply
        </Text>
      </BlockStack>

      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
        {GOAL_OPTIONS.map((goal) => (
          <SelectableCard
            key={goal.id}
            selected={selectedGoals.includes(goal.id)}
            onClick={() => toggleGoal(goal.id)}
          >
            <BlockStack gap="200">
              <Text as="span" variant="headingLg">
                {goal.emoji}
              </Text>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {goal.label}
              </Text>
              {goal.description && (
                <Text as="span" variant="bodySm" tone="subdued">
                  {goal.description}
                </Text>
              )}
            </BlockStack>
          </SelectableCard>
        ))}
      </InlineGrid>

      <InlineStack align="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button
          variant="primary"
          onClick={onNext}
          disabled={selectedGoals.length === 0}
        >
          Continue
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function Step3Attribution({
  selectedAttribution,
  onAttributionChange,
  onNext,
  onBack,
  onSkip,
}: {
  selectedAttribution: string[];
  onAttributionChange: (attr: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const toggleAttribution = (id: string) => {
    onAttributionChange(
      selectedAttribution.includes(id)
        ? selectedAttribution.filter((a) => a !== id)
        : [...selectedAttribution, id]
    );
  };

  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="h2" variant="headingLg" alignment="center">
          How did you hear about us?
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          This helps us understand how merchants discover Gleame
        </Text>
      </BlockStack>

      <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
        {ATTRIBUTION_OPTIONS.map((attr) => (
          <SelectableCard
            key={attr.id}
            selected={selectedAttribution.includes(attr.id)}
            onClick={() => toggleAttribution(attr.id)}
          >
            <BlockStack gap="200" inlineAlign="center">
              <Text as="span" variant="headingLg" alignment="center">
                {attr.emoji}
              </Text>
              <Text
                as="span"
                variant="bodySm"
                fontWeight="medium"
                alignment="center"
              >
                {attr.label}
              </Text>
            </BlockStack>
          </SelectableCard>
        ))}
      </InlineGrid>

      <InlineStack align="space-between">
        <Button onClick={onBack}>Back</Button>
        <InlineStack gap="200">
          <Button onClick={onSkip}>Skip</Button>
          <Button
            variant="primary"
            onClick={onNext}
            disabled={selectedAttribution.length === 0}
          >
            Continue
          </Button>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}

function Step4ConnectCatalog({
  onNext,
  onBack,
  onBookCall,
}: {
  onNext: () => void;
  onBack: () => void;
  onBookCall: () => void;
}) {
  // Shared chunked-sync driver (same code path as the Quiz Builder card).
  const { start, progress, syncDone, syncError, syncedCount } = useCatalogSync();

  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="h2" variant="headingLg" alignment="center">
          Connect your catalog
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          Gleame syncs your Shopify products so the quiz can recommend them.
          Nothing changes in your store.
        </Text>
      </BlockStack>

      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: "12px",
          padding: "32px",
          background: "#FFFFFF",
          textAlign: "center",
        }}
      >
        <BlockStack gap="400" inlineAlign="center">
          {syncDone ? (
            <>
              <Text as="span" variant="headingXl">
                ✅
              </Text>
              <Text as="p" variant="headingMd">
                Catalog synced ({syncedCount} products)
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                We'll keep it up to date automatically from now on.
              </Text>
            </>
          ) : progress ? (
            <div style={{ width: "100%", maxWidth: 360 }}>
              <BlockStack gap="200">
                <ProgressBar
                  progress={progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 10}
                  size="small"
                  tone="primary"
                />
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  Synced {progress.done}
                  {progress.total ? ` of ${progress.total}` : ""} products…
                </Text>
              </BlockStack>
            </div>
          ) : (
            <>
              <Text as="span" variant="headingXl">
                🛍️
              </Text>
              {syncError && (
                <Text as="p" variant="bodySm" tone="critical">
                  Sync hit a problem: {syncError}. You can retry, or continue and
                  sync later from the Quiz Builder.
                </Text>
              )}
              <Button variant="primary" onClick={() => start()}>
                {syncError ? "Retry sync" : "Sync my catalog"}
              </Button>
            </>
          )}
        </BlockStack>
      </div>

      <InlineStack align="space-between">
        <Button onClick={onBack}>Back</Button>
        <InlineStack gap="200" blockAlign="center">
          <Button variant="plain" onClick={onBookCall}>
            Prefer we set it up? Book a call
          </Button>
          <Button variant="primary" onClick={onNext} disabled={progress !== null}>
            {syncDone ? "Continue" : "Skip for now"}
          </Button>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}

function Step5BuildQuiz({
  onNext,
  onBack,
  onNavigateToBuilder,
}: {
  onNext: () => void;
  onBack: () => void;
  onNavigateToBuilder: () => void;
}) {
  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="h2" variant="headingLg" alignment="center">
          Build your quiz
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          Create your Find My Fit quiz in the Quiz Builder. You'll work on a
          draft — nothing goes live until you publish.
        </Text>
      </BlockStack>

      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: "12px",
          padding: "32px",
          background: "#FFFFFF",
          textAlign: "center",
        }}
      >
        <BlockStack gap="400" inlineAlign="center">
          <Text as="span" variant="headingXl">
            🧩
          </Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            Pick your questions, map answers to products, and style it to match
            your brand — then come back here to finish up.
          </Text>
          <Button variant="primary" onClick={onNavigateToBuilder}>
            Open Quiz Builder
          </Button>
        </BlockStack>
      </div>

      <InlineStack align="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function Step6GoLive({
  onNext,
  onBack,
  onSkip,
  onNavigateToQuizSetup,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onNavigateToQuizSetup: () => void;
}) {
  return (
    <BlockStack gap="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="h2" variant="headingLg" alignment="center">
          Get your quiz live on your storefront
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          Add the Find My Fit quiz to your theme so shoppers get matched to the
          right products
        </Text>
      </BlockStack>

      <InlineStack align="center">
        <Button onClick={onNavigateToQuizSetup}>
          Open Quiz Setup
        </Button>
      </InlineStack>

      {/* Video Walkthrough */}
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">
          Video Walkthrough
        </Text>
        <div
          style={{
            position: "relative",
            paddingBottom: "56.25%",
            height: 0,
            borderRadius: "12px",
            overflow: "hidden",
            border: "1px solid #E1E3E5",
          }}
        >
          <iframe
            title="Gleame quiz setup walkthrough"
            src={LOOM_EMBED_URL}
            allow="fullscreen"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
            }}
          />
        </div>
      </BlockStack>

      {/* Quick Instructions */}
      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: "12px",
          padding: "20px",
          background: "#FFFFFF",
        }}
      >
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            Quick Instructions
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              1. Open Quiz Setup and finish the checklist (questions, copy, design)
            </Text>
            <Text as="p" variant="bodyMd">
              2. In the theme editor, add the "Gleame Quiz" section to a page
            </Text>
            <Text as="p" variant="bodyMd">
              3. Click "Save" in the theme editor
            </Text>
          </BlockStack>
        </BlockStack>
      </div>

      <InlineStack align="space-between">
        <Button onClick={onBack}>Back</Button>
        <InlineStack gap="200">
          <Button onClick={onSkip}>Skip</Button>
          <Button variant="primary" onClick={onNext}>
            Continue
          </Button>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}

function Step7Complete({
  onFinish,
}: {
  onFinish: () => void;
}) {
  return (
    <BlockStack gap="600">
      <BlockStack gap="300" inlineAlign="center">
        <Text as="span" variant="heading2xl" alignment="center">
          🎉
        </Text>
        <Text as="h2" variant="headingLg" alignment="center">
          You're all set!
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          Your store is ready for AI-powered virtual try-on. Customers can now
          see how your products look on them before purchasing.
        </Text>
      </BlockStack>

      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: "12px",
          padding: "24px",
          background: "#FFFFFF",
        }}
      >
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            What's next?
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              • Add more products from the Products page
            </Text>
            <Text as="p" variant="bodyMd">
              • Track performance in Analytics
            </Text>
            <Text as="p" variant="bodyMd">
              • Fine-tune your quiz copy and design from the Quiz page
            </Text>
          </BlockStack>
        </BlockStack>
      </div>

      <InlineStack align="center">
        <Button variant="primary" size="large" onClick={onFinish}>
          Go to Dashboard
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

// ============================================================
// Onboarding Wizard
// ============================================================

function OnboardingWizard({
  initialStep,
  initialGoals,
  initialAttribution,
  onComplete,
  navigate,
}: {
  initialStep: number;
  initialGoals: string[];
  initialAttribution: string[];
  onComplete: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [currentStep, setCurrentStep] = useState(
    initialStep > 0 ? initialStep : 1
  );
  const [selectedGoals, setSelectedGoals] = useState<string[]>(initialGoals);
  const [selectedAttribution, setSelectedAttribution] =
    useState<string[]>(initialAttribution);
  const fetcher = useFetcher();
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const prevFetcherState = useRef(fetcher.state);

  // Sync currentStep with server state when initialStep changes
  // (e.g. after revalidation or returning from another page)
  useEffect(() => {
    const serverStep = initialStep > 0 ? initialStep : 1;
    setCurrentStep((prev) => Math.max(prev, serverStep));
  }, [initialStep]);

  // Sync survey selections when loader data refreshes
  const goalsKey = initialGoals.join(",");
  useEffect(() => {
    if (initialGoals.length > 0) setSelectedGoals(initialGoals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsKey]);

  const attributionKey = initialAttribution.join(",");
  useEffect(() => {
    if (initialAttribution.length > 0) setSelectedAttribution(initialAttribution);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributionKey]);

  // Navigate only after the fetcher transitions from non-idle back to idle
  // (i.e., after the save actually completes). This prevents navigating
  // before the submission has started processing.
  useEffect(() => {
    if (
      pendingNav &&
      prevFetcherState.current !== "idle" &&
      fetcher.state === "idle"
    ) {
      navigate(pendingNav);
      setPendingNav(null);
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, pendingNav, navigate]);

  // Persist step 1 on first mount if DB has step 0 (step 1 is never persisted otherwise)
  useEffect(() => {
    if (initialStep === 0) {
      fetcher.submit(
        { intent: "updateStep", step: "1" },
        { method: "POST", action: "/app?index" }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: persist via fetcher with explicit action targeting the index route
  const persistToServer = useCallback(
    (data: Record<string, string>) => {
      console.log("[Onboarding] persistToServer called with:", data);
      fetcher.submit(data, { method: "POST", action: "/app?index" });
    },
    [fetcher]
  );

  const goToStep = useCallback(
    (step: number) => {
      setCurrentStep(step);
      // Fire-and-forget for in-page transitions (no navigation away)
      persistToServer({ intent: "updateStep", step: step.toString() });
    },
    [persistToServer]
  );

  const handleNextFromGoals = () => {
    setCurrentStep(3);
    // Single request: save goals AND update step together (no race)
    persistToServer({
      intent: "saveSurveyAndStep",
      goals: JSON.stringify(selectedGoals),
      step: "3",
    });
  };

  const handleNextFromAttribution = () => {
    setCurrentStep(4);
    // Single request: save attribution AND update step together (no race)
    persistToServer({
      intent: "saveSurveyAndStep",
      attribution: JSON.stringify(selectedAttribution),
      step: "4",
    });
  };

  const handleSkipAttribution = () => {
    goToStep(4);
  };

  const handleBookCall = () => {
    if (typeof window !== "undefined") {
      window.open(CONTACT_URL, "_blank", "noopener,noreferrer");
    }
    goToStep(5);
  };

  const handleComplete = () => {
    persistToServer({
      intent: "completeOnboarding",
      goals: JSON.stringify(selectedGoals),
      attribution: JSON.stringify(selectedAttribution),
    });
    onComplete();
  };

  const progressPercentage = Math.round((currentStep / TOTAL_STEPS) * 100);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F6F6F7",
        padding: "0",
      }}
    >
      {/* Header with progress */}
      <div
        style={{
          maxWidth: "780px",
          margin: "0 auto",
          padding: "32px 20px 0",
        }}
      >
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h1" variant="headingLg" fontWeight="bold">
            Welcome to Gleame
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            Step {currentStep} of {TOTAL_STEPS}
          </Text>
        </InlineStack>

        <div style={{ marginTop: "12px" }}>
          <ProgressBar
            progress={progressPercentage}
            size="small"
            tone="primary"
          />
        </div>
      </div>

      {/* Step content */}
      <div
        style={{
          maxWidth: "780px",
          margin: "0 auto",
          padding: "40px 20px",
        }}
      >
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "16px",
            padding: "40px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
          }}
        >
          {currentStep === 1 && <Step1Welcome onNext={() => goToStep(2)} />}

          {currentStep === 2 && (
            <Step2Goals
              selectedGoals={selectedGoals}
              onGoalsChange={setSelectedGoals}
              onNext={handleNextFromGoals}
              onBack={() => goToStep(1)}
            />
          )}

          {currentStep === 3 && (
            <Step3Attribution
              selectedAttribution={selectedAttribution}
              onAttributionChange={setSelectedAttribution}
              onNext={handleNextFromAttribution}
              onBack={() => goToStep(2)}
              onSkip={handleSkipAttribution}
            />
          )}

          {currentStep === 4 && (
            <Step4ConnectCatalog
              onNext={() => goToStep(5)}
              onBookCall={handleBookCall}
              onBack={() => goToStep(3)}
            />
          )}

          {currentStep === 5 && (
            <Step5BuildQuiz
              onNext={() => goToStep(6)}
              onBack={() => goToStep(4)}
              onNavigateToBuilder={() => {
                persistToServer({ intent: "updateStep", step: "5" });
                setPendingNav("/app/quiz-builder");
              }}
            />
          )}

          {currentStep === 6 && (
            <Step6GoLive
              onNext={() => goToStep(7)}
              onBack={() => goToStep(5)}
              onSkip={() => goToStep(7)}
              onNavigateToQuizSetup={() => {
                persistToServer({ intent: "updateStep", step: "6" });
                setPendingNav("/app/quiz");
              }}
            />
          )}

          {currentStep === 7 && <Step7Complete onFinish={handleComplete} />}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          padding: "0 20px 40px",
        }}
      >
        <Text as="p" variant="bodySm" tone="subdued">
          Need help?{" "}
          <a
            href="https://gleame.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#2C6ECB", textDecoration: "none" }}
          >
            Contact our support team
          </a>
        </Text>
      </div>
    </div>
  );
}

// ============================================================
// Dashboard View (existing dashboard)
// ============================================================

function DashboardView({
  ownerName,
  shopDomain,
  configuredProducts,
  configuredProductsCount,
  activeProducts,
  productStats,
  navigate,
}: {
  ownerName: string;
  shopDomain: string;
  configuredProducts: ConfiguredProduct[];
  configuredProductsCount: number;
  activeProducts: number;
  productStats: ProductStat[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const ownerFirstName = ownerName ? ownerName.split(" ")[0] : "";
  const storeName = shopDomain
    .replace(".myshopify.com", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const displayName = ownerFirstName || storeName;

  const productsWithStats = configuredProducts.map((product) => {
    const stats = productStats.find((s) => s.product_id === product.id);
    return {
      ...product,
      transformations: stats?.transformations || 0,
      isActive: (stats?.transformations || 0) > 0,
    };
  });

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="600">
        {/* Greeting */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl">
              Welcome back, {displayName}!
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Here's how your AI transformations are performing.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/analytics")}>
            View Analytics
          </Button>
        </InlineStack>

        {/* Stats Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" tone="subdued">
                  Products Configured
                </Text>
                <Box
                  background="bg-fill-info"
                  padding="100"
                  borderRadius="full"
                >
                  <Icon source={ProductIcon} tone="info" />
                </Box>
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {configuredProductsCount}
              </Text>
              <Button
                variant="plain"
                onClick={() => navigate("/app/products")}
              >
                Manage products →
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd" tone="subdued">
                  Widgets Active
                </Text>
                <Box
                  background="bg-fill-success"
                  padding="100"
                  borderRadius="full"
                >
                  <Icon source={ViewIcon} tone="success" />
                </Box>
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {activeProducts}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                products with transformations
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Configured Products */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Configured Products
              </Text>
              <Button
                icon={PlusCircleIcon}
                onClick={() => navigate("/app/products")}
              >
                Add Product
              </Button>
            </InlineStack>

            {productsWithStats.length === 0 ? (
              <EmptyState
                heading="No products configured yet"
                action={{
                  content: "Add Product",
                  onAction: () => navigate("/app/products"),
                }}
                image=""
              >
                <p>Configure your first product to start using Gleame.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{
                  singular: "product",
                  plural: "products",
                }}
                itemCount={productsWithStats.length}
                headings={[
                  { title: "Product" },
                  { title: "Status" },
                  { title: "Transformations" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {productsWithStats.map((product, index) => (
                  <IndexTable.Row
                    id={product.id}
                    key={product.id}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Text
                        as="span"
                        variant="bodyMd"
                        fontWeight="semibold"
                      >
                        {product.product_name.length > 43
                          ? `${product.product_name.substring(0, 43)}...`
                          : product.product_name}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={product.isActive ? "success" : "attention"}
                      >
                        {product.isActive ? "Active" : "Pending"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd">
                        {product.transformations}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button
                        icon={EditIcon}
                        size="slim"
                        variant="plain"
                        onClick={() => navigate("/app/products")}
                      >
                        Edit
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function Dashboard() {
  const {
    shopDomain,
    ownerName,
    configuredProducts,
    configuredProductsCount,
    activeProducts,
    productStats,
    onboarding,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Skip onboarding if:
  // 1. Explicitly completed, OR
  // 2. 2+ products configured (merchant is clearly set up), OR
  // 3. Has products but never started onboarding (pre-existing merchant)
  const shouldSkipOnboarding =
    onboarding.completed ||
    configuredProductsCount >= 2 ||
    (configuredProductsCount > 0 && onboarding.step === 0);

  const [onboardingCompleted, setOnboardingCompleted] =
    useState(shouldSkipOnboarding);

  // Update if loader data changes
  useEffect(() => {
    if (
      onboarding.completed ||
      configuredProductsCount >= 2 ||
      (configuredProductsCount > 0 && onboarding.step === 0)
    ) {
      setOnboardingCompleted(true);
    }
  }, [onboarding.completed, configuredProductsCount, onboarding.step]);

  if (!onboardingCompleted) {
    return (
      <OnboardingWizard
        initialStep={onboarding.step}
        initialGoals={onboarding.goals}
        initialAttribution={onboarding.attribution}
        onComplete={() => setOnboardingCompleted(true)}
        navigate={navigate}
      />
    );
  }

  return (
    <DashboardView
      ownerName={ownerName}
      shopDomain={shopDomain}
      configuredProducts={configuredProducts}
      configuredProductsCount={configuredProductsCount}
      activeProducts={activeProducts}
      productStats={productStats}
      navigate={navigate}
    />
  );
}
