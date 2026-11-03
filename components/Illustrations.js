// Hand-drawn style illustrations (SVG, so they're crisp on every screen and tiny to load).
// One warm palette shared with the logo: coral, pink, violet, sky, mint.
const C = {
  coral: "#ff9a5a",
  pink: "#f0457f",
  violet: "#6a5cf0",
  sky: "#5ab8ff",
  mint: "#3fd2a6",
  sun: "#ffd166",
};

function Defs({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-sunset`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffb07a" />
        <stop offset="1" stopColor="#f0457f" />
      </linearGradient>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8fd3ff" />
        <stop offset="1" stopColor="#5a8cff" />
      </linearGradient>
      <linearGradient id={`${id}-dusk`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#9b8cff" />
        <stop offset="1" stopColor="#f0457f" />
      </linearGradient>
      <linearGradient id={`${id}-sea`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4fc3f7" />
        <stop offset="1" stopColor="#2d6cdf" />
      </linearGradient>
    </defs>
  );
}

// A little photo: white frame, a scene inside.
function PhotoCard({ x, y, w, h, rotate = 0, scene, id, className = "" }) {
  const pad = w * 0.06;
  const iw = w - pad * 2;
  const ih = h - pad * 2 - h * 0.1;
  return (
    <g className={className}>
    <g transform={`translate(${x} ${y}) rotate(${rotate} ${w / 2} ${h / 2})`}>
      <rect x="2" y="6" width={w} height={h} rx={w * 0.06} fill="#000" opacity="0.12" />
      <rect width={w} height={h} rx={w * 0.06} fill="#fff" />
      <svg x={pad} y={pad} width={iw} height={ih} viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="80" rx="3" fill={`url(#${id}-${scene === "beach" ? "sunset" : scene === "lake" ? "sky" : "dusk"})`} />
        {scene === "beach" && (
          <>
            <circle cx="50" cy="44" r="14" fill={C.sun} opacity="0.95" />
            <rect y="50" width="100" height="30" fill={`url(#${id}-sea)`} />
            <path d="M0 58 Q 12 54 25 58 T 50 58 T 75 58 T 100 58 V80 H0Z" fill="#fff" opacity="0.18" />
            <path d="M0 70 Q 30 60 100 72 V80 H0Z" fill="#ffe1b0" />
            <path d="M78 70 C 76 58 80 48 86 42" stroke="#5b3a29" strokeWidth="2" fill="none" />
            <path d="M86 42 c -8 -2 -12 2 -14 5 M86 42 c 2 -7 8 -9 12 -8 M86 42 c 6 -1 10 3 11 7" stroke="#2f9e6e" strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        )}
        {scene === "lake" && (
          <>
            <circle cx="74" cy="20" r="8" fill="#fff" opacity="0.9" />
            <path d="M0 58 L22 30 L36 46 L55 22 L80 52 L100 40 V80 H0Z" fill="#3d5afe" opacity="0.55" />
            <path d="M0 62 L18 44 L32 56 L48 40 L70 60 L100 50 V80 H0Z" fill="#2b3fb8" opacity="0.7" />
            <rect y="62" width="100" height="18" fill="#7fd0ff" opacity="0.6" />
          </>
        )}
        {scene === "peaks" && (
          <>
            <circle cx="70" cy="24" r="10" fill={C.sun} />
            <path d="M-2 80 L28 34 L44 54 L62 30 L102 80Z" fill="#fff" opacity="0.9" />
            <path d="M28 34 L22 43 L28 41 L33 46Z M62 30 L56 40 L62 38 L68 42Z" fill="#c9c3ff" />
          </>
        )}
      </svg>
    </g>
    </g>
  );
}

function Pin({ x, y, s = 1, color = C.pink, className = "" }) {
  return (
    <g className={className}>
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <ellipse cx="12" cy="33" rx="7" ry="2.5" fill="#000" opacity="0.15" />
        <path d="M12 0 C 5 0 0 5.3 0 12 c 0 8.5 12 20 12 20 s 12 -11.5 12 -20 C 24 5.3 19 0 12 0Z" fill={color} />
        <circle cx="12" cy="12" r="4.5" fill="#fff" />
      </g>
    </g>
  );
}

function Sparkle({ x, y, s = 1, color = C.sun }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M6 0 L7.4 4.6 L12 6 L7.4 7.4 L6 12 L4.6 7.4 L0 6 L4.6 4.6Z" fill={color} />;
}

/** Login / welcome: a fan of holiday photos with a map pin and a heart. */
export function LoginHero({ className = "" }) {
  const id = "hero";
  return (
    <svg viewBox="0 0 320 230" className={className} aria-hidden="true">
      <Defs id={id} />
      <ellipse cx="160" cy="128" rx="140" ry="92" fill={C.violet} opacity="0.08" />
      <circle cx="58" cy="52" r="26" fill={C.coral} opacity="0.12" />
      <circle cx="270" cy="170" r="30" fill={C.sky} opacity="0.12" />
      <PhotoCard id={id} x={42} y={58} w={112} h={124} rotate={-13} scene="lake" className="float-a" />
      <PhotoCard id={id} x={168} y={52} w={112} h={124} rotate={11} scene="beach" className="float-b" />
      <PhotoCard id={id} x={98} y={40} w={124} h={140} rotate={-1} scene="peaks" />
      <Pin x={238} y={20} s={1.15} className="float-b" />
      <g className="float-a">
        <circle cx="62" cy="40" r="15" fill="#fff" />
        <path d="M62 48 l -6.2 -6 a 3.9 3.9 0 0 1 5.6 -5.5 l 0.6 0.6 l 0.6 -0.6 a 3.9 3.9 0 0 1 5.6 5.5Z" fill={C.pink} />
      </g>
      <Sparkle x={28} y={150} s={1.2} />
      <Sparkle x={290} y={96} s={0.9} color={C.mint} />
      <Sparkle x={150} y={10} s={0.8} color={C.coral} />
    </svg>
  );
}

/** No photos yet: an open box of photos with an upload arrow. */
export function EmptyPhotosArt({ className = "" }) {
  const id = "empty";
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden="true">
      <Defs id={id} />
      <ellipse cx="120" cy="100" rx="104" ry="64" fill={C.violet} opacity="0.08" />
      <PhotoCard id={id} x={48} y={40} w={78} h={88} rotate={-12} scene="beach" />
      <PhotoCard id={id} x={112} y={34} w={78} h={88} rotate={9} scene="lake" />
      <g transform="translate(150 98)">
        <circle r="24" fill={C.violet} />
        <path d="M0 10 V-9 M-8 -1 L0 -9 L8 -1" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
      <Sparkle x={30} y={30} s={1} />
      <Sparkle x={205} y={34} s={0.8} color={C.mint} />
    </svg>
  );
}

/** Map with no located photos: a folded map with pins. */
export function EmptyMapArt({ className = "" }) {
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden="true">
      <ellipse cx="120" cy="100" rx="104" ry="62" fill={C.sky} opacity="0.1" />
      <g transform="translate(40 40)">
        <path d="M0 14 L52 0 L108 14 L160 0 V92 L108 106 L52 92 L0 106Z" fill="#fff" stroke="#e3e5ef" strokeWidth="1.5" />
        <path d="M52 0 V92 M108 14 V106" stroke="#e3e5ef" strokeWidth="1.5" />
        <path d="M0 14 L52 0 V92 L0 106Z" fill="#e9f6ff" />
        <path d="M108 14 L160 0 V92 L108 106Z" fill="#eefbf5" />
        <path d="M10 76 C 40 50 70 86 96 58 S 140 40 152 30" stroke={C.violet} strokeWidth="3" strokeDasharray="6 6" fill="none" strokeLinecap="round" />
      </g>
      <Pin x={60} y={86} s={1} color={C.coral} />
      <Pin x={168} y={44} s={1.25} color={C.pink} />
      <Sparkle x={206} y={120} s={0.9} />
    </svg>
  );
}

/** No trips yet: a suitcase with travel stickers. */
export function EmptyTripsArt({ className = "" }) {
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden="true">
      <ellipse cx="120" cy="104" rx="100" ry="58" fill={C.coral} opacity="0.1" />
      <rect x="98" y="30" width="44" height="22" rx="8" fill="none" stroke="#7b6f9e" strokeWidth="6" />
      <rect x="66" y="46" width="108" height="92" rx="16" fill={C.violet} />
      <path d="M92 46 V138 M148 46 V138" stroke="#fff" strokeOpacity="0.25" strokeWidth="8" />
      <circle cx="104" cy="96" r="14" fill={C.sun} />
      <rect x="128" y="104" width="30" height="18" rx="4" fill={C.mint} transform="rotate(-12 143 113)" />
      <circle cx="84" cy="122" r="7" fill={C.pink} />
      <circle cx="82" cy="146" r="6" fill="#4b4370" />
      <circle cx="158" cy="146" r="6" fill="#4b4370" />
      <Pin x={176} y={28} s={1} color={C.pink} />
      <Sparkle x={40} y={58} s={1} />
    </svg>
  );
}

/** Free up space: a phone with a sparkle and a big tick. */
export function FreeUpSpaceArt({ className = "" }) {
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden="true">
      <ellipse cx="120" cy="100" rx="100" ry="60" fill={C.mint} opacity="0.12" />
      <rect x="86" y="22" width="68" height="130" rx="14" fill="#2b2b3a" />
      <rect x="92" y="34" width="56" height="106" rx="6" fill="#fff" />
      <g opacity="0.35">
        <rect x="98" y="42" width="20" height="20" rx="3" fill={C.coral} />
        <rect x="122" y="42" width="20" height="20" rx="3" fill={C.sky} />
        <rect x="98" y="66" width="20" height="20" rx="3" fill={C.violet} />
      </g>
      <circle cx="120" cy="104" r="22" fill={C.mint} />
      <path d="M109 104 l7 7 l14 -15" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={160} y={36} s={1.3} />
      <Sparkle x={62} y={96} s={0.9} color={C.pink} />
    </svg>
  );
}

/** Phone → studio PC: photos flying across. */
export function PhoneSyncArt({ className = "" }) {
  return (
    <svg viewBox="0 0 240 150" className={className} aria-hidden="true">
      <ellipse cx="120" cy="88" rx="108" ry="54" fill={C.violet} opacity="0.08" />
      <rect x="22" y="34" width="50" height="92" rx="10" fill="#2b2b3a" />
      <rect x="27" y="43" width="40" height="72" rx="4" fill="#fff" />
      <rect x="32" y="50" width="30" height="24" rx="3" fill={C.coral} />
      <rect x="32" y="78" width="14" height="14" rx="2" fill={C.sky} />
      <rect x="48" y="78" width="14" height="14" rx="2" fill={C.violet} />
      <rect x="150" y="38" width="72" height="54" rx="6" fill="#2b2b3a" />
      <rect x="155" y="43" width="62" height="40" rx="3" fill="#fff" />
      <path d="M160 79 L176 60 L186 70 L196 58 L212 79Z" fill={C.violet} opacity="0.75" />
      <circle cx="205" cy="52" r="4" fill={C.sun} />
      <rect x="176" y="92" width="20" height="10" fill="#2b2b3a" />
      <rect x="164" y="102" width="44" height="6" rx="3" fill="#2b2b3a" />
      <path d="M78 70 C 104 40 128 40 146 58" stroke={C.pink} strokeWidth="3" strokeDasharray="5 6" fill="none" strokeLinecap="round" />
      <path d="M140 50 l7 8 l-10 2" stroke={C.pink} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="98" y="38" width="20" height="16" rx="3" fill="#fff" stroke={C.coral} strokeWidth="2" transform="rotate(-10 108 46)" />
      <Sparkle x={118} y={86} s={0.9} />
    </svg>
  );
}
