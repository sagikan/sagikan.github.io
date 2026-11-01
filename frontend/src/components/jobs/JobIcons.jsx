const FILL_OPACITY = 0.4;

// Location pin outline
export function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      <path d="M10 17.5s5.5-4.9 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.6 10 17.5 10 17.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="10" cy="8.25" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

// Calendar outline, with optional content drawn behind it
export function CalendarIcon({ children }) {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      {children}
      <rect x="3.5" y="4.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 8.5h13M7 2.75v3.5M13 2.75v3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

// Arrow pointing out of a box
export function ExternalIcon() {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
      <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Calendar icon filled by thirds: the fresher the posting, the fuller it is
export function FreshnessCalendar({ level }) {
  const height = { fresh: 3, aging: 2, stale: 1 }[level] * 2.1;

  return (
    <CalendarIcon>
      <rect x="4.35" y={15.65 - height} width="11.3" height={height} rx="1.1" fill="currentColor" fillOpacity={FILL_OPACITY} />
    </CalendarIcon>
  );
}
