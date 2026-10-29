import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cell, downloadApplicationsCsv } from "../exportCsv";

const APPLICATION = {
  company: "Acme",
  position: "Backend Engineer",
  location: "Haifa",
  workplace_model: "Hybrid",
  status: "Applied",
  applied_at: "2026-05-01",
  job_url: "https://example.com/job",
  notes: "Said \"hello\"",
  created_at: "2026-05-02T10:00:00Z"
};

describe("cell", () => {
  it.each([
    ["plain text", "Acme", "\"Acme\""],
    ["a quote", "Said \"hi\"", "\"Said \"\"hi\"\"\""],
    ["a comma and a line break", "a,b\nc", "\"a,b\nc\""],
    ["a number", 5, "\"5\""],
    ["null", null, "\"\""],
    ["undefined", undefined, "\"\""]
  ])("wraps %s in quotes", (_title, value, expected) => {
    expect(cell(value)).toBe(expected);
  });

  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tTab", "\rReturn"])("defuses the spreadsheet formula %j", (value) => {
    expect(cell(value)).toBe(`"'${value}"`);
  });
});

describe("downloadApplicationsCsv", () => {
  const downloads = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function recordDownload() {
      downloads.push({ name: this.download, href: this.href });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    downloads.length = 0;
  });

  it("downloads a dated CSV file and cleans up after itself", () => {
    downloadApplicationsCsv([APPLICATION]);

    expect(downloads).toEqual([{ name: "job-applications-2026-10-29.csv", href: "blob:test" }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(document.querySelector("a")).toBeNull();
  });

  it("writes a header row and a row per application, with a byte order mark for Excel", async () => {
    downloadApplicationsCsv([APPLICATION]);

    const blob = URL.createObjectURL.mock.calls[0][0];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const lines = new TextDecoder().decode(bytes).split("\r\n");

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(lines).toEqual([
      "\"Company\",\"Position\",\"Location\",\"Workplace\",\"Status\",\"Applied on\",\"Job URL\",\"Notes\",\"Added at\"",
      "\"Acme\",\"Backend Engineer\",\"Haifa\",\"Hybrid\",\"Applied\",\"2026-05-01\",\"https://example.com/job\",\"Said \"\"hello\"\"\",\"2026-05-02T10:00:00Z\""
    ]);
  });

  it("writes only the header for no applications", async () => {
    downloadApplicationsCsv([]);

    const text = await URL.createObjectURL.mock.calls[0][0].text();

    expect(text.split("\r\n")).toHaveLength(1);
  });
});
