function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <rect x="8" y="11" width="16" height="12" rx="2.5" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M13 11V9.5A1.5 1.5 0 0 1 14.5 8h3A1.5 1.5 0 0 1 19 9.5V11" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M12.5 17l2.5 2.5 4.5-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default Logo;
