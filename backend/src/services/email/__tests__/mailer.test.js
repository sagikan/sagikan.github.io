import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer");
const { sendCodeEmail, sendSecurityNotice } = require("../mailer");

// Reads the JSON body of a fetch call
function sentBody(fetchMock, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

// Builds a successful Brevo response
function accepted() {
  return new Response("{}", { status: 201 });
}

describe("sendCodeEmail", () => {
  beforeEach(() => {
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
    vi.stubEnv("MAIL_FROM", "Acme Jobs <no-reply@acme.com>");
  });

  it("sends the code through Brevo with the key and the parsed sender", async () => {
    const fetchMock = mockFetch(accepted);

    await sendCodeEmail("dana@example.com", "123456", "verify");

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options.headers["api-key"]).toBe("brevo-key");
    expect(sentBody(fetchMock)).toMatchObject({
      sender: { name: "Acme Jobs", email: "no-reply@acme.com" },
      to: [{ email: "dana@example.com" }],
      subject: "123456 is your Applicant Zero verification code"
    });
    expect(sentBody(fetchMock).textContent).toContain("Your code is 123456.");
  });

  it("uses a different message for a password reset", async () => {
    const fetchMock = mockFetch(accepted);

    await sendCodeEmail("dana@example.com", "654321", "reset");

    expect(sentBody(fetchMock).subject).toBe("654321 is your Applicant Zero password reset code");
  });

  it("names the sender Applicant Zero when MAIL_FROM is only an address", async () => {
    vi.stubEnv("MAIL_FROM", "no-reply@acme.com");
    const fetchMock = mockFetch(accepted);

    await sendCodeEmail("dana@example.com", "123456", "verify");

    expect(sentBody(fetchMock).sender).toEqual({ name: "Applicant Zero", email: "no-reply@acme.com" });
  });

  it("throws when no sender is set", async () => {
    vi.stubEnv("MAIL_FROM", "");
    const fetchMock = mockFetch(accepted);

    await expect(sendCodeEmail("dana@example.com", "123456", "verify")).rejects.toThrow("MAIL_FROM must be set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with Brevo's status and message when it refuses the email", async () => {
    mockFetch(() => new Response("bad sender", { status: 400 }));

    await expect(sendCodeEmail("dana@example.com", "123456", "verify")).rejects.toThrow("Brevo responded 400: bad sender");
  });
});

describe("sendSecurityNotice", () => {
  beforeEach(() => {
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
    vi.stubEnv("MAIL_FROM", "no-reply@acme.com");
    vi.stubEnv("FRONTEND_ORIGIN", "https://app.example.com");
  });

  it.each([
    ["password_reset", "Your Applicant Zero password was reset"],
    ["mfa_reset", "Your Applicant Zero authenticator was replaced"],
    ["recovery_codes", "New Applicant Zero recovery codes were created"],
    ["account_deleted", "Your Applicant Zero account was deleted"]
  ])("sends the %s notice", async (kind, subject) => {
    const fetchMock = mockFetch(accepted);

    await sendSecurityNotice("dana@example.com", kind);

    expect(sentBody(fetchMock)).toMatchObject({ to: [{ email: "dana@example.com" }], subject });
  });

  it("links to the app, except in the account deleted notice", async () => {
    const fetchMock = mockFetch(accepted);

    await sendSecurityNotice("dana@example.com", "mfa_reset");
    await sendSecurityNotice("dana@example.com", "account_deleted");

    expect(sentBody(fetchMock, 0).textContent).toContain("https://app.example.com");
    expect(sentBody(fetchMock, 1).textContent).not.toContain("https://app.example.com");
  });
});

describe("delivery without Brevo", () => {
  it("logs the code instead of sending in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = mockFetch(accepted);

    await sendCodeEmail("dana@example.com", "123456", "verify");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("verify code for dana@example.com: 123456"));
  });

  it("logs the code when no provider is set outside production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = mockFetch(accepted);

    await sendCodeEmail("dana@example.com", "123456", "verify");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it("sends through SMTP when SMTP is configured", async () => {
    vi.stubEnv("SMTP_USER", "mailer@acme.com");
    vi.stubEnv("SMTP_PASS", "secret");
    const sendMail = vi.fn().mockResolvedValue({});
    const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail });

    await sendCodeEmail("dana@example.com", "123456", "verify");

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "mailer@acme.com", pass: "secret" }
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "dana@example.com",
      from: "Applicant Zero <mailer@acme.com>"
    }));
  });
});
