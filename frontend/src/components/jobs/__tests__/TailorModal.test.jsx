import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TailorModal, { DownloadButton } from "../TailorModal";

const CV = {
  name: "Dana Levi", location: "", phone: "", email: "", links: [], summary: "", education: [],
  experience: [], projects: [], skills: [], extras: []
};
const JOB = { id: 1, position: "Backend Developer", company: "Acme", state: "saved" };

// The preview's PDF never finishes building, so opening it doesn't start pdfmake and pdf.js in jsdom
vi.mock("../../../utils/resume/cvPdf", async (importOriginal) => ({ ...(await importOriginal()), makeTailoredPdf: vi.fn(() => new Promise(() => {})) }));

// Shows the button, returning its callbacks
function showButton(props = {}) {
  const callbacks = { onPreview: vi.fn(), onClick: vi.fn() };

  render(<DownloadButton primary={false} busy={false} disabled={false} {...callbacks} {...props} />);

  return callbacks;
}

describe("DownloadButton", () => {
  it("downloads from its main part", () => {
    const { onClick, onPreview } = showButton();

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("opens the preview from its eye part", () => {
    const { onClick, onPreview } = showButton();

    fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));

    expect(onPreview).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the eye part as an icon only, telling assistive tech it opens a dialog", () => {
    showButton();
    const preview = screen.getByRole("button", { name: "Preview PDF" });

    expect(preview).toHaveTextContent("");
    expect(preview).toHaveAttribute("aria-haspopup", "dialog");
  });

  it.each([true, false])("gives both parts the same style when primary is %s", (primary) => {
    showButton({ primary });
    const variant = primary ? "btn-primary" : "btn-ghost";

    expect(screen.getByRole("button", { name: "Download PDF" })).toHaveClass(variant);
    expect(screen.getByRole("button", { name: "Preview PDF" })).toHaveClass(variant);
  });

  it("marks its text as the part that drops when the footer is crowded, keeping its accessible name", () => {
    showButton();
    const button = screen.getByRole("button", { name: "Download PDF" });

    expect(button.querySelector(".btn-label")).toHaveAttribute("data-drop-label");
    expect(button).toHaveAttribute("title", "Download PDF");
  });

  it("disables both parts while busy", () => {
    showButton({ disabled: true, busy: true });

    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview PDF" })).toBeDisabled();
    expect(screen.getByText("Preparing…")).toBeInTheDocument();
  });
});

describe("TailorModal", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ tailoring: { cv: CV, include_grade_sheet: false, gaps: [], flags: [] } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Opens the tailor window on a saved tailoring
  async function showModal() {
    render(
      <TailorModal
        job={JOB}
        csrfToken="token"
        baseCv={CV}
        gradeSheet={null}
        onGradeSheetChange={vi.fn()}
        onClose={vi.fn()}
        onTailored={vi.fn()}
        onApply={vi.fn()}
        onUnauthorized={vi.fn()}
      />
    );
    await screen.findByRole("button", { name: "Preview PDF" });
  }

  it("opens the preview from the eye beside Download PDF, and keeps the window open when it closes", async () => {
    await showModal();

    fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));
    const opened = screen.getAllByRole("dialog").length;
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1));

    expect(opened).toBe(2);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
