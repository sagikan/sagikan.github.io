import { describe, expect, it } from "vitest";
import { passwordRules } from "../passwordRules";

const EMAIL = "dana.levi@example.com";
const STRONG = "Str0ng!Passw0rd";

// Lists the labels of the rules a password doesn't meet
function unmet(password, email = EMAIL) {
  return passwordRules(password, email).filter((rule) => !rule.met).map((rule) => rule.label);
}

describe("passwordRules", () => {
  it("meets every rule for a strong password", () => {
    expect(unmet(STRONG)).toEqual([]);
  });

  it.each([
    ["is too short", "Aa1!aaaa", "12–72 characters"],
    ["has no uppercase letter", "str0ng!passw0rd", "An uppercase letter"],
    ["has no lowercase letter", "STR0NG!PASSW0RD", "A lowercase letter"],
    ["has no number", "Strong!Password", "A number"],
    ["has no symbol", "Str0ngPassw0rd", "A symbol (e.g. ! @ # $)"]
  ])("flags a password that %s", (_title, password, label) => {
    expect(unmet(password)).toEqual([label]);
  });

  it("counts the length in bytes, so a long multi-byte password is too long", () => {
    const password = `Aa1!${"é".repeat(40)}`;

    expect(password.length).toBeLessThan(72);
    expect(unmet(password)).toEqual(["12–72 characters"]);
  });

  it("accepts a password of exactly 72 bytes", () => {
    expect(unmet(`Aa1!${"a".repeat(68)}`)).toEqual([]);
  });

  it("flags a password that contains the email handle, ignoring case", () => {
    expect(unmet("My-DANA.LEVI-9!x")).toEqual(["No email handle"]);
  });

  it("ignores an email handle shorter than 3 characters", () => {
    expect(unmet("Jo-Str0ng!Password", "jo@example.com")).toEqual([]);
  });

  it("flags an empty password on every rule", () => {
    expect(unmet("")).toHaveLength(6);
  });
});
