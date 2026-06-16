import { FlintLogo } from "./FlintLogo";

interface SplashScreenProps {
  visible: boolean;
}

export function SplashScreen({ visible }: SplashScreenProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex flex-col items-center justify-center transition-opacity duration-500"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="animate-spin-slow" style={{ animationDuration: "3s" }}>
        <FlintLogo size={64} />
      </div>
      <div
        className="mt-6 overflow-hidden"
        style={{ height: 2, width: 96, borderRadius: 1, background: "var(--bg-border)" }}
      >
        <div className="h-full w-full animate-loading" style={{ borderRadius: 1, background: "var(--indigo-core)" }} />
      </div>
    </div>
  );
}
