const STROKE = {
  fill: "none",
  stroke: "#fff",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
const ICONS = {
  login: (
    <>
      <path d="M17 8h4.5A2.5 2.5 0 0 1 24 10.5v11a2.5 2.5 0 0 1-2.5 2.5H17" {...STROKE} />
      <path d="M8 16h11M15 12l4 4-4 4" {...STROKE} />
    </>
  ),
  register: (
    <>
      <circle cx="12.5" cy="12" r="3.5" {...STROKE} />
      <path d="M6.5 24a6 6 0 0 1 12 0" {...STROKE} />
      <path d="M22.5 11v6M19.5 14h6" {...STROKE} />
    </>
  ),
  verify_email: (
    <>
      <rect x="7" y="10" width="18" height="13" rx="2.5" {...STROKE} />
      <path d="M8 11.5l8 6 8-6" {...STROKE} />
    </>
  ),
  mfa_setup: (
    <>
      <rect x="10.5" y="6.5" width="11" height="19" rx="2.5" {...STROKE} />
      <path d="M14.5 9.5h3" {...STROKE} />
      <path d="M13.2 16.3l2 2 3.6-4" {...STROKE} />
    </>
  ),
  mfa: (
    <>
      <path d="M16 7l7 2.8v5.4c0 4.3-3 7.9-7 8.8-4-.9-7-4.5-7-8.8V9.8L16 7z" {...STROKE} />
      <path d="M12.8 15.6l2.2 2.2 4.2-4.6" {...STROKE} />
    </>
  ),
  recovery: (
    <>
      <circle cx="12" cy="16" r="4" {...STROKE} />
      <path d="M16 16h9M22 16v3M25 16v2.5" {...STROKE} />
    </>
  ),
  forgot_password: (
    <>
      <rect x="9" y="14" width="14" height="10.5" rx="2.5" {...STROKE} />
      <path d="M12 14v-2.5a4 4 0 0 1 8 0V14" {...STROKE} />
      <path d="M14.6 17.6a1.5 1.5 0 1 1 2.1 1.4c-.5.25-.7.6-.7 1.1" {...STROKE} strokeWidth={1.7} />
      <circle cx="16" cy="22.3" r="0.95" fill="#fff" />
    </>
  ),
  reset_password: (
    <>
      <rect x="8.5" y="14" width="15" height="10.5" rx="2.5" {...STROKE} />
      <path d="M12 14v-2.5a4 4 0 0 1 8 0V14" {...STROKE} />
      <circle cx="12.6" cy="19.25" r="1.2" fill="#fff" />
      <circle cx="16" cy="19.25" r="1.2" fill="#fff" />
      <circle cx="19.4" cy="19.25" r="1.2" fill="#fff" />
    </>
  )
};

ICONS.recovery_codes = ICONS.recovery;

function StepIcon({ name, size = 40 }) {
  return (
    <svg
      key={name}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="logo step-icon"
    >
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      {ICONS[name] || ICONS.login}
    </svg>
  );
}

export default StepIcon;
