import StatusBadge from "../components/StatusBadge";

const FEATURES = [
  {
    title: "Every application, one place",
    text: "Company, role, posting, date and notes. No more spreadsheets or scattered bookmarks.",
    icon: "M4 6h16M4 12h16M4 18h10"
  },
  {
    title: "See your pipeline at a glance",
    text: "Track each role from application to offer and find out where your search stands right now.",
    icon: "M4 18V10M10 18V6M16 18v-4M22 18H2"
  },
  {
    title: "Private and secure",
    text: "Your data stays behind your account and is protected with the best security practices.",
    icon: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"
  }
];

const PREVIEW = [
  { company: "Northwind", position: "Frontend Engineer", status: "Interview", date: "Oct 12" },
  { company: "Globex", position: "Full-stack Developer", status: "Applied", date: "Oct 9" },
  { company: "Initech", position: "Software Engineer II", status: "Offer", date: "Sep 28" },
  { company: "Umbrella", position: "React Developer", status: "Rejected", date: "Sep 20" }
];

function Landing({ authenticated }) {
  const ctaHref = authenticated ? "#/applications" : "#/signup";

  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>
            Keep track of <i>every</i> application <span className="gradient-text">until you get the offer.</span>
          </h1>
          <p className="lede">
            <b>Job Tracker</b> is a workspace for logging applications, following up
            on interviews and seeing how your search is going.
          </p>
          <div className="hero-actions">
            <a href={ctaHref} className="btn btn-primary btn-lg">
              {authenticated ? "Go to my applications" : "Get started"}
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M4 10h12m-5-5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            {!authenticated && (
              <a href="#/login" className="btn btn-ghost btn-lg">I already have an account</a>
            )}
          </div>
        </div>

        <div className="hero-preview" aria-hidden="true">
          <div className="preview-window">
            <div className="preview-bar">
              <span /><span /><span />
            </div>
            <div className="preview-stats">
              <div><strong>24</strong><small>Total</small></div>
              <div><strong>6</strong><small>Interviews</small></div>
              <div><strong>2</strong><small>Offers</small></div>
            </div>
            <ul className="preview-list">
              {PREVIEW.map((item) => (
                <li key={item.company}>
                  <span className="avatar">{item.company[0]}</span>
                  <span className="preview-text">
                    <strong>{item.company}</strong>
                    <small>{item.position}</small>
                  </span>
                  <StatusBadge status={item.status} />
                  <small className="preview-date">{item.date}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="features">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="feature-card">
            <span className="feature-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d={feature.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </section>

      <section className="cta-band">
        <h2>Ready to take control of your search?</h2>
        <p>
          {authenticated ? "Start tracking your applications." : "Create a free account in seconds and log your first application."}
        </p>
        <a href={ctaHref} className="btn btn-light btn-lg">
          {authenticated ? "Open applications" : "Sign up"}
        </a>
      </section>
    </main>
  );
}

export default Landing;
