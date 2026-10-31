const API_LABELS = {
  checking: "Connecting…",
  online: "API online",
  offline: "API offline"
};

// Page footer with the server status, the copyright and a link: the privacy policy, or the logo credit when showCredit is set
function Footer({ apiStatus, showCredit = false }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className={`api-pill api-${apiStatus}`} title={API_LABELS[apiStatus]}>
          <span className="api-dot" aria-hidden="true" />
        </div>
        <span className="footer-copy">© {new Date().getFullYear()} Applicant Zero</span>
        <nav className="footer-links" aria-label="Footer">
          {showCredit ? (
            <a href="https://logo.dev" target="_blank" rel="noopener noreferrer">
              <span className="footer-credit-prefix">Logos provided by</span>{" "}Logo.dev
            </a>
          ) : (
            <a href="#/privacy">Privacy</a>
          )}
        </nav>
      </div>
    </footer>
  );
}

export default Footer;
