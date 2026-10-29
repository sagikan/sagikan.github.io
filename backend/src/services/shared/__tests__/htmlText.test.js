import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { htmlToText } = require("../htmlText");

describe("htmlToText", () => {
  it("strips tags and ends paragraphs with line breaks", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><p>Bye</p>")).toBe("Hello world\nBye");
  });

  it("turns list items into dashes, each after a blank line", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n\n- Two");
  });

  it("turns <br> tags into line breaks", () => {
    expect(htmlToText("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("drops script and style content", () => {
    expect(htmlToText("<style>p { color: red }</style>Text<script>alert(1)</script>")).toBe("Text");
  });

  it.each([
    ["named entities", "Fish &amp; chips &ndash; &quot;great&quot;", "Fish & chips – \"great\""],
    ["decimal entities", "&#65;&#66;", "AB"],
    ["hex entities", "&#x41;&#x42;", "AB"],
    ["unknown entities", "&notarealentity;", "&notarealentity;"],
    ["out-of-range code points", "&#99999999;", "&#99999999;"]
  ])("decodes %s", (_title, html, expected) => {
    expect(htmlToText(html)).toBe(expected);
  });

  it("unescapes HTML that was sent escaped, once, before reading the tags", () => {
    expect(htmlToText("&lt;p&gt;Hello&lt;/p&gt;&lt;p&gt;World&lt;/p&gt;")).toBe("Hello\nWorld");
  });

  it("collapses repeated spaces and blank lines", () => {
    expect(htmlToText("<p>a   b</p>\n\n\n\n<p>c</p>")).toBe("a b\n\nc");
  });

  it("returns an empty string for missing input", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(undefined)).toBe("");
  });
});
