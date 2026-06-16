import { useState, useMemo, useCallback } from "react";
import { ChevronRight, ChevronLeft, FolderOpen, ImageIcon, FileText, Code2, Check, Globe } from "lucide-react";
import { useT, type Lang } from "../i18n/i18n";
import { useWorkspace } from "../hooks/useWorkspace";
import { GlassModal } from "./ui/GlassModal";
import { FlintLogo } from "./FlintLogo";

interface OnboardingModalProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 4;

const NOISE_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")";

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

/* ── Floating particles — dust in light effect ── */
function ParticleLayer() {
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        left: `${8 + Math.random() * 84}%`,
        bottom: `${Math.random() * 30}%`,
        size: 2 + Math.random() * 3,
        opacity: 0.06 + Math.random() * 0.1,
        travel: -(30 + Math.random() * 40),
        duration: 5 + Math.random() * 5,
        delay: Math.random() * 6,
      })),
    [],
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <span
          key={p.id}
          className="ob-particle"
          style={
            {
              left: p.left,
              bottom: p.bottom,
              width: p.size,
              height: p.size,
              "--ob-p-opacity": p.opacity,
              "--ob-p-travel": `${p.travel}px`,
              "--ob-p-dur": `${p.duration}s`,
              "--ob-p-delay": `${p.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ── Orbit ring around logo ── */
function OrbitRing() {
  return (
    <div className="absolute -inset-3" style={{ animation: "ob-orbit-spin 20s linear infinite" }}>
      {/* Ring */}
      <svg className="w-full h-full" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="48" style={{ stroke: "var(--bg-border)" }} strokeWidth="0.5" />
      </svg>
    </div>
  );
}

/* ── Word-by-word reveal ── */
function WordReveal({ text, baseDelay = 200 }: { text: string; baseDelay?: number }) {
  const words = text.split(" ");
  return (
    <span>
      {words.map((word, i) => (
        <span
          key={i}
          className="inline-block"
          style={{
            animation: `ob-word-reveal 400ms cubic-bezier(0.16, 1, 0.3, 1) ${baseDelay + i * 80}ms both`,
          }}
        >
          {word}
          {i < words.length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </span>
  );
}

/* ── Progress dots ── */
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {Array.from({ length: total }, (_, i) => {
        const isCompleted = i < current;
        const isActive = i === current;
        return (
          <div key={i} className="flex items-center gap-3">
            <div
              className={`rounded-full transition-all duration-500 ${
                isActive
                  ? "h-2 w-2 bg-indigo-400 ob-dot-active"
                  : isCompleted
                    ? "h-1.5 w-1.5 bg-indigo-400/50"
                    : "h-1.5 w-1.5 bg-white/10"
              }`}
            />
            {i < total - 1 && (
              <div
                className={`h-px w-6 transition-all duration-500 ${isCompleted ? "bg-indigo-400/30" : "bg-white/8"}`}
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
      {/* Aurora mesh background */}
      <div className="ob-aurora absolute inset-0 pointer-events-none" />

      <div className="relative px-8 pt-7 pb-8">
        {/* Progress dots */}
        <div className="mb-7">
          <ProgressDots current={step} total={TOTAL_STEPS} />
        </div>

        {/* ── Step 0: Welcome + Language ── */}
        {step === 0 && (
          <div key={`s0-${animKey}`} className="ob-morph-in flex flex-col items-center text-center">
            {/* Logo with orbit */}
            <div className="relative mb-7 h-24 w-24 flex items-center justify-center">
              <OrbitRing />
              <div
                className="absolute inset-0 m-auto h-12 w-12 rounded-full blur-xl ob-glow-pulse"
                style={{ background: "rgba(232,87,42,0.2)" }}
              />
              <FlintLogo size={64} className="relative drop-shadow-[0_4px_20px_rgba(232,87,42,0.3)]" />
            </div>

            <h2 className="text-2xl font-light tracking-tight" style={{ color: "var(--text-primary)" }}>
              <WordReveal text={t("onboarding.welcome")} baseDelay={100} />
            </h2>
            <p
              className="mt-2.5 max-w-xs"
              style={{
                fontSize: "var(--text-base)",
                color: "var(--text-secondary)",
                animation: "ob-word-reveal 500ms cubic-bezier(0.16,1,0.3,1) 500ms both",
              }}
            >
              {t("onboarding.welcome_sub")}
            </p>

            {/* Language selector */}
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
                    {l === "en" ? "English" : "Fran\u00e7ais"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 1: Workspace ── */}
        {step === 1 && (
          <div key={`s1-${animKey}`} className="ob-morph-in flex flex-col items-center text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl mb-5"
              style={{ background: "var(--bg-overlay)", border: "1px solid var(--bg-border)" }}
            >
              <FolderOpen className="h-7 w-7 text-indigo-400/70" strokeWidth={1.5} />
            </div>

            <h2 className="text-2xl font-light tracking-tight" style={{ color: "var(--text-primary)" }}>
              {t("onboarding.workspace_title")}
            </h2>
            <p className="mt-2 max-w-sm" style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
              {t("onboarding.workspace_sub")}
            </p>

            <div className="mt-7 w-full max-w-xs">
              {workspace ? (
                <div className="ob-scale-in relative rounded-xl border border-indigo-400/20 bg-indigo-500/5 px-4 py-3">
                  <div className="absolute top-0 inset-x-0 h-px bg-linear-to-r from-transparent via-indigo-400/15 to-transparent" />
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15">
                      <Check className="h-3 w-3 text-indigo-400" strokeWidth={2.5} />
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
                  className="group relative w-full overflow-hidden rounded-xl px-4 py-5 transition-all duration-300 cursor-pointer hover:border-indigo-400/25"
                  style={{ border: "2px dashed var(--bg-border)", background: "var(--bg-overlay)" }}
                >
                  <div className="absolute top-0 inset-x-0 h-px bg-linear-to-r from-transparent via-indigo-400/10 to-transparent" />
                  <div
                    className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay rounded-xl"
                    style={{ backgroundImage: NOISE_SVG }}
                  />
                  <FolderOpen
                    className="relative h-6 w-6 mx-auto mb-2 group-hover:text-indigo-400/70 transition-colors duration-300"
                    style={{ color: "var(--text-tertiary)" }}
                    strokeWidth={1.5}
                  />
                  <span
                    className="relative transition-colors duration-300"
                    style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}
                  >
                    {t("onboarding.choose_folder")}
                  </span>
                </button>
              )}
            </div>

            <p className="mt-4 max-w-xs forge-hint">{t("onboarding.workspace_auto")}</p>
          </div>
        )}

        {/* ── Step 2: Discover — 3 monochrome glass cards ── */}
        {step === 2 && (
          <div key={`s2-${animKey}`} className="ob-morph-in flex flex-col items-center text-center">
            <h2 className="text-2xl font-light tracking-tight mb-5" style={{ color: "var(--text-primary)" }}>
              {t("onboarding.discover")}
            </h2>

            <div className="w-full max-w-sm space-y-2.5">
              {CATEGORIES.map((cat, i) => {
                const Icon = cat.icon;
                return (
                  <div
                    key={cat.titleKey}
                    className={`ob-stagger-${i + 1} relative flex items-center gap-4 rounded-xl px-4 py-3.5 transition-all duration-300`}
                    style={{ border: "1px solid var(--bg-border)", background: "var(--bg-overlay)" }}
                  >
                    <div className="absolute top-0 inset-x-0 h-px bg-linear-to-r from-transparent via-indigo-400/10 to-transparent" />
                    <div
                      className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay rounded-xl"
                      style={{ backgroundImage: NOISE_SVG }}
                    />
                    <div
                      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--bg-border)" }}
                    >
                      <Icon className="h-5 w-5 text-indigo-400/60" strokeWidth={1.5} />
                    </div>
                    <div className="relative text-left min-w-0">
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

        {/* ── Step 3: Ready — premium finish ── */}
        {step === 3 && (
          <div key={`s3-${animKey}`} className="ob-morph-in relative flex flex-col items-center text-center py-6">
            <ParticleLayer />

            {/* Logo callback — full circle */}
            <div className="ob-scale-in relative mb-6 h-24 w-24 flex items-center justify-center">
              <div
                className="absolute inset-0 m-auto h-16 w-16 rounded-full blur-2xl ob-glow-pulse"
                style={{ background: "rgba(232,87,42,0.15)" }}
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

            <h2
              className="ob-scale-in text-2xl font-light tracking-tight"
              style={{ color: "var(--text-primary)", animationDelay: "120ms" }}
            >
              {t("onboarding.ready_title")}
            </h2>
            <p
              className="ob-scale-in mt-2"
              style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", animationDelay: "220ms" }}
            >
              {t("onboarding.ready_sub")}
            </p>

            <button onClick={onComplete} className="btn-primary ob-scale-in mt-8" style={{ animationDelay: "380ms" }}>
              {t("onboarding.lets_go")}
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {/* ── Navigation — hidden on last step ── */}
        {step < TOTAL_STEPS - 1 && (
          <div className="relative flex items-center justify-between mt-8">
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
