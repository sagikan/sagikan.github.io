import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const { classifyEmail, isConfigured } = require("../emailClassifier");

const EMAIL = { from: "Acme Careers <jobs@acme.com>", subject: "Your application", body: "Thanks for applying." };

// Builds a response in which Claude recorded a classification
function recorded(input) {
  return () => jsonResponse({ content: [{ type: "tool_use", name: "record_email", input }] });
}

describe("isConfigured", () => {
  it("is true when an API key is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    expect(isConfigured()).toBe(true);
  });

  it("is false without an API key", () => {
    expect(isConfigured()).toBe(false);
  });

  it("is true in development, where stand-ins are used", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isConfigured()).toBe(true);
  });
});

describe("classifyEmail", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("sends the email to Claude with the key and a forced tool call", async () => {
    const fetchMock = mockFetch(recorded({ job_related: true, event: "interview", company: "Acme", position: "Engineer", confidence: 0.9 }));

    await classifyEmail(EMAIL);

    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers["x-api-key"]).toBe("test-key");
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_email" });
    expect(body.messages[0].content).toBe("<email>\nFrom: Acme Careers <jobs@acme.com>\nSubject: Your application\n\nThanks for applying.\n</email>");
  });

  it("uses the model set in the environment", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "custom-model");
    const fetchMock = mockFetch(recorded({ job_related: true, event: "offer", company: "", position: "", confidence: 1 }));

    await classifyEmail(EMAIL);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("custom-model");
  });

  it("returns what Claude recorded", async () => {
    mockFetch(recorded({ job_related: true, event: "rejection", company: " Acme ", position: " Backend Engineer ", confidence: 0.8 }));

    expect(await classifyEmail(EMAIL)).toEqual({
      jobRelated: true,
      event: "rejection",
      company: "Acme",
      position: "Backend Engineer",
      confidence: 0.8
    });
  });

  it("cleans up malformed values", async () => {
    mockFetch(recorded({ job_related: "yes", event: "celebration", company: 5, position: null, confidence: 7 }));

    expect(await classifyEmail(EMAIL)).toEqual({ jobRelated: false, event: "other", company: "", position: "", confidence: 1 });
  });

  it("limits the company to 200 characters and the position to 300", async () => {
    mockFetch(recorded({ job_related: true, event: "received", company: "c".repeat(500), position: "p".repeat(500), confidence: 0.5 }));
    const result = await classifyEmail(EMAIL);

    expect(result.company).toHaveLength(200);
    expect(result.position).toHaveLength(300);
  });

  it.each([
    ["a negative number", -2, 0],
    ["not a number", "high", 0],
    ["missing", undefined, 0]
  ])("treats a confidence that is %s as %d", async (_title, confidence, expected) => {
    mockFetch(recorded({ job_related: true, event: "received", company: "", position: "", confidence }));

    expect((await classifyEmail(EMAIL)).confidence).toBe(expected);
  });

  it("throws when the request fails", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));

    await expect(classifyEmail(EMAIL)).rejects.toThrow("Classifier request failed with status 429");
  });

  it("throws when Claude records nothing", async () => {
    mockFetch(() => jsonResponse({ content: [{ type: "text", text: "I can't help" }] }));

    await expect(classifyEmail(EMAIL)).rejects.toThrow("Classifier returned no result");
  });

  it("uses the local stand-in in development, without a request", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = mockFetch(recorded({}));
    const result = await classifyEmail({ from: "\"Acme Corp\" <jobs@acme.com>", subject: "Interview", body: "We'd like to schedule an interview" });

    expect(result).toMatchObject({ jobRelated: true, event: "interview", company: "Acme Corp" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
