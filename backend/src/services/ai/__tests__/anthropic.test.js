import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Anthropic = require("@anthropic-ai/sdk");
const claude = require("../anthropic");

const PARAMS = { model: "claude-sonnet-5-5", max_tokens: 100, messages: [{ role: "user", content: "Hi" }] };

// Stands in for the SDK's streaming calls, returning the given final message
function mockStreams(message) {
  const probe = new Anthropic({ apiKey: "probe" });
  const finalMessage = vi.fn().mockResolvedValue(message);
  const plain = vi.spyOn(Object.getPrototypeOf(probe.messages), "stream").mockReturnValue({ finalMessage });
  const beta = vi.spyOn(Object.getPrototypeOf(probe.beta.messages), "stream").mockReturnValue({ finalMessage });

  return { plain, beta };
}

// Builds a Claude response with text blocks
function textMessage(...texts) {
  return { stop_reason: "end_turn", content: texts.map((text) => ({ type: "text", text })) };
}

describe("ClaudeError", () => {
  it("is an error that can be told apart from others", () => {
    const error = new claude.ClaudeError("nope");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("nope");
    expect(error.constructor.name).toBe("ClaudeError");
  });
});

describe("isConfigured", () => {
  it("is true when an API key is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    expect(claude.isConfigured()).toBe(true);
  });

  it("is false without an API key", () => {
    expect(claude.isConfigured()).toBe(false);
  });

  it("is true in development, where stand-ins are used", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(claude.isConfigured()).toBe(true);
  });
});

describe("model", () => {
  it("returns the model set in the environment", () => {
    vi.stubEnv("TEST_MODEL", "custom-model");

    expect(claude.model("TEST_MODEL")).toBe("custom-model");
  });

  it("falls back to Sonnet by default", () => {
    expect(claude.model("TEST_MODEL")).toBe("claude-sonnet-5-5");
  });

  it("falls back to the given model", () => {
    expect(claude.model("TEST_MODEL", claude.CHEAP_MODEL)).toBe("claude-haiku-5-5");
  });
});

describe("send", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("streams with the safety fallback by default and returns the final message", async () => {
    const message = textMessage("done");
    const { plain, beta } = mockStreams(message);

    expect(await claude.send(PARAMS)).toBe(message);
    expect(beta).toHaveBeenCalledWith(
      { ...PARAMS, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
      { timeout: 5 * 60 * 1000 }
    );
    expect(plain).not.toHaveBeenCalled();
  });

  it("streams without the fallback when it's turned off, with the given timeout", async () => {
    const { plain, beta } = mockStreams(textMessage("done"));

    await claude.send(PARAMS, { fallback: false, timeoutMs: 1000 });

    expect(plain).toHaveBeenCalledWith(PARAMS, { timeout: 1000 });
    expect(beta).not.toHaveBeenCalled();
  });

  it("throws a readable error when Claude declines the request", async () => {
    mockStreams({ stop_reason: "refusal", content: [] });

    await expect(claude.send(PARAMS)).rejects.toThrow(claude.ClaudeError);
    await expect(claude.send(PARAMS)).rejects.toThrow("The AI declined this request.");
  });

  it("refuses to call Claude in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { plain, beta } = mockStreams(textMessage("done"));

    await expect(claude.send(PARAMS)).rejects.toThrow("Claude calls are off in development");
    expect(plain).not.toHaveBeenCalled();
    expect(beta).not.toHaveBeenCalled();
  });
});

describe("readJson", () => {
  it("parses the JSON in the text blocks, ignoring other blocks", () => {
    const message = { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "{\"a\":" }, { type: "text", text: "1}" }] };

    expect(claude.readJson(message)).toEqual({ a: 1 });
  });

  it("reports a response that was cut off", () => {
    expect(() => claude.readJson({ stop_reason: "max_tokens", content: [{ type: "text", text: "{\"a\":" }] })).toThrow("The AI response was cut off. Please try again.");
  });

  it.each([
    ["text that isn't JSON", textMessage("Sure, here you go")],
    ["no text", { stop_reason: "end_turn", content: [] }]
  ])("reports %s", (_title, message) => {
    expect(() => claude.readJson(message)).toThrow(claude.ClaudeError);
    expect(() => claude.readJson(message)).toThrow("The AI returned an unreadable response. Please try again.");
  });
});

describe("jsonFormat", () => {
  it("wraps a schema as a JSON schema output format", () => {
    expect(claude.jsonFormat({ type: "object" })).toEqual({ format: { type: "json_schema", schema: { type: "object" } } });
  });
});
