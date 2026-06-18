interface SplashScreenProps {
  visible: boolean;
}

/**
 * Splash — the Flint shard draws itself on load: the outline strokes in, then
 * the lit and shadowed faces fade in, over a soft ember glow. No spinner, no bar.
 */
export function SplashScreen({ visible }: SplashScreenProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center transition-opacity duration-500"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="splash-logo">
        <div className="splash-glow" />
        <svg
          width={104}
          height={104}
          viewBox="0 0 72 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Shadowed face — fades in */}
          <polygon className="splash-shadow" points="28,20 42,38 50,56 22,60 14,32" fill="var(--flint-bg-elevated)" />
          {/* Lit face — fades in */}
          <polygon className="splash-lit" points="36,8 58,28 42,38 28,20" fill="var(--flint-accent)" />
          {/* Outline — strokes itself in */}
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
    </div>
  );
}
