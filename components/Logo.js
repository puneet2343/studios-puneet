import { useId } from "react";

// "PS" monogram on a gradient tile with a soft top-left light. The PNG app icons
// (lib/brand-icon.js) mirror this design.
export default function Logo({ size = 36, className = "" }) {
  const id = useId();
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
        <linearGradient id={`${id}-fill`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="45%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <radialGradient id={`${id}-light`} cx="0.22" cy="0.18" r="0.55">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill={`url(#${id}-fill)`} />
      <rect width="64" height="64" rx="17" fill={`url(#${id}-light)`} />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="16.25" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="1.5" />
      <text
        x="32"
        y="42.5"
        textAnchor="middle"
        fontFamily="var(--font-geist-sans), Arial, sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="-1.2"
        fill="#fff"
        style={{ filter: "drop-shadow(0 1px 2px rgb(30 10 80 / 0.4))" }}
      >
        PS
      </text>
    </svg>
  );
}
