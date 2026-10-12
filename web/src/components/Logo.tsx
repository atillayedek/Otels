export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#0369a1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg)" />
      <path d="M18 46V20h6v10h16V20h6v26h-6V36H24v10z" fill="#fff" />
      <rect x="18" y="49" width="28" height="3" rx="1.5" fill="#bae6fd" />
    </svg>
  );
}
