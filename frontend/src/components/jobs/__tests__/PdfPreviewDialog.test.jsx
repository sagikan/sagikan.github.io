import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfPreviewDialog from "../PdfPreviewDialog";
import { openPdf } from "../../../utils/resume/pdfPreview";

const LETTER = { width: 816, height: 1056 };
const BOX_WIDTH = 848;

vi.mock("../../../utils/resume/pdfPreview", async (importOriginal) => ({ ...(await importOriginal()), openPdf: vi.fn() }));

// Builds a stand-in for an opened PDF with the given number of letter pages
function openedPdf(pages = 2) {
  return {
    pages: Array.from({ length: pages }, () => LETTER),
    drawPage: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    close: vi.fn()
  };
}

// Opens the dialog on a PDF, returning its callbacks
async function showDialog({ pdf = openedPdf(), getPdf } = {}) {
  const props = {
    getPdf: getPdf || vi.fn(async () => ({ blob: new Blob(["%PDF-"]), fileName: "Resume.pdf" })),
    onClose: vi.fn()
  };

  openPdf.mockResolvedValue(pdf);
  const view = render(<PdfPreviewDialog {...props} />);

  if (!getPdf) await screen.findByRole("heading", { name: /Resume\.pdf/ });

  return { ...props, pdf, view };
}

// Lists the CSS width of each page on screen
function pageWidths() {
  return screen.getAllByRole("img", { name: /^Page / }).map((page) => page.style.width);
}

// Returns the zoom percentage on screen
function zoomShown() {
  return screen.getByRole("button", { name: /fit to width/ }).textContent;
}

describe("PdfPreviewDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(BOX_WIDTH);
    openPdf.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows every page fitted to the width, with only the file name in the title", async () => {
    const { pdf } = await showDialog({ pdf: openedPdf(3) });

    expect(screen.getByRole("dialog", { name: "Resume.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent(/^Resume\.pdf$/);
    expect(pageWidths()).toEqual(["816px", "816px", "816px"]);
    expect(zoomShown()).toBe("100%");
    expect(pdf.drawPage).toHaveBeenCalledWith(2, expect.any(HTMLCanvasElement), 816);
  });

  it("holds only the pages, zoom and close, with no download", async () => {
    await showDialog();

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Close", "Zoom out", "Zoom 100%, fit to width", "Zoom in"
    ]);
  });

  it("insets the pages to line up with the title and close button, with the scrollbar inside the right inset", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(BOX_WIDTH + 12);
    await showDialog();

    expect(document.querySelector(".pdf-peek-pages").style.padding).toBe("8px 4px 16px 16px");
    expect(pageWidths()).toEqual(["828px", "828px"]);
  });

  it("shows the page in view out of the page count over the pages", async () => {
    await showDialog({ pdf: openedPdf(3) });

    expect(screen.getByLabelText("Page 1 of 3")).toHaveTextContent("1 / 3");
  });

  it("follows the page that covers the top third of the view as the pages scroll", async () => {
    await showDialog({ pdf: openedPdf(3) });
    const box = screen.getByLabelText("Resume pages");
    const pages = screen.getAllByRole("img", { name: /^Page / });

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectOf() {
      const index = pages.indexOf(this);

      return index === -1 ? { top: 0, height: 600 } : { top: 12 + index * 1068 - box.scrollTop, height: 1056 };
    });
    box.scrollTop = 1100;
    fireEvent.scroll(box);

    expect(screen.getByLabelText("Page 2 of 3")).toHaveTextContent("2 / 3");
  });

  it("shows the page and zoom control while the pages scroll, then hides it again", async () => {
    await showDialog();
    const controls = screen.getByRole("toolbar", { name: "Page and zoom" });

    vi.useFakeTimers();
    fireEvent.scroll(screen.getByLabelText("Resume pages"));
    const whileScrolling = controls.dataset.active;
    act(() => vi.advanceTimersByTime(1200));
    vi.useRealTimers();

    expect(whileScrolling).toBe("true");
    expect(controls.dataset.active).toBe("false");
  });

  it("slides a marker under the hovered zoom button, jumping into place the first time", async () => {
    await showDialog();
    const marker = document.querySelector(".pdf-peek-marker");

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Zoom in" }));
    const first = marker.className;
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Zoom out" }));
    const second = marker.className;
    fireEvent.pointerLeave(screen.getByRole("toolbar", { name: "Page and zoom" }));

    expect(first).toBe("pdf-peek-marker is-shown jump");
    expect(second).toBe("pdf-peek-marker is-shown");
    expect(marker).not.toHaveClass("is-shown");
  });

  it("keeps the marker under the pointer when pressing a button blurs the one pressed before it", async () => {
    await showDialog();
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });

    fireEvent.pointerEnter(zoomIn);
    fireEvent.focus(zoomIn);
    fireEvent.pointerEnter(zoomOut);
    fireEvent.blur(zoomIn);

    expect(document.querySelector(".pdf-peek-marker")).toHaveClass("is-shown");
  });

  it("marks a zoom button reached with the keyboard, and lets go of it when the focus leaves", async () => {
    await showDialog();
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const marker = document.querySelector(".pdf-peek-marker");

    vi.spyOn(zoomIn, "matches").mockImplementation((selector) => selector === ":focus-visible");
    fireEvent.focus(zoomIn);
    const focused = marker.classList.contains("is-shown");
    fireEvent.blur(zoomIn);

    expect(focused).toBe(true);
    expect(marker).not.toHaveClass("is-shown");
  });

  it("doesn't mark a zoom button that can't be pressed", async () => {
    await showDialog();

    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    }

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Zoom in" }));

    expect(document.querySelector(".pdf-peek-marker")).not.toHaveClass("is-shown");
  });

  it("puts the focus on the pages, so the keyboard scrolls them right away", async () => {
    await showDialog();

    expect(screen.getByLabelText("Resume pages")).toHaveFocus();
  });

  it("shows a blank page with a spinner while the PDF is prepared", () => {
    showDialog({ getPdf: () => new Promise(() => {}) });

    expect(screen.getByText("Preparing the preview…")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Page and zoom" })).not.toBeInTheDocument();
  });

  it("zooms in and out by steps, and fits the width again from the percentage", async () => {
    await showDialog();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomedIn = pageWidths();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    const zoomedOut = pageWidths();
    fireEvent.click(screen.getByRole("button", { name: /fit to width/ }));

    expect(zoomedIn).toEqual(["1020px", "1020px"]);
    expect(zoomedOut).toEqual(["612px", "612px"]);
    expect(pageWidths()).toEqual(["816px", "816px"]);
    expect(screen.getByRole("button", { name: /fit to width/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("counts every click when they come faster than the dialog redraws", async () => {
    await showDialog();
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });

    act(() => {
      fireEvent.click(zoomIn);
      fireEvent.click(zoomIn);
    });

    expect(zoomShown()).toBe("150%");
  });

  it("stops zooming in at the last step", async () => {
    await showDialog();

    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    }

    expect(zoomShown()).toBe("300%");
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  });

  it("zooms with the + and - keys and fits the width with 0", async () => {
    await showDialog();

    fireEvent.keyDown(window, { key: "+" });
    const zoomed = zoomShown();
    fireEvent.keyDown(window, { key: "0" });

    expect(zoomed).toBe("125%");
    expect(zoomShown()).toBe("100%");
  });

  it("leaves Ctrl and the plus key to the browser", async () => {
    await showDialog();

    fireEvent.keyDown(window, { key: "+", ctrlKey: true });

    expect(zoomShown()).toBe("100%");
  });

  it("offers to try again when the PDF can't be shown, and shows it on the next try", async () => {
    const getPdf = vi.fn(async () => ({ blob: new Blob(["%PDF-"]), fileName: "Resume.pdf" }));

    openPdf.mockRejectedValueOnce(new Error("bad PDF"));
    showDialog({ getPdf });
    await screen.findByText("Couldn't show the preview.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Resume.pdf" })).toBeInTheDocument();
    expect(getPdf).toHaveBeenCalledTimes(2);
  });

  it("closes from its close button", async () => {
    const { onClose } = await showDialog();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a click outside it, but not on a click inside", async () => {
    const { onClose } = await showDialog();

    fireEvent.click(screen.getByLabelText("Resume pages"));
    const afterInside = onClose.mock.calls.length;
    fireEvent.click(screen.getByRole("dialog"));

    expect(afterInside).toBe(0);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const { onClose } = await showDialog();

    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("frees the PDF when it closes", async () => {
    const { pdf, view } = await showDialog();

    view.unmount();

    expect(pdf.close).toHaveBeenCalledOnce();
  });

  it("frees a PDF that finishes opening after the dialog closed", async () => {
    const pdf = openedPdf();
    let finishOpening;

    openPdf.mockReturnValue(new Promise((resolve) => { finishOpening = resolve; }));
    const view = render(<PdfPreviewDialog getPdf={async () => ({ blob: new Blob(["%PDF-"]), fileName: "Resume.pdf" })} onClose={vi.fn()} />);
    await act(async () => {});
    view.unmount();
    await act(async () => finishOpening(pdf));

    expect(pdf.close).toHaveBeenCalledOnce();
  });
});
