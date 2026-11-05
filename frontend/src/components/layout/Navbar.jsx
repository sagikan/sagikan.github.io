import Logo from "./Logo";

// Top navigation bar
function Navbar({ route, authenticated, email, onLogout }) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a href="#/" className={`brand ${route === "/" ? "active brand-open" : ""}`} aria-label="Applicant Zero home">
          <Logo />
          <span className="brand-name">
            <span className="brand-text">applicant<span className="brand-zero">zero</span></span>
          </span>
        </a>

        <nav className="navbar-links">
          {authenticated ? (
            <>
              <div className="nav-tabs">
                <a
                  href="#/applications"
                  className={`nav-link ${route === "/applications" ? "active" : ""}`}
                  title="Applications"
                  aria-label="Applications"
                >
                  <svg className="nav-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                    <rect x="4" y="3" width="12" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M7 8h6M7 11.5h6M7 15h3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  <span className="nav-link-text">Applications</span>
                </a>
                <a
                  href="#/jobs"
                  className={`nav-link ${route === "/jobs" ? "active" : ""}`}
                  title="Jobs"
                  aria-label="Jobs"
                >
                  <svg className="nav-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                    <rect x="2.8" y="6.5" width="14.4" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M7 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 5v1.5M2.8 11h14.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  <span className="nav-link-text">Jobs</span>
                </a>
              </div>
              <span className="nav-divider" aria-hidden="true" />
              <div className="nav-end">
                <a
                  href="#/account"
                  className={`nav-link nav-email ${route === "/account" ? "active" : ""}`}
                  title="Account settings"
                  aria-label="Account settings"
                >
                  <svg className="nav-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                    <circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M3.8 16.5c1.2-2.9 3.5-4.3 6.2-4.3s5 1.4 6.2 4.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  <span className="nav-email-text">{email || "Account"}</span>
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
                  Log out
                </button>
              </div>
            </>
          ) : (
            route !== "/login" && route !== "/signup" && (
              <a href="#/login" className="btn btn-primary btn-sm">
                Log in
              </a>
            )
          )}
        </nav>
      </div>
    </header>
  );
}

export default Navbar;
