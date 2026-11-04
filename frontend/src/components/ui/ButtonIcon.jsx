const ICON_PATHS = {
  plus: "M10 4v12M4 10h12",
  check: "M4.5 10.5l3.5 3.5 7.5-8"
};

// Small icon for the start of a button ("plus" or "check"), which a spinner replaces while busy
function ButtonIcon({ name, busy = false }) {
  if (busy) {
    return <span className="spinner spinner-sm" aria-hidden="true" />;
  }

  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      <path d={ICON_PATHS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default ButtonIcon;
