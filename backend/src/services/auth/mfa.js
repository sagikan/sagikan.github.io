const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

// Reads the 32-byte encryption key from the environment
function getKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY || "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (64 hex characters).");
  }

  return key;
}

// Encodes bytes as base32
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

// Decodes a base32 string into bytes
function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);

    if (index === -1) {
      throw new Error("Invalid base32 character.");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

// Computes the HOTP code for a counter
function hotp(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = crypto.createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;

  return String(code).padStart(TOTP_DIGITS, "0");
}

// Compares two strings in constant time
function safeEqual(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}

// Generates a new TOTP secret
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// Builds the otpauth link for authenticator apps
function totpUri(secret, email, issuer = "Applicant Zero") {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = {
    secret,
    issuer,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS
  };
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `otpauth://totp/${label}?${query}`;
}

// Checks a TOTP code and returns its time step, or null
function verifyTotp(secret, token, lastStep) {
  const code = String(token || "").replace(/\s/g, "");

  if (!/^\d{6}$/.test(code)) {
    return null;
  }

  const key = base32Decode(secret);
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);

  for (let step = currentStep - TOTP_WINDOW; step <= currentStep + TOTP_WINDOW; step++) {
    if (lastStep != null && step <= Number(lastStep)) {
      continue;
    }

    if (safeEqual(hotp(key, step), code)) {
      return step;
    }
  }

  return null;
}

// Encrypts a secret with AES-256-GCM
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

// Decrypts a secret stored by encryptSecret
function decryptSecret(stored) {
  const [iv, tag, ciphertext] = stored.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Hashes a code with the encryption key
function hashCode(code) {
  return crypto.createHmac("sha256", getKey()).update(code).digest("hex");
}

// Generates a 6-digit email code
function generateEmailCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// Uppercases a recovery code and removes invalid characters
function normalizeRecoveryCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
}

// Generates a set of recovery codes
function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const code = base32Encode(crypto.randomBytes(7)).slice(0, 10);

    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

module.exports = {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  hashCode,
  safeEqual,
  generateEmailCode,
  generateRecoveryCodes,
  normalizeRecoveryCode
};
