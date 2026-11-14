import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = process.env.FRONTEND_BASE_URL || "http://localhost:3001";
const screenshots =
  process.env.FRONTEND_SCREENSHOTS || join(process.cwd(), "docs/frontend-v3.2-screenshots");
mkdirSync(screenshots, { recursive: true });

test("complete v3.2 frontend", async (t) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const page = await context.newPage(),
    errors = [],
    purchasingCalls = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) purchasingCalls.push(r.url());
  });
  const state = () =>
    page.evaluate(() => JSON.parse(sessionStorage.getItem("aimo:v32:development:presentation")));
  async function settle() {
    await page.getByRole("heading", { level: 1 }).first().waitFor();
  }
  async function send(text) {
    const input = page.getByRole("textbox", { name: "Continue the conversation", exact: true });
    await input.fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForFunction(
      () =>
        !JSON.parse(sessionStorage.getItem("aimo:v32:development:presentation")).threads.some(
          (t) => t.working,
        ),
    );
  }
  async function account() {
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
  }
  async function capability(value) {
    await account();
    await page.getByText("Development tools", { exact: true }).click();
    await page.getByLabel("Capabilities", { exact: true }).selectOption(value);
    await page.keyboard.press("Escape");
  }
  async function theme(value) {
    await page.getByRole("button", { name: "Choose theme", exact: true }).click();
    await page.getByRole("radio", { name: value, exact: true }).check();
    await page.keyboard.press("Escape");
  }
  async function overflow() {
    const dims = await page.evaluate(() => ({
      w: innerWidth,
      s: document.documentElement.scrollWidth,
      h: [...document.querySelectorAll("header")].filter((e) => e.checkVisibility()).length,
      m: [...document.querySelectorAll("main")].filter((e) => e.checkVisibility()).length,
    }));
    assert(dims.s <= dims.w, `${page.url()} ${JSON.stringify(dims)}`);
    assert.equal(dims.h, 1);
    assert.equal(dims.m, 1);
    const text = await page.locator("body").innerText();
    assert(
      !/\b(mock|demo|simulated|simulation)\b/i.test(text),
      `Forbidden product wording at ${page.url()}`,
    );
  }
  let conversation,
    approval,
    order,
    restockRun,
    recipe = "macaroni-classic";
  await t.test("A1–A3: approval-first request with continuous composer", async () => {
    await page.goto(base + "/buyer");
    await page.getByRole("heading", { name: "What can I help you order?", exact: true }).waitFor();
    await page
      .getByRole("textbox", { name: "What do you need?", exact: true })
      .fill("Order 100 litres of lactose-free milk");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    conversation = page.url();
    await page.getByRole("textbox", { name: "Continue the conversation", exact: true }).waitFor();
    await page.getByRole("button", { name: "Review & approve", exact: true }).waitFor();
    const local = await state();
    assert(local.threads[0].proposals[0]);
    const records = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("aimo:v32:records")),
    );
    assert.equal(records.orders.length, 0);
    approval = records.proposals[0].approval.id;
    await overflow();
  });
  await t.test("B1 and B8: buyer-only waits for the same review", async () => {
    await capability("buyer");
    assert.equal(
      await page.getByRole("button", { name: "Review & approve", exact: true }).count(),
      0,
    );
    await page.getByText("Waiting for another authorized approver.", { exact: false }).waitFor();
    await page.goto(base + "/approvals");
    await settle();
    await page.getByRole("link", { name: "Review purchase", exact: true }).waitFor();
    await capability("both");
    await page.goto(conversation);
  });
  await t.test("B3, B4: revision supersedes v1; explanation preserves v2", async () => {
    await send("Make it 150 litres");
    await page.getByText("What changed", { exact: true }).waitFor();
    await page.getByText(/Proposal v1 · Superseded/).waitFor();
    const before = (await state()).threads[0].proposals;
    assert.equal(before.length, 2);
    await send("Why this product?");
    assert.deepEqual((await state()).threads[0].proposals, before);
    const records = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("aimo:v32:records")),
    );
    approval = records.proposals[0].approval.id;
  });
  await t.test("B3/D7/D8: revised proposal visual references", async () => {
    for (const color of ["Light", "Dark"]) {
      await theme(color);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page
          .locator(".scroll-mt-24")
          .evaluate((element) => element.scrollIntoView({ block: "start" }));
        await overflow();
        await page.screenshot({
          path: join(screenshots, `proposal-${color.toLowerCase()}-${width}.png`),
          fullPage: false,
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await theme("Light");
  });
  await t.test(
    "B2, B9, B7, B10: non-modal review, approval, recorded order and checkout",
    async () => {
      await page.getByRole("button", { name: "Review & approve", exact: true }).click();
      await page.getByRole("complementary", { name: "Review order", exact: true }).waitFor();
      const composer = page.getByRole("textbox", {
        name: "Continue the conversation",
        exact: true,
      });
      assert(await composer.isEditable());
      await composer.fill("A question kept while reviewing");
      await page
        .getByRole("complementary", { name: "Review order", exact: true })
        .getByRole("button", { name: "Review & approve", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Approve this purchase?", exact: true })
        .getByRole("button", { name: "Approve & record order", exact: true })
        .click();
      await page.getByRole("link", { name: "View order", exact: true }).waitFor();
      const records = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("aimo:v32:records")),
      );
      assert.equal(records.orders.length, 1);
      order = records.orders[0].id;
      assert.equal(records.orders[0].totalExclVat, 232.5);
      await page.goto(base + `/approvals/${approval}`);
      await page.getByRole("heading", { name: "Review purchase", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Review & approve", exact: true }).count(),
        0,
      );
      await page.goto(base + `/checkout/${order}`);
      await page
        .getByRole("heading", { name: "Online payment is not connected", exact: true })
        .waitFor();
      assert.equal(await page.getByRole("button", { name: /pay now/i }).count(), 0);
    },
  );
  await t.test("B5 and B6: rejection recovery and hard safety block", async () => {
    await page.goto(base + "/buyer");
    await page
      .getByRole("textbox", { name: "What do you need?", exact: true })
      .fill("Order 100 litres of milk");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.getByRole("button", { name: "Review & approve", exact: true }).waitFor();
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reject purchase?", exact: true });
    await dialog.getByLabel("Reason for rejection").fill("Please use a smaller quantity.");
    await dialog.getByRole("button", { name: "Reject purchase", exact: true }).click();
    await page
      .getByText(/Please use a smaller quantity/)
      .first()
      .waitFor();
    await send("Make it 50 litres");
    await page.getByRole("button", { name: "Review & approve", exact: true }).waitFor();
    await send("Order milk-protein-free oat drink");
    await page
      .getByRole("heading", {
        name: "Unable to verify the mandatory dietary requirement",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Review & approve", exact: true }).count(),
      0,
    );
    assert(
      await page
        .getByRole("textbox", { name: "Continue the conversation", exact: true })
        .isEditable(),
    );
  });
  await t.test("C1–C3: local plans, mixed check results and canonical proposal", async () => {
    await page.goto(base + "/restocking");
    await page.getByRole("heading", { name: "Keep your kitchen stocked", exact: true }).waitFor();
    await page.getByRole("button", { name: "Run all checks now", exact: true }).click();
    await page.waitForURL(/\/restocking\/runs\//);
    restockRun = page.url();
    await page.getByRole("heading", { name: /Ready \(/ }).waitFor();
    await page.getByRole("heading", { name: /Partial or late/ }).waitFor();
    await page.getByRole("heading", { name: /Availability not confirmed/ }).waitFor();
    await page.getByRole("button", { name: "Review purchase proposal", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.getByRole("button", { name: "Review & approve", exact: true }).waitFor();
    await page.goto(base + "/restocking/new");
    await page.getByLabel("Plan name", { exact: true }).fill("Evening cheese");
    await page.getByLabel("Choose kitchen stock", { exact: true }).selectOption("stock-cheese");
    await page.getByRole("button", { name: "Save restock plan", exact: true }).click();
    await page.waitForURL(base + "/restocking");
    await page.getByRole("heading", { name: "Evening cheese", exact: true }).waitFor();
  });
  await t.test("C4–C7: recipes, local edits and 1,000 portion planning", async () => {
    await page.goto(base + "/recipes");
    await page.getByRole("heading", { name: "Recipes", exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "Macaroni po-flotski — Classic", exact: true })
      .waitFor();
    await page.goto(base + `/recipes/${recipe}`);
    await page.getByRole("button", { name: "Edit recipe", exact: true }).click();
    await page.getByRole("button", { name: "Save draft locally", exact: true }).click();
    await page.getByText("Draft saved in this browser.", { exact: false }).waitFor();
    await page.goto(base + `/recipes/${recipe}/plan`);
    await page.getByRole("heading", { name: "Plan a batch", exact: true }).waitFor();
    const choose = async (name, match) => {
      const card = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .last();
      await card.getByRole("button", { name: "Find ingredient products", exact: true }).click();
      await card.getByRole("button", { name: new RegExp(match) }).click();
    };
    await choose("Durum wheat macaroni", "Durum wheat macaroni · KG");
    await choose("Minced beef, 10% fat", "Minced beef, 10% fat · KG");
    await choose("Lactose-free kitchen butter", "service pack · KG");
    await page.getByRole("button", { name: "Review purchase proposal", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.getByRole("button", { name: "Review & approve", exact: true }).waitFor();
    await page.goto(base + `/recipes/${recipe}/plan`);
    await page
      .getByLabel("Mandatory dietary requirement", { exact: true })
      .selectOption("gluten-free");
    await page.getByText("Safety requirement needs verification", { exact: true }).waitFor();
    assert(
      await page
        .getByRole("button", { name: "Review purchase proposal", exact: true })
        .isDisabled(),
    );
    await page.goto(base + "/buyer");
    await page
      .getByRole("textbox", { name: "What do you need?", exact: true })
      .fill("Plan macaroni for 1,000 portions");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.getByRole("heading", { name: "Which recipe should I use?", exact: true }).waitFor();
  });
  await t.test("D1–D6: orders, organization, policy, audit and honest integrations", async () => {
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "Orders", exact: true }).waitFor();
    await page.goto(base + `/orders/${order}`);
    await page.getByRole("heading", { name: "Order details", exact: true }).waitFor();
    await page.goto(base + "/admin/agents/kitchen");
    await page.getByRole("heading", { name: "Purchasing policies", exact: true }).waitFor();
    await page.getByRole("button", { name: "Save purchasing settings", exact: true }).waitFor();
    await page.goto(base + "/admin/organization");
    await page.getByRole("heading", { name: "Organization", exact: true }).waitFor();
    await page.getByLabel("Username", { exact: true }).fill("colleague");
    await page.getByLabel("Initial password", { exact: true }).fill("test-only-password");
    await page.getByRole("button", { name: "Create colleague account", exact: true }).click();
    await page.getByRole("heading", { name: "colleague", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Initial password", { exact: true }).inputValue(), "");
    await page.goto(base + "/audit");
    await page.getByRole("heading", { name: "Activity & Audit", exact: true }).waitFor();
    await page.goto(base + "/integrations");
    await page
      .getByRole("heading", { name: "Supplier ordering, live inventory & payments", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Check application health", exact: true }).click();
    await page.getByRole("status").waitFor();
  });
  await t.test("quote conflict recovery never creates a second order", async () => {
    const before = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("aimo:v32:records")).orders.length,
    );
    await page.goto(base + "/buyer");
    await page
      .getByRole("textbox", { name: "What do you need?", exact: true })
      .fill("Order 100 litres of milk");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.getByRole("button", { name: "Review & approve", exact: true }).waitFor();
    await account();
    await page.getByText("Development tools", { exact: true }).click();
    await page.getByLabel("Quote condition", { exact: true }).selectOption("price");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Review & approve", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Review order", exact: true })
      .getByRole("button", { name: "Review & approve", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Approve this purchase?", exact: true })
      .getByRole("button", { name: "Approve & record order", exact: true })
      .click();
    await page
      .getByText("The quote changed. Prepare an updated purchase proposal.", { exact: false })
      .first()
      .waitFor();
    await page
      .getByRole("complementary", { name: "Review order", exact: true })
      .getByRole("button", { name: "Refresh prices & prepare updated proposal", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(sessionStorage.getItem("aimo:v32:records")).orders.length,
      ),
      before,
    );
    await page.reload();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(sessionStorage.getItem("aimo:v32:records")).orders.length,
      ),
      before,
    );
  });
  await t.test("D7–D9: shared shell, themes, actual mobile layouts and screenshots", async () => {
    const views = [
      ["assistant", conversation],
      ["restocking", restockRun],
      ["recipe", base + `/recipes/${recipe}/plan`],
      ["approval", base + `/approvals/${approval}`],
      ["settings", base + "/admin/agents/kitchen"],
    ];
    for (const color of ["Light", "Dark"]) {
      await theme(color);
      for (const width of [1440, 1280, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [label, url] of views) {
          await page.goto(url);
          await settle();
          await overflow();
          if (width === 1440 || width === 390)
            await page.screenshot({
              path: join(screenshots, `${label}-${color.toLowerCase()}-${width}.png`),
              fullPage: true,
            });
        }
      }
    }
    await page.goto(conversation);
    assert(
      await page
        .getByRole("textbox", { name: "Continue the conversation", exact: true })
        .isEditable(),
    );
    await theme("System");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => (document.documentElement.style.zoom = "2"));
    await overflow();
    await page.evaluate(() => (document.documentElement.style.zoom = "1"));
    await page.setViewportSize({ width: 390, height: 844 });
    const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
    await navigation.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor();
    await page.keyboard.press("Tab");
    assert(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")));
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document.body.style.overflow !== "hidden" &&
        document.activeElement?.getAttribute("aria-label") === "Open navigation",
    );
    const notifications = page.getByRole("button", { name: "Open notifications", exact: true });
    await notifications.press("Enter");
    await page.getByRole("heading", { name: "Notifications", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(purchasingCalls, []);
});
