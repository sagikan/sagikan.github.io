import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CvButton from "../CvButton";

const JOB = { id: "5", company: "Acme", cv_job_id: "9" };

describe("CvButton", () => {
  it("downloads the resume sent with the application", () => {
    const onDownload = vi.fn();

    render(<CvButton job={JOB} busy={false} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole("button", { name: "Download the resume you sent to Acme" }));

    expect(onDownload).toHaveBeenCalledWith(JOB);
  });

  it("is off while a download is under way", () => {
    render(<CvButton job={JOB} busy onDownload={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Download the resume you sent to Acme" })).toBeDisabled();
  });
});
