import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Loads the component fresh, since the logo hook keeps what it has loaded for the session
async function freshAvatar() {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob) => `blob:${blob.size}`) }));

  return (await import("../CompanyAvatar")).default;
}

// Mocks fetch to answer each call with the next response, repeating the last
function mockFetch(...makeResponses) {
  const fetchMock = vi.fn(async () => makeResponses[Math.min(fetchMock.mock.calls.length - 1, makeResponses.length - 1)]());

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

// Builds a logo response of the given size
const logo = (size = 3) => () => new Response(new Uint8Array(size), { headers: { "content-type": "image/png" } });

// Lets pending promises finish
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CompanyAvatar", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the company's first letter while the logo loads, then the logo", async () => {
    mockFetch(logo());

    const CompanyAvatar = await freshAvatar();
    const { container } = render(<CompanyAvatar company="Orbit" />);

    expect(screen.getByText("O")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "blob:3"));
    expect(screen.queryByText("O")).not.toBeInTheDocument();
  });

  it("keeps the letter for a company with no logo", async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 204 }));
    const CompanyAvatar = await freshAvatar();
    const { container } = render(<CompanyAvatar company="Nobody" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();

    expect(screen.getByText("N")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it.each([
    ["an empty name", "", "?"],
    ["a blank name", "   ", "?"],
    ["a lowercase name", "orbit", "O"],
    ["a name that starts with a digit", "3M", "3"],
    ["a name in another alphabet", "וויקס", "ו"]
  ])("shows the right letter for %s", async (_title, company, letter) => {
    mockFetch(() => new Response(null, { status: 204 }));

    const CompanyAvatar = await freshAvatar();

    render(<CompanyAvatar company={company} />);

    expect(screen.getByText(letter)).toBeInTheDocument();
  });

  it("asks for no logo and keeps the letter when logos are turned off", async () => {
    const fetchMock = mockFetch(logo());
    const CompanyAvatar = await freshAvatar();
    const { container } = render(<CompanyAvatar company="Orbit" logo={false} />);

    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("goes back to the letter when the logo image fails to load", async () => {
    mockFetch(logo());

    const CompanyAvatar = await freshAvatar();
    const { container } = render(<CompanyAvatar company="Orbit" />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.error(container.querySelector("img"));

    expect(screen.getByText("O")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the next company's logo after a broken one", async () => {
    mockFetch(logo(3), logo(5));

    const CompanyAvatar = await freshAvatar();
    const { container, rerender } = render(<CompanyAvatar company="Orbit" />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.error(container.querySelector("img"));
    rerender(<CompanyAvatar company="Pinnacle" />);

    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "blob:5"));
  });
});
