import { useCallback, useId, useRef, useState } from "react";
import { useDismiss } from "../../hooks/useDismiss";

const API_LABELS = {
  checking: "Connecting…",
  online: "API online",
  offline: "API offline"
};

/* Page footer with the server status, the copyright, the privacy policy and the credits.
   The credits stay in the page while closed, so their links can be found without opening them */
function Footer({ apiStatus }) {
  const ref = useRef(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, close, ref);

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className={`api-pill api-${apiStatus}`} title={API_LABELS[apiStatus]}>
          <span className="api-dot" aria-hidden="true" />
        </div>
        <span className="footer-copy">© {new Date().getFullYear()} Applicant Zero</span>
        <nav className="footer-links" aria-label="Footer">
          <a href="#/privacy">Privacy</a>
          <div className="footer-credits" ref={ref}>
            <button
              type="button"
              className="footer-credits-toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((current) => !current)}
            >
              Credits
            </button>
            <div id={panelId} className="footer-credits-panel" role="region" aria-label="Credits" hidden={!open}>
              <ul>
                <li>
                  Logos:{" "}
                  <a href="https://logo.dev" target="_blank" rel="noopener noreferrer">Logo.dev</a>
                </li>
                <li>
                  Company data:{" "}
                  <a href="https://github.com/mluggy/techmap" target="_blank" rel="noopener noreferrer">Israeli Tech Map</a>
                  {" "}by Michael Lugassy (
                  <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL</a>
                  )
                </li>
              </ul>
            </div>
          </div>
        </nav>
      </div>
    </footer>
  );
}

export default Footer;
