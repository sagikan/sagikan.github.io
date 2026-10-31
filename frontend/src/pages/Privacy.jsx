import { policyDate } from "../utils/policy/policy";

const OPERATOR = "sagikan";
const CONTACT_EMAIL = "sagikan5@gmail.com";

const DATA_ROWS = [
  [
    "Account",
    "Your email address, your password (never kept in readable form), your two-factor authentication details, records of sign-ins and security events, and which version of this policy you have seen.",
    "You"
  ],
  [
    "Applications",
    "The company, position, location, work model, status, dates, job link and notes of each application you track.",
    "You, or an email update you accept"
  ],
  [
    "Resume profile",
    "Details from the resume you upload, such as your name, contact details, work history, education and skills, and your job preferences. If you upload a grade sheet, we keep that file. We do not keep the resume file itself.",
    "You"
  ],
  [
    "Jobs and tailored resumes",
    "Jobs we find for you or you add, match scores, tailored resumes and a history of your job searches.",
    "You and our searches"
  ],
  [
    "Email sync (optional)",
    "See the section on email sync below.",
    "Your Gmail, through a script you set up"
  ],
  [
    "Company logos",
    "The names of companies in your applications and job lists, used to find their logos.",
    "Derived from your data"
  ],
  [
    "Technical data",
    "Your IP address and browser details, which our providers see, and error logs. Your browser also stores small display settings on your device.",
    "Your browser"
  ]
];

const SHARING_ROWS = [
  ["Render", "Hosts our server and database, so it holds the data in your account.", "Hosting"],
  ["GitHub", "Hosts the website files, and holds backups of our database.", "Hosting and backups"],
  ["Anthropic", "The text described in the section on AI below.", "AI features"],
  ["Brevo or an SMTP email provider", "Your email address and the text of our emails to you.", "Sending our emails"],
  ["JSearch (through RapidAPI)", "Search terms based on users' preferred roles and places. They contain no names or email addresses.", "Finding job listings"],
  ["Logo.dev", "Company names.", "Finding company logos"],
  ["Job sites", "We read public job listings, and may open the job links you save to check that they are still open.", "Job data"],
  ["Google", "Google Fonts loads the site's fonts in your browser, so Google sees your IP address and browser details. If you use email sync, the script runs in your own Google account.", "Fonts and email sync"]
];

const KEEP_ROWS = [
  ["Your account and what you added", "Until you delete it or your account."],
  ["Email sync records", "Until you disconnect email sync or delete your account."],
  ["Backups", "Up to 30 days. Data you delete can remain in a backup for that long. Backups are used only to recover from a disaster."],
  ["Logs at our providers", "As long as each provider's own policy says."]
];

// Renders a table from rows
function Table({ head, rows }) {
  return (
    <div className="legal-table-wrap">
      <table className="legal-table">
        <thead>
          <tr>
            {head.map((title) => <th key={title}>{title}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (index === 0 ? <th key={cell} scope="row">{cell}</th> : <td key={cell}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Privacy policy page
function Privacy() {
  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Privacy Policy</h1>
          <p className="muted">Last updated: {policyDate()}</p>
        </div>
      </div>

      <div className="legal">
        <div className="legal-summary">
          <strong>In short:</strong>
          <ul>
            <li>We keep what you enter, such as applications and your resume profile, to run the tracker. Other users cannot see it.</li>
            <li>Some features send text to an AI provider and to a few other services. They are all listed here.</li>
            <li>We do not sell your data, show ads or use tracking or analytics cookies.</li>
            <li>You can disconnect email sync or delete your account at any time, and your data is removed.</li>
          </ul>
        </div>

        <h2>1. Who we are</h2>
        <p>
          Applicant Zero helps you track job applications, find openings, tailor your resume and update your applications from your inbox.
          It is run by GitHub user <i>{OPERATOR}</i> (&ldquo;we&rdquo;). You can reach us at {CONTACT_EMAIL}.
          This policy explains what personal data the site handles, why, who receives it, how long we keep it and what rights you have.
        </p>

        <h2>2. The data we handle</h2>
        <Table head={["Kind", "What it includes", "Where it comes from"]} rows={DATA_ROWS} />

        <h2>3. Email sync</h2>
        <p>
          Email sync is optional and off until you set it up. You add a script to your own Google account with read-only access to your Gmail.
          It sends us emails that look job-related: the sender, subject, date and text. Our AI provider reads them to work out whether they concern one of your applications, for example an interview invitation or a rejection.
        </p>
        <p>
          We store the sender, the subject, a short preview and the result. <strong>This includes emails the AI decides are not about your applications.</strong> We do not store the full text.
          Emails contain other people&rsquo;s details, such as recruiters&rsquo; names, and we use them only to classify the email.
        </p>
        <p>
          By default we only suggest status changes and you confirm them. If you turn on automatic updates, changes are applied for you, and you can undo them.
          Disconnecting email sync deletes every stored email record.
        </p>

        <h2>4. How we use your data</h2>
        <ul>
          <li><strong>To provide the service:</strong> keep your account, applications, resume profile and jobs, and run the features you ask for.</li>
          <li><strong>To keep the site secure</strong> and prevent abuse.</li>
          <li><strong>To email you about your account,</strong> such as verification codes and security notices. We send no marketing.</li>
          <li><strong>To meet legal duties</strong> and respond to lawful requests.</li>
        </ul>
        <p>
          Where the law requires a legal basis, we rely on the contract between you and us (providing the features you use), our legitimate interest in running a secure service and,
          for optional features such as email sync and uploading a resume, your consent, which you can withdraw at any time.
        </p>

        <h2>5. AI processing</h2>
        <p>
          We use Anthropic&rsquo;s Claude, as our service provider, to read your resume, tailor it to jobs, score jobs against it, classify emails if you use email sync,
          match company logos and find job boards. We send it only what each task needs, which can include your resume, job descriptions, the emails described above and company and job details.
        </p>
        <p>
          We do not use your data to train AI models. For how Anthropic itself handles the data it receives, including how long it keeps it, see Anthropic&rsquo;s own terms and privacy policy.
          AI results, such as match scores, tailored resumes and email classifications, are suggestions and can be wrong, so please check them. No decision with legal effect on you is made automatically.
        </p>

        <h2>6. Who else receives data</h2>
        <p>We do not sell your data and we share it only with the services below, to the extent each needs it. Other users cannot see your data.</p>
        <Table head={["Provider", "What it receives or does", "Purpose"]} rows={SHARING_ROWS} />
        <p>We may also disclose data when the law requires it or to protect our users and the service.</p>

        <h2>7. Cookies</h2>
        <p>
          We use only the cookies that are strictly necessary to keep you signed in. We use no advertising or analytics cookies.
          The site also stores small display settings in your browser.
        </p>

        <h2>8. How long we keep data</h2>
        <Table head={["Data", "How long"]} rows={KEEP_ROWS} />
        <p>When you delete your account, your data is removed from our live systems straight away and we send you a confirmation email.</p>

        <h2>9. Your rights and choices</h2>
        <ul>
          <li><strong>Access and a copy:</strong> you can see your data in the app, export your applications as a file and download your resumes. For anything else, email us.</li>
          <li><strong>Correction:</strong> you can edit your data yourself.</li>
          <li><strong>Deletion:</strong> use &ldquo;Delete account&rdquo; on the Account page, or ask us. You can also delete individual items, or disconnect email sync, whenever you like.</li>
          <li><strong>Objection, restriction and withdrawing consent:</strong> email us. Withdrawing consent does not affect what we did before.</li>
          <li><strong>Complaints:</strong> you may complain to your data protection authority, for example the Privacy Protection Authority in Israel or your national authority in the European Union.</li>
        </ul>
        <p>We reply within 30 days. To protect your account, we may need to confirm that a request comes from you.</p>

        <h2>10. Security</h2>
        <p>
          We protect your data with technical and organisational measures that suit the risk. No system is perfectly secure.
          If a breach affects you, we will tell you and the authorities as the law requires.
        </p>

        <h2>11. Where data is processed</h2>
        <p>
          Our providers run data centres in several countries, which may include countries outside your own and outside the European Economic Area and Israel.
          We choose providers with contractual and technical safeguards for personal data.
        </p>

        <h2>12. Children</h2>
        <p>Applicant Zero is not meant for anyone under 16, and we do not knowingly collect their data. If you think a child has given us data, email us and we will delete it.</p>

        <h2>13. Changes to this policy</h2>
        <p>If we change this policy in a way that matters, we will update the date above and tell you in the app or by email before the change takes effect.</p>

        <h2>14. Contact</h2>
        <p>Questions or requests about your data: {CONTACT_EMAIL}.</p>
      </div>
    </main>
  );
}

export default Privacy;
