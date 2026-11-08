import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MfaSetupStep from "../MfaSetupStep";

const SETUP = { qrCode: "data:image/png;base64,AAAA", secret: "ABCD EFGH" };
const EXPIRED = { ok: false, data: { error: "This authenticator reset expired. Please start it again.", expired: true }, error: "This authenticator reset expired. Please start it again." };

// Renders the step with a finished setup and submits a code
function submitCode(request, props = {}) {
  render(<MfaSetupStep request={request} initialSetup={SETUP} onConfirmed={vi.fn()} {...props} />);
  fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Enable two-factor authentication" }));
}

describe("MfaSetupStep", () => {
  it("passes the confirmed result on", async () => {
    const onConfirmed = vi.fn();
    const request = vi.fn(async () => ({ ok: true, data: { recoveryCodes: ["a"] } }));

    submitCode(request, { onConfirmed, confirmPath: "/api/account/mfa/reset/confirm" });

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ recoveryCodes: ["a"] }));
    expect(request).toHaveBeenCalledWith("/api/account/mfa/reset/confirm", { code: "123456" });
  });

  it("hands an expired setup to onExpired instead of showing the error", async () => {
    const onExpired = vi.fn();

    submitCode(vi.fn(async () => EXPIRED), { onExpired });

    await waitFor(() => expect(onExpired).toHaveBeenCalledWith(EXPIRED.error));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a wrong code's error and clears the code, without calling onExpired", async () => {
    const onExpired = vi.fn();

    submitCode(vi.fn(async () => ({ ok: false, data: {}, error: "Incorrect code." })), { onExpired });

    await waitFor(() => expect(screen.getByText("Incorrect code.")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("000000")).toHaveValue("");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("shows an expired setup's error when no onExpired is given, as on the sign-up page", async () => {
    submitCode(vi.fn(async () => EXPIRED));

    await waitFor(() => expect(screen.getByText(EXPIRED.error)).toBeInTheDocument());
  });
});
