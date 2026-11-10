import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppNote from "../AppNote";

describe("AppNote", () => {
  it("shows the note without a sign by default", () => {
    render(<AppNote notes="Call back on Monday" />);

    expect(screen.getByText("Call back on Monday")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Added automatically" })).not.toBeInTheDocument();
  });

  it("shows the sign for an automatic note", () => {
    render(<AppNote notes="Applied on Oct 10th" auto />);

    expect(screen.getByRole("img", { name: "Added automatically" })).toBeInTheDocument();
  });
});
