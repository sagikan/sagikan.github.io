import Logo from "./Logo";

function Navbar({ route, authenticated, email, apiStatus, onLogout }) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a href="#/" className={`brand ${route === "/" ? "active" : ""}`} aria-label="Job Tracker home">
          <Logo />
          <span>Job Tracker</span>
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
              <span className="nav-divider" aria-hidden="true" />
              <a
                href="#/account"
                className={`nav-link nav-email ${route === "/account" ? "active" : ""}`}
                title="Account settings"
              >
                {email || "Account"}
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
