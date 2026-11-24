import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Logo, { PixelDigit, PixelZero } from "../Logo";

describe("PixelZero", () => {
  it("draws the zero on a 7 by 10 grid", () => {
    const { container } = render(<PixelZero />);

    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 7 10");
  });
});

describe("PixelDigit", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])("draws the digit %i on a 5 by 7 grid", (digit) => {
    const { container } = render(<PixelDigit digit={digit} />);

    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 5 7");
    expect(container.querySelector("path").getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);
  });

  it("sizes the digit from its height, keeping the grid's proportions", () => {
    const { container } = render(<PixelDigit digit={3} height="14px" />);

    expect(container.querySelector("svg").style.width).toBe("calc(10px)");
  });
});

describe("Logo", () => {
  it("draws the zero with gaps between its pixels at the given size", () => {
    const { container } = render(<Logo size={32} />);

    expect(container.querySelector("svg")).toHaveClass("logo");
    expect(container.querySelector("svg").style.height).toBe("32px");
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });
});
