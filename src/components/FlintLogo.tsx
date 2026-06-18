interface FlintLogoProps {
  size?: number;
  className?: string;
}

/**
 * Flint logo — "Fragment": an asymmetric flint shard.
 * A lit face (coral) catching the strike, the rest in shadow.
 */
export function FlintLogo({ size = 20, className }: FlintLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Shard outline */}
      <polygon points="36,8 58,28 50,56 22,60 14,32" fill="none" stroke="var(--flint-accent)" strokeWidth="2" />
      {/* Lit face */}
      <polygon points="36,8 58,28 42,38 28,20" fill="var(--flint-accent)" />
      {/* Shadowed face */}
      <polygon points="28,20 42,38 50,56 22,60 14,32" fill="var(--flint-bg-elevated)" />
    </svg>
  );
}
