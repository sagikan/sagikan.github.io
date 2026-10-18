const nodemailer = require("nodemailer");

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
      }
    });
  }

  return transporter;
}

const TEMPLATES = {
  verify: {
    subject: (code) => `${code} is your Job Tracker verification code`,
    heading: "Verify your email",
    intro: "Enter this code in Job Tracker to finish creating your account.",
    ignore: "If you didn't create an account, you can ignore this email."
  },
  reset: {
    subject: (code) => `${code} is your Job Tracker password reset code`,
    heading: "Reset your password",
    intro: "Enter this code in Job Tracker to choose a new password.",
    ignore: "If you didn't ask to reset your password, you can ignore this email. Your password won't change."
  }
};

async function sendCodeEmail(to, code, kind) {
  const template = TEMPLATES[kind];
  const transport = getTransporter();

  if (!transport) {
    if (isProduction) {
      throw new Error("SMTP is not configured.");
    }

    console.log(`[mailer] ${kind} code for ${to}: ${code}`);
    return;
  }

  await transport.sendMail({
    from: process.env.MAIL_FROM || `Job Tracker <${process.env.SMTP_USER}>`,
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
  });
}

module.exports = { sendCodeEmail };
