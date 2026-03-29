export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Black F — blocky geometric */}
      <rect x="8" y="8" width="22" height="84" fill="#000000" />
      <rect x="8" y="8" width="50" height="18" fill="#000000" />
      <rect x="8" y="38" width="40" height="16" fill="#000000" />

      {/* Purple Up Arrow — large, overlapping */}
      <polygon
        points="68,10 48,42 58,42 58,92 78,92 78,42 88,42"
        fill="#A478E8"
      />
    </svg>
  );
}
