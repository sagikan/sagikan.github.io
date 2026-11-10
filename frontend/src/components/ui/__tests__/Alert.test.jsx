import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Alert from "../Alert";

describe("Alert", () => {
  it("shows an extra action before the dismiss button", () => {
    render(<Alert type="warning" action={<button type="button">Undo</button>}>Careful</Alert>);

    const buttons = screen.getAllByRole("button");

    expect(buttons.map((button) => button.textContent || button.getAttribute("aria-label"))).toEqual(["Undo", "Dismiss"]);
  });

  it("hides itself and tells the owner when dismissed", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(<Alert onDismiss={onDismiss}>Something failed</Alert>);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
