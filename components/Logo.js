import { useId } from "react";

// "PS" monogram on a gradient tile. The PNG app icons (lib/brand-icon.js) mirror this design.
export default function Logo({ size = 36, className = "" }) {
  const gradientId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Puneet Studios"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        fontFamily="var(--font-geist-sans), Arial, sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="-1"
        fill="#fff"
      >
        PS
      </text>
    </svg>
  );
}
