const nodemailer = require("nodemailer");
const dev = require("./devMode");

const isProduction = process.env.NODE_ENV === "production";
let transporter;
const TEMPLATES = {
  verify: {
    subject: (code) => `${code} is your Applicant Zero verification code`,
    heading: "Verify your email",
    intro: "Enter this code in Applicant Zero to finish creating your account.",
    ignore: "If you didn't create an account, you can ignore this email."
  },
  reset: {
    subject: (code) => `${code} is your Applicant Zero password reset code`,
    heading: "Reset your password",
    intro: "Enter this code in Applicant Zero to choose a new password.",
    ignore: "If you didn't ask to reset your password, you can ignore this email. Your password won't change."
  }
};
const NOTICES = {
  password_reset: {
    subject: "Your Applicant Zero password was reset",
    heading: "Your password was reset",
    intro: "The password for your Applicant Zero account was just reset, and every device was signed out.",
    act: "If this wasn't you, secure your email account, then reset your Applicant Zero password again. Your authenticator app still protects your account."
  },
  mfa_reset: {
    subject: "Your Applicant Zero authenticator was replaced",
    heading: "Your authenticator was replaced",
    intro: "A new authenticator app was set up for your Applicant Zero account, new recovery codes were made, and every other device was signed out.",
    act: "If this wasn't you, we urge you to reply to this email right away. Someone had your password and a sign-in code, and the new authenticator is theirs, so resetting your password alone won't get you back in."
  },
  recovery_codes: {
    subject: "New Applicant Zero recovery codes were created",
    heading: "New recovery codes were created",
    intro: "New recovery codes were made for your Applicant Zero account. The old ones no longer work.",
    act: "If this wasn't you, we urge you to reset your password right away."
  },
  account_deleted: {
    subject: "Your Applicant Zero account was deleted",
    heading: "Your account was deleted",
    intro: "Your Applicant Zero account and all of its data were deleted.",
    act: "If this wasn't you, we urge you to reply to this email right away."
  }
};

function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    });
  }

  return transporter;
}

function parseSender(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value || "");
  return match
    ? { name: match[1] || "Applicant Zero", email: match[2].trim() }
    : { name: "Applicant Zero", email: String(value || "").trim() };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

async function sendWithBrevo(message) {
  const sender = parseSender(process.env.MAIL_FROM);

  if (!sender.email) {
    throw new Error("MAIL_FROM must be set to a sender verified in Brevo.");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      sender,
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html
    }),
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Brevo responded ${response.status}: ${detail}`);
  }
}

async function deliver(message, logLine) {
  if (dev.offline) {
    console.log(`[mailer] ${logLine} (not emailed in development)`);
    return;
  }

  if (process.env.BREVO_API_KEY) {
    return sendWithBrevo(message);
  }

  const transport = getTransporter();

  if (!transport) {
    if (isProduction) {
      throw new Error("No email provider configured (set BREVO_API_KEY, or SMTP_USER and SMTP_PASS).");
    }

    console.log(`[mailer] ${logLine}`);
    return;
  }

  await transport.sendMail({
    ...message,
    from: process.env.MAIL_FROM || `Applicant Zero <${process.env.SMTP_USER}>`
  });
}

async function sendCodeEmail(to, code, kind) {
  const template = TEMPLATES[kind];
  const message = {
    to,
    subject: template.subject(code),
    text:
      `${template.intro}\n\nYour code is ${code}.\n\n` +
      `It expires in 15 minutes. ${template.ignore}`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:auto;padding:24px;color:#121826">
        <h2 style="margin:0 0 12px">${template.heading}</h2>
        <p style="margin:0 0 20px;color:#5b6477">${template.intro}</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px;text-align:center;background:#eef0ff;border-radius:12px;color:#4f46e5">${code}</div>
        <p style="margin:20px 0 0;font-size:13px;color:#5b6477">The code expires in 15 minutes. ${template.ignore}</p>
      </div>`
  };

  await deliver(message, `${kind} code for ${to}: ${code}`);
}

async function sendSecurityNotice(to, kind) {
  const notice = NOTICES[kind];
  const when = new Date().toUTCString();
  const site = process.env.FRONTEND_ORIGIN || "";
  const siteLine = kind === "account_deleted" || !site ? "" : `\n\n${site}`;

  await deliver({
    to,
    subject: notice.subject,
    text: `${notice.intro}\n\nWhen: ${when}\n\n${notice.act}${siteLine}\n\nIf it was you, there's nothing to do.`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:auto;padding:24px;color:#121826">
        <h2 style="margin:0 0 12px">${notice.heading}</h2>
        <p style="margin:0 0 12px;color:#5b6477">${notice.intro}</p>
        <p style="margin:0 0 20px;color:#5b6477">When: ${escapeHtml(when)}</p>
        <p style="margin:0 0 12px;font-weight:600">${notice.act}</p>
        ${siteLine ? `<p style="margin:0 0 12px"><a href="${escapeHtml(site)}" style="color:#4f46e5">Open Applicant Zero</a></p>` : ""}
        <p style="margin:20px 0 0;font-size:13px;color:#5b6477">If it was you, there's nothing to do.</p>
      </div>`
  }, `${kind} notice for ${to}`);
}

module.exports = { sendCodeEmail, sendSecurityNotice };
