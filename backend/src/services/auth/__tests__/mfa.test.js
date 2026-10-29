import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  decryptSecret,
  encryptSecret,
  generateEmailCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashCode,
  normalizeRecoveryCode,
  safeEqual,
  totpUri,
  verifyTotp
} = require("../mfa");

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("generateTotpSecret", () => {
  it("returns a 32-character base32 secret", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("returns a different secret each time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("totpUri", () => {
  it("builds the link authenticator apps read", () => {
    expect(totpUri("ABC234", "dana.levi@example.com")).toBe(
      "otpauth://totp/Applicant%20Zero:dana.levi%40example.com?secret=ABC234&issuer=Applicant%20Zero&algorithm=SHA1&digits=6&period=30"
    );
  });

  it("uses the given issuer", () => {
    expect(totpUri("ABC234", "a@b.co", "Acme")).toContain("otpauth://totp/Acme:a%40b.co?");
  });
});

describe("verifyTotp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Sets the clock to a number of seconds since 1970
  function atSecond(seconds) {
    vi.useFakeTimers();
    vi.setSystemTime(seconds * 1000);
  }

  it.each([
    [59, "287082", 1],
    [1111111109, "081804", 37037036],
    [1234567890, "005924", 41152263]
  ])("accepts the RFC 6238 code at second %i and returns its time step", (seconds, code, step) => {
    atSecond(seconds);

    expect(verifyTotp(RFC_SECRET, code)).toBe(step);
  });

  it("ignores spaces and non-string input types", () => {
    atSecond(59);

    expect(verifyTotp(RFC_SECRET, "287 082")).toBe(1);
    expect(verifyTotp(RFC_SECRET, 287082)).toBe(1);
  });

  it("accepts the previous code of the adjacent 30-second step", () => {
    atSecond(89);

    expect(verifyTotp(RFC_SECRET, "287082")).toBe(1);
  });

  it("rejects a wrong code", () => {
    atSecond(59);

    expect(verifyTotp(RFC_SECRET, "000000")).toBeNull();
  });

  it("rejects a code from outside the allowed window", () => {
    atSecond(59 + 90);

    expect(verifyTotp(RFC_SECRET, "287082")).toBeNull();
  });

  it.each(["12345", "1234567", "abcdef", "", null, undefined])("rejects %j without checking it", (code) => {
    atSecond(59);

    expect(verifyTotp(RFC_SECRET, code)).toBeNull();
  });

  it("rejects a code whose time step was already used", () => {
    atSecond(59);

    expect(verifyTotp(RFC_SECRET, "287082", 1)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "287082", 0)).toBe(1);
  });

  it("throws on a secret that isn't base32", () => {
    atSecond(59);

    expect(() => verifyTotp("not-base32!", "287082")).toThrow("Invalid base32 character.");
  });
});

describe("encryptSecret and decryptSecret", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", KEY);
  });

  it("round-trips a secret", () => {
    expect(decryptSecret(encryptSecret("JBSWY3DPEHPK3PXP"))).toBe("JBSWY3DPEHPK3PXP");
  });

  it("produces different ciphertext each time and hides the plaintext", () => {
    const first = encryptSecret("JBSWY3DPEHPK3PXP");

    expect(first).not.toBe(encryptSecret("JBSWY3DPEHPK3PXP"));
    expect(first).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("accepts a base64 key", () => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));

    expect(decryptSecret(encryptSecret("secret"))).toBe("secret");
  });

  it("refuses to decrypt tampered data", () => {
    const [iv, tag] = encryptSecret("secret").split(".");
    const tampered = [iv, tag, Buffer.from("different").toString("base64")].join(".");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("refuses to decrypt with another key", () => {
    const stored = encryptSecret("secret");

    vi.stubEnv("MFA_ENCRYPTION_KEY", "ff".repeat(32));

    expect(() => decryptSecret(stored)).toThrow();
  });

  it.each(["", "too-short", "aa".repeat(16)])("throws when the key %j isn't 32 bytes", (key) => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", key);

    expect(() => encryptSecret("secret")).toThrow("MFA_ENCRYPTION_KEY must be 32 bytes");
  });
});

describe("hashCode", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", KEY);
  });

  it("returns the same 64-character hex hash for the same code", () => {
    expect(hashCode("123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode("123456")).toBe(hashCode("123456"));
  });

  it("returns a different hash for another code or another key", () => {
    const original = hashCode("123456");

    expect(hashCode("654321")).not.toBe(original);

    vi.stubEnv("MFA_ENCRYPTION_KEY", "ff".repeat(32));

    expect(hashCode("123456")).not.toBe(original);
  });
});

describe("safeEqual", () => {
  it.each([
    ["equal strings", "abc123", "abc123", true],
    ["different strings of the same length", "abc123", "abc124", false],
    ["strings of different lengths", "abc", "abc123", false],
    ["two empty strings", "", "", true]
  ])("compares %s: %s", (_title, a, b, expected) => {
    expect(safeEqual(a, b)).toBe(expected);
  });
});

describe("generateEmailCode", () => {
  it("returns a 6-digit code, with leading zeros kept", () => {
    vi.spyOn(require("crypto"), "randomInt").mockReturnValue(42);

    expect(generateEmailCode()).toBe("000042");
  });

  it("returns only digits", () => {
    expect(generateEmailCode()).toMatch(/^\d{6}$/);
  });
});

describe("generateRecoveryCodes", () => {
  it("returns 10 distinct codes in XXXXX-XXXXX form", () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((code) => expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/));
  });

  it("returns the requested number of codes", () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });
});

describe("normalizeRecoveryCode", () => {
  it.each([
    ["lowercase with a dash", "abcde-fgh23", "ABCDEFGH23"],
    ["spaces", " ABCDE FGH23 ", "ABCDEFGH23"],
    ["characters outside the alphabet", "0189-ABCDE", "ABCDE"],
    ["null", null, ""],
    ["undefined", undefined, ""]
  ])("cleans %s", (_title, code, expected) => {
    expect(normalizeRecoveryCode(code)).toBe(expected);
  });
});
