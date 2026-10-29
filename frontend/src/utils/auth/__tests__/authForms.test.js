import { describe, expect, it } from "vitest";
import { emptySecondFactor, isSecondFactorComplete, newPasswordError, secondFactorBody } from "../authForms";

const EMAIL = "dana.levi@example.com";
const STRONG = "Str0ng!Passw0rd";

describe("newPasswordError", () => {
  it("returns an empty string for a valid, matching password", () => {
    expect(newPasswordError(STRONG, STRONG, EMAIL)).toBe("");
  });

  it("reports unmet requirements before a mismatch", () => {
    expect(newPasswordError("weak", "other", EMAIL)).toBe("Password doesn't meet all the requirements.");
  });

  it("reports a mismatch once the password is valid", () => {
    expect(newPasswordError(STRONG, `${STRONG}x`, EMAIL)).toBe("Passwords do not match.");
  });
});

describe("secondFactorBody", () => {
  it("sends the code by default", () => {
    expect(secondFactorBody({ useRecovery: false, code: "123456", recoveryCode: "ignored" })).toEqual({ code: "123456" });
  });

  it("sends the recovery code when it is in use", () => {
    expect(secondFactorBody({ useRecovery: true, code: "123456", recoveryCode: "ABCD-EFGH" })).toEqual({ recoveryCode: "ABCD-EFGH" });
  });
});

describe("isSecondFactorComplete", () => {
  it.each([
    ["a 6-digit code", { useRecovery: false, code: "123456", recoveryCode: "" }, true],
    ["a short code", { useRecovery: false, code: "12345", recoveryCode: "" }, false],
    ["a recovery code", { useRecovery: true, code: "", recoveryCode: "ABCD-EFGH" }, true],
    ["a blank recovery code", { useRecovery: true, code: "123456", recoveryCode: "   " }, false],
    ["the empty form", emptySecondFactor, false]
  ])("treats %s as complete: %s", (_title, value, expected) => {
    expect(isSecondFactorComplete(value)).toBe(expected);
  });
});
