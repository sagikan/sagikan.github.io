import Logo from "./Logo";

// Top navigation bar
function Navbar({ route, authenticated, email, onLogout }) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a href="#/" className={`brand ${route === "/" ? "active" : ""}`} aria-label="Applicant Zero home">
          <Logo />
          <span className="brand-name">applicant<span className="brand-zero">zero</span></span>
        </a>

        <nav className="navbar-links">
          {authenticated ? (
            <>
              <a
                href="#/applications"
                className={`nav-link ${route === "/applications" ? "active" : ""}`}
              >
                Applications
              </a>
              <a
                href="#/jobs"
                className={`nav-link ${route === "/jobs" ? "active" : ""}`}
              >
                Jobs
              </a>
              <span className="nav-divider" aria-hidden="true" />
              <a
                href="#/account"
                className={`nav-link nav-email ${route === "/account" ? "active" : ""}`}
                title="Account settings"
                aria-label="Account settings"
              >
                <svg className="nav-account-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                  <circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M3.8 16.5c1.2-2.9 3.5-4.3 6.2-4.3s5 1.4 6.2 4.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                <span className="nav-email-text">{email || "Account"}</span>
              </a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
                Log out
              </button>
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
