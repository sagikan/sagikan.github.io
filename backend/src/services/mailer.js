const nodemailer = require("nodemailer");
const dev = require("./devMode");

const isProduction = process.env.NODE_ENV === "production";
let transporter;

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

function parseSender(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value || "");
  return match
    ? { name: match[1] || "Applicant Zero", email: match[2].trim() }
    : { name: "Applicant Zero", email: String(value || "").trim() };
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

  if (dev.offline) {
    console.log(`[mailer] ${kind} code for ${to}: ${code} (not emailed in development)`);
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

    console.log(`[mailer] ${kind} code for ${to}: ${code}`);
    return;
  }

  await transport.sendMail({
    ...message,
    from: process.env.MAIL_FROM || `Applicant Zero <${process.env.SMTP_USER}>`
  });
}

module.exports = { sendCodeEmail };
