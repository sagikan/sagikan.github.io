import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchSkills, ScoreRing } from "../JobDetails";

const JOB = { match_have: ["React", "Node.js"], match_missing: ["Go", "Kafka"], match_reason: "" };
const TAG_WIDTH = 50;

// Gives every element a fixed layout, since jsdom doesn't lay anything out
function fakeLayout(listWidth) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(TAG_WIDTH);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(listWidth);
}

describe("MatchSkills", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the match reason when there are no skills to list", () => {
    render(<MatchSkills job={{ match_have: [], match_missing: [], match_reason: "Strong fit" }} />);

    expect(screen.getByText("Strong fit")).toBeInTheDocument();
  });

  it("renders nothing without skills or a reason", () => {
    const { container } = render(<MatchSkills job={{ match_have: [], match_missing: [], match_reason: "" }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows every tag on the card when they fit on one line", () => {
    fakeLayout(1000);

    const { container } = render(<MatchSkills job={JOB} />);
    const tags = [...container.querySelectorAll("[data-tag]")];

    expect(tags.map((tag) => tag.style.display)).toEqual(["", "", "", ""]);
    expect(container.querySelector("[data-more]")).toHaveStyle({ display: "none" });
  });

  it("hides the tags that don't fit and counts them in a chip", () => {
    fakeLayout(120);

    const { container } = render(<MatchSkills job={JOB} />);
    const tags = [...container.querySelectorAll("[data-tag]")];
    const more = container.querySelector("[data-more]");

    expect(tags.map((tag) => tag.style.display)).toEqual(["", "none", "none", "none"]);
    expect(more).toHaveTextContent("+3");
    expect(more).toHaveAttribute("title", "Node.js, Go, Kafka");
  });

  it("lists the skills you have and miss in separate groups when split", () => {
    render(<MatchSkills job={JOB} split />);

    expect(screen.getByLabelText("Skills you have")).toHaveTextContent("React");
    expect(screen.getByLabelText("Skills you're missing")).toHaveTextContent("Kafka");
  });
});

describe("ScoreRing", () => {
  it("starts empty and fills up to the score", async () => {
    render(<ScoreRing score={80} />);

    const ring = screen.getByRole("img", { name: "80% match" });

    expect(ring.style.getPropertyValue("--score")).toBe("0");
    await waitFor(() => expect(ring.style.getPropertyValue("--score")).toBe("80"));
  });
});
