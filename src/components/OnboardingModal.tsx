import { useState, useCallback } from "react";
import { ChevronRight, ChevronLeft, FolderOpen, ImageIcon, FileText, Code2, Check, Globe } from "lucide-react";
import { useT, type Lang } from "../i18n/i18n";
import { useWorkspace } from "../hooks/useWorkspace";
import { GlassModal } from "./ui/GlassModal";
import { FlintLogo } from "./FlintLogo";

interface OnboardingModalProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 4;

interface CategoryCard {
  titleKey: string;
  subKey: string;
  icon: typeof ImageIcon;
}

const CATEGORIES: CategoryCard[] = [
  { titleKey: "onboarding.category_images", subKey: "onboarding.category_images_sub", icon: ImageIcon },
  { titleKey: "onboarding.category_pdf", subKey: "onboarding.category_pdf_sub", icon: FileText },
  { titleKey: "onboarding.category_dev", subKey: "onboarding.category_dev_sub", icon: Code2 },
];

/* The flint shard drawing itself in — same motion as the splash. */
function DrawnLogo({ size = 72 }: { size?: number }) {
  return (
    <div className="splash-logo">
      <div className="splash-glow" />
      <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <polygon className="splash-shadow" points="28,20 42,38 50,56 22,60 14,32" fill="var(--flint-bg-elevated)" />
        <polygon className="splash-lit" points="36,8 58,28 42,38 28,20" fill="var(--flint-accent)" />
        <polygon
          className="splash-outline"
          points="36,8 58,28 50,56 22,60 14,32"
          fill="none"
          stroke="var(--flint-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* Progress dots — coral active, dim completed. */
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {Array.from({ length: total }, (_, i) => {
        const isCompleted = i < current;
        const isActive = i === current;
        return (
          <div key={i} className="flex items-center gap-3">
            <div
              className="rounded-full transition-all duration-300"
              style={{
                width: isActive ? 8 : 6,
                height: isActive ? 8 : 6,
                background: isActive
                  ? "var(--indigo-core)"
                  : isCompleted
                    ? "var(--indigo-muted)"
                    : "var(--bg-border)",
              }}
            />
            {i < total - 1 && (
              <div
                style={{
                  height: 1,
                  width: 24,
                  background: isCompleted ? "var(--indigo-muted)" : "var(--bg-border)",
                  transition: "background 300ms ease",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const { lang, setLang, t } = useT();
  const { workspace, selectWorkspace } = useWorkspace();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  const goNext = useCallback(() => {
    setAnimKey((k) => k + 1);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const goBack = useCallback(() => {
    setAnimKey((k) => k + 1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  return (
    <GlassModal maxWidth="max-w-xl" className="rounded-3xl p-0 overflow-hidden">
      <div className="px-8 pt-7 pb-8">
        <div className="mb-7">
          <ProgressDots current={step} total={TOTAL_STEPS} />
        </div>

        {/* ── Step 0: Welcome + Language ── */}
        {step === 0 && (
          <div key={`s0-${animKey}`} className="ob-fade flex flex-col items-center text-center">
            <div className="mb-7 flex h-24 w-24 items-center justify-center">
              <DrawnLogo size={72} />
            </div>

            <h2 className="text-2xl font-light tracking-tight" style={{ color: "var(--text-primary)" }}>
              {t("onboarding.welcome")}
            </h2>
            <p className="mt-2.5 max-w-xs" style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
              {t("onboarding.welcome_sub")}
            </p>

            <div className="mt-8 w-full max-w-xs">
              <p
                className="font-semibold uppercase mb-3"
                style={{ fontSize: "10px", letterSpacing: "0.2em", color: "var(--text-tertiary)" }}
              >
                {t("onboarding.language")}
              </p>
              <div className="flex gap-2">
                {(["en", "fr"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`btn-toggle ${lang === l ? "btn-toggle-active" : ""}`}
                  >
                    <Globe className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {l === "en" ? "English" : "Français"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 1: Workspace ── */}
        {step === 1 && (
          <div key={`s1-${animKey}`} className="ob-fade flex flex-col items-center text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl mb-5"
              style={{ background: "var(--bg-overlay)", border: "1px solid var(--bg-border)" }}
            >
              <FolderOpen className="h-7 w-7" style={{ color: "var(--indigo-core)" }} strokeWidth={1.5} />
            </div>

            <h2 className="text-2xl font-light tracking-tight" style={{ color: "var(--text-primary)" }}>
              {t("onboarding.workspace_title")}
            </h2>
            <p className="mt-2 max-w-sm" style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
              {t("onboarding.workspace_sub")}
            </p>

            <div className="mt-7 w-full max-w-xs">
              {workspace ? (
                <div
                  className="rounded-xl px-4 py-3"
                  style={{ border: "1px solid rgba(232,87,42,0.25)", background: "rgba(232,87,42,0.06)" }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "rgba(232,87,42,0.15)" }}
                    >
                      <Check className="h-3 w-3" style={{ color: "var(--indigo-core)" }} strokeWidth={2.5} />
                    </div>
                    <p
                      className="truncate flex-1 text-left"
                      style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--text-primary)" }}
                    >
                      {workspace}
                    </p>
                    <button onClick={selectWorkspace} className="btn-pill shrink-0">
                      {t("settings.change")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={selectWorkspace}
                  className="group w-full rounded-xl px-4 py-5 transition-all duration-200 cursor-pointer"
                  style={{ border: "2px dashed var(--bg-border)", background: "var(--bg-overlay)" }}
                >
                  <FolderOpen
                    className="h-6 w-6 mx-auto mb-2 transition-colors duration-200"
                    style={{ color: "var(--text-tertiary)" }}
                    strokeWidth={1.5}
                  />
                  <span style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
                    {t("onboarding.choose_folder")}
                  </span>
                </button>
              )}
            </div>

            <p className="mt-4 max-w-xs forge-hint">{t("onboarding.workspace_auto")}</p>
          </div>
        )}

        {/* ── Step 2: Discover ── */}
        {step === 2 && (
          <div key={`s2-${animKey}`} className="ob-fade flex flex-col items-center text-center">
            <h2 className="text-2xl font-light tracking-tight mb-5" style={{ color: "var(--text-primary)" }}>
              {t("onboarding.discover")}
            </h2>

            <div className="w-full max-w-sm space-y-2.5">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                return (
                  <div
                    key={cat.titleKey}
                    className="flex items-center gap-4 rounded-xl px-4 py-3.5"
                    style={{ border: "1px solid var(--bg-border)", background: "var(--bg-overlay)" }}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--bg-border)" }}
                    >
                      <Icon className="h-5 w-5" style={{ color: "var(--indigo-core)" }} strokeWidth={1.5} />
                    </div>
                    <div className="text-left min-w-0">
                      <p style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text-primary)" }}>
                        {t(cat.titleKey)}
                      </p>
                      <p className="truncate" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {t(cat.subKey)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Step 3: Ready ── */}
        {step === 3 && (
          <div key={`s3-${animKey}`} className="ob-fade flex flex-col items-center text-center py-6">
            <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
              <div
                className="absolute inset-0 m-auto h-16 w-16 rounded-full blur-2xl"
                style={{ background: "rgba(232,87,42,0.18)" }}
              />
              <div
                className="relative flex h-20 w-20 items-center justify-center rounded-full"
                style={{
                  background: "var(--bg-overlay)",
                  border: "1px solid var(--bg-border)",
                  boxShadow: "0 4px 24px rgba(232,87,42,0.18)",
                }}
              >
                <FlintLogo size={44} />
              </div>
            </div>

            <h2 className="text-2xl font-light tracking-tight" style={{ color: "var(--text-primary)" }}>
              {t("onboarding.ready_title")}
            </h2>
            <p className="mt-2" style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
              {t("onboarding.ready_sub")}
            </p>

            <button onClick={onComplete} className="btn-primary mt-8">
              {t("onboarding.lets_go")}
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {/* ── Navigation — hidden on last step ── */}
        {step < TOTAL_STEPS - 1 && (
          <div className="flex items-center justify-between mt-8">
            {step > 0 ? (
              <button onClick={goBack} className="btn-ghost">
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t("onboarding.back")}
              </button>
            ) : (
              <button onClick={onComplete} className="btn-ghost">
                {t("onboarding.skip")}
              </button>
            )}

            <button onClick={goNext} className="btn-primary">
              {t("onboarding.next")}
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </GlassModal>
  );
}
