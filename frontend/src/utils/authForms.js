import { passwordRules } from "./passwordRules";

export function newPasswordError(password, confirmPassword, email) {
  if (!passwordRules(password, email).every((rule) => rule.met)) {
    return "Password doesn't meet all the requirements.";
  }

  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }

  return "";
}

export const emptySecondFactor = { useRecovery: false, code: "", recoveryCode: "" };

export function secondFactorBody(value) {
  return value.useRecovery ? { recoveryCode: value.recoveryCode } : { code: value.code };
}

export function isSecondFactorComplete(value) {
  return value.useRecovery ? value.recoveryCode.trim().length > 0 : value.code.length === 6;
}
