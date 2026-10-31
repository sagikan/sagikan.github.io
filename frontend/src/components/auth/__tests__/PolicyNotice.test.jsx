import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { policyDate } from "../../../utils/policy/policy";
import PolicyNotice from "../PolicyNotice";

describe("PolicyNotice", () => {
  it("tells the user the policy was updated, and on what date", () => {
    render(<PolicyNotice onReview={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Privacy Policy updated" })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(policyDate()))).toBeInTheDocument();
  });

  it("opens the policy when the user chooses to review it, and does nothing else", () => {
    const onReview = vi.fn();
    const onClose = vi.fn();

    render(<PolicyNotice onReview={onReview} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Review policy" }));

    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the user continues", () => {
    const onReview = vi.fn();
    const onClose = vi.fn();

    render(<PolicyNotice onReview={onReview} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReview).not.toHaveBeenCalled();
  });

  it("closes with the close button", () => {
    const onClose = vi.fn();

    render(<PolicyNotice onReview={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the dialog is cancelled with the Escape key", () => {
    const onClose = vi.fn();

    render(<PolicyNotice onReview={vi.fn()} onClose={onClose} />);
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
