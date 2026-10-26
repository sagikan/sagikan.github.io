const Anthropic = require("@anthropic-ai/sdk");
const dev = require("../shared/devMode");

const DEFAULT_MODEL = "claude-sonnet-5-5";
const CHEAP_MODEL = "claude-haiku-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
let client;

// Error from a Claude call whose message can be shown to the user
class ClaudeError extends Error {}

// Checks whether Claude can be called
function isConfigured() {
  return dev.offline || Boolean(process.env.ANTHROPIC_API_KEY);
}

// Returns the shared Anthropic client, creating it on first use
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }

  return client;
}

// Returns the model set in the environment, or the fallback
function model(envName, fallbackModel = DEFAULT_MODEL) {
  return process.env[envName] || fallbackModel;
}

/* Streams the request (long calls would otherwise hit HTTP timeouts) and returns the final message.
   With fallback on, a request Claude declines on safety grounds is retried on a fallback model.
   Haiku doesn't support that, so its calls turn it off */
async function send(params, { timeoutMs = 5 * 60 * 1000, fallback = true } = {}) {
  // Safety net: callers use their stand-ins in development, so this should never be reached there
  if (dev.offline) {
    throw new ClaudeError("Claude calls are off in development. Set USE_REAL_APIS=true to allow them.");
  }

  const stream = fallback
    ? getClient().beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" }, { timeout: timeoutMs })
    : getClient().messages.stream(params, { timeout: timeoutMs });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new ClaudeError("The AI declined this request.");
  }

  return message;
}

// Parses the JSON answer from a Claude response
function readJson(message) {
  if (message.stop_reason === "max_tokens") {
    throw new ClaudeError("The AI response was cut off. Please try again.");
  }

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError("The AI returned an unreadable response. Please try again.");
  }
}

// Builds the output format for a JSON schema response
function jsonFormat(schema) {
  return { format: { type: "json_schema", schema } };
}

module.exports = { ClaudeError, CHEAP_MODEL, isConfigured, model, send, readJson, jsonFormat };
