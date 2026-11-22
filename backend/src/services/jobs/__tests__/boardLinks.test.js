import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { boardsIn, comeetCodes, prettyName } = require("../boardLinks");

describe("prettyName", () => {
  it.each([
    ["melio", "Melio"],
    ["wynd-labs", "Wynd Labs"],
    ["HUMAN", "HUMAN"],
    ["my_company.io", "My Company Io"],
    ["Via", "Via"],
    ["tripleten/98.008", "Tripleten"],
    ["motorolasolutions.wd5/Careers", "Motorolasolutions"]
  ])("turns %s into %s", (token, expected) => {
    expect(prettyName(token)).toBe(expected);
  });
});

describe("boardsIn", () => {
  it("finds the job boards that links in the text point to", () => {
    const text = [
      "https://boards.greenhouse.io/melio/jobs/123",
      "https://job-boards.greenhouse.io/embed/job_board?for=Similarweb",
      "https://boards.greenhouse.io/embed/job_board/js?for=descope",
      "https://jobs.lever.co/walkme/abc-123",
      "https://jobs.ashbyhq.com/wynd-labs/uuid"
    ].join("\n");

    expect(boardsIn(text)).toEqual([
      { provider: "greenhouse", token: "melio" },
      { provider: "greenhouse", token: "Similarweb" },
      { provider: "greenhouse", token: "descope" },
      { provider: "lever", token: "walkme" },
      { provider: "ashby", token: "wynd-labs" }
    ]);
  });

  it.each([
    ["a Comeet board, with its company code", "https://www.comeet.com/jobs/tripleten/98.008/account-executive/AC.F50?utm_source=x", "comeet", "tripleten/98.008"],
    ["a Comeet board on the .co address", "https://www.comeet.co/jobs/acme/AF.100", "comeet", "acme/AF.100"],
    ["a Workable board", "https://apply.workable.com/huggingface/j/81B46579FE", "workable", "huggingface"],
    ["a Workable widget", "https://apply.workable.com/api/v1/widget/accounts/taboola?details=true", "workable", "taboola"],
    ["an old Workable address", "https://acme.workable.com/jobs/123", "workable", "acme"],
    ["a SmartRecruiters board", "https://jobs.smartrecruiters.com/Visa/744000158320111-engineer", "smartrecruiters", "Visa"],
    ["a SmartRecruiters careers page", "https://careers.smartrecruiters.com/Wix", "smartrecruiters", "Wix"],
    ["a Recruitee board", "https://bunq.recruitee.com/o/copywriter-3", "recruitee", "bunq"],
    ["a Greenhouse feed address in a script", "fetch('https://boards-api.greenhouse.io/v1/boards/playtika/jobs')", "greenhouse", "playtika"],
    ["a Lever feed address in a script", "https://api.lever.co/v0/postings/walkme?mode=json", "lever", "walkme"],
    ["an Ashby feed address in a script", "https://api.ashbyhq.com/posting-api/job-board/wynd-labs", "ashby", "wynd-labs"],
    ["a BambooHR board", "https://believermeats.bamboohr.com/careers", "bamboohr", "believermeats"],
    ["a Workday site", "https://motorolasolutions.wd5.myworkdayjobs.com/Careers/job/Israel/Engineer_R1", "workday", "motorolasolutions.wd5/Careers"],
    ["a Workday site after a language", "https://flextronics.wd1.myworkdayjobs.com/en-US/Careers", "workday", "flextronics.wd1/Careers"],
    ["a Workday site's feed address", "https://redhat.wd5.myworkdayjobs.com/wday/cxs/redhat/jobs/jobs", "workday", "redhat.wd5/jobs"]
  ])("finds %s", (_title, text, provider, token) => {
    expect(boardsIn(text)).toEqual([{ provider, token }]);
  });

  it.each([
    ["a Comeet link without the company code", "https://www.comeet.com/jobs/tripleten"],
    ["a Workable job's short link", "https://apply.workable.com/j/81B46579FE"],
    ["the Workable home page", "https://www.workable.com/pricing"],
    ["the Recruitee app", "https://app.recruitee.com/login"],
    ["BambooHR's own site", "https://www.bamboohr.com/careers"],
    ["a Workday address without a site", "https://acme.wd5.myworkdayjobs.com/"]
  ])("skips %s", (_title, text) => {
    expect(boardsIn(text)).toEqual([]);
  });

  it("lists each board once, whatever the case", () => {
    expect(boardsIn("https://jobs.lever.co/Acme/1 https://jobs.lever.co/acme/2")).toHaveLength(1);
    expect(boardsIn("https://www.comeet.com/jobs/Acme/af.100 https://www.comeet.com/jobs/acme/AF.100")).toHaveLength(1);
  });

  it("decodes encoded tokens and skips words that aren't company names", () => {
    expect(boardsIn("https://jobs.ashbyhq.com/My%20Co/1")).toEqual([]);
    expect(boardsIn("https://boards.greenhouse.io/embed/x https://boards.greenhouse.io/jobs/x")).toEqual([]);
    expect(boardsIn("https://jobs.ashbyhq.com/a%2Eb/1")).toEqual([{ provider: "ashby", token: "a.b" }]);
  });

  it("doesn't take a slash into a token outside Comeet", () => {
    expect(boardsIn("https://jobs.ashbyhq.com/a%2Fb/1")).toEqual([]);
  });

  it.each([null, undefined, "", "no links here"])("finds nothing in %j", (text) => {
    expect(boardsIn(text)).toEqual([]);
  });
});

describe("comeetCodes", () => {
  it.each([
    ["the WordPress plugin's settings", "var comeetvar = {\"comeet_token\":\"x\",\"comeet_uid\":\"24.00E\"};"],
    ["a widget's settings", "COMEET.init({ \"company-uid\": \"24.00e\", \"token\": \"x\" });"],
    ["a data attribute", "<div data-company_uid='24.00E'></div>"]
  ])("finds the company code in %s, in capitals", (_title, text) => {
    expect(comeetCodes(text)).toEqual(["24.00E"]);
  });

  it("lists each code once", () => {
    expect(comeetCodes("comeet_uid:\"24.00E\" company-uid: '24.00E' company-uid: '71.001'")).toEqual(["24.00E", "71.001"]);
  });

  it.each([null, "", "comeet_uid: \"24.00EX\"", "position_uid: \"24.00E\""])("finds nothing in %j", (text) => {
    expect(comeetCodes(text)).toEqual([]);
  });
});
