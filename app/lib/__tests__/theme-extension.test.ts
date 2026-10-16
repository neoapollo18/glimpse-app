import { describe, it, expect } from "vitest";
import { addQuizBlockUrl, quizBlockStatusFrom, templateLabel } from "../theme-extension";

describe("addQuizBlockUrl", () => {
  it("deep links by api key onto the quiz page template, never the home page", () => {
    expect(addQuizBlockUrl("glamrco.myshopify.com", "9cbb5891370933c3c50d2062a4a31962")).toBe(
      "https://admin.shopify.com/store/glamrco/themes/current/editor?template=page.find-my-match" +
        "&addAppBlockId=9cbb5891370933c3c50d2062a4a31962/gleame-quiz&target=newAppsSection",
    );
  });

  it("opens the editor without adding a block when the api key is missing", () => {
    expect(addQuizBlockUrl("glamrco.myshopify.com", "")).toBe(
      "https://admin.shopify.com/store/glamrco/themes/current/editor?template=page.find-my-match",
    );
  });
});

describe("quizBlockStatusFrom (shopify.app.extensions())", () => {
  const ext = (blockStatus: string, activations: Array<{ target: string }> = []) => [
    { handle: "some-checkout-ui", type: "ui_extension", activations: [{ target: "purchase.thank-you.block.render" }] },
    {
      handle: "glimpse-widget",
      type: "theme_app_extension",
      activations: [
        { handle: "gleame-quiz", name: "Gleame Quiz", target: "section", status: blockStatus, activations },
      ],
    },
  ];

  it("reports the templates an active block sits on", () => {
    const status = quizBlockStatusFrom(
      ext("active", [
        { target: "template--page.find-my-match/apps_abc/gleame_quiz_XyZ" },
        { target: "template--page.find-my-match/apps_def/gleame_quiz_Q1" },
        { target: "template--index/apps_x/gleame_quiz_Z" },
      ]),
    );
    expect(status).toEqual({ state: "active", placements: [{ template: "page.find-my-match" }, { template: "index" }] });
  });

  it("treats available and unavailable as not added", () => {
    expect(quizBlockStatusFrom(ext("available"))).toEqual({ state: "inactive" });
    expect(quizBlockStatusFrom(ext("unavailable"))).toEqual({ state: "inactive" });
  });

  it("is unknown when the API returns nothing usable", () => {
    expect(quizBlockStatusFrom(undefined)).toEqual({ state: "unknown" });
    expect(quizBlockStatusFrom([])).toEqual({ state: "unknown" });
  });
});

describe("templateLabel", () => {
  it("names templates for merchants", () => {
    expect(templateLabel("page.find-my-match")).toBe('page template "find-my-match"');
    expect(templateLabel("index")).toBe("home page");
    expect(templateLabel("page")).toBe("default page template");
  });
});
