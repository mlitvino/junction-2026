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

async function authorizeInDialog(page, title, label) {
  const dialog = page
    .getByRole("dialog", { name: title, exact: true })
    .or(page.getByRole("region", { name: title, exact: true }));
  const hold = dialog.getByRole("button", { name: `Hold to ${label.toLowerCase()}`, exact: true });
  await hold.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
}

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
  async function assertComposerPinned(target = page) {
    const form = await target
      .getByRole("form", { name: "Assistant message", exact: true })
      .boundingBox();
    const viewport = target.viewportSize();
    const navigation =
      viewport.width < 1024
        ? await target
            .getByRole("navigation", { name: "Primary mobile navigation", exact: true })
            .boundingBox()
        : null;
    const bottom = navigation ? navigation.y - 8 : viewport.height - 16;
    assert(Math.abs(form.y + form.height - bottom) < 2, "Composer must stay at the window bottom");
    assert(form.x >= 0 && form.x + form.width <= viewport.width);
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
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    if (dark !== (value === "Dark"))
      await page.getByRole("button", { name: "Toggle color theme", exact: true }).click();
    await page.waitForFunction(
      (expected) => document.documentElement.classList.contains("dark") === expected,
      value === "Dark",
    );
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
    const sidebar = page.getByRole("complementary", { name: "Application sidebar", exact: true });
    const settings = sidebar.getByRole("link", { name: "Settings & Administration", exact: true });
    assert.equal(await settings.innerText(), "Settings & Administration");
    assert.equal(await sidebar.getByText("anna.lindholm", { exact: true }).count(), 0);
    assert.equal(await sidebar.getByText("Buyer & Approver", { exact: true }).count(), 0);
    assert.equal(await page.locator("header").getByText("Development", { exact: true }).count(), 0);
    assert.equal(
      await page
        .getByRole("link", { name: "Browse catalog & prepare purchase", exact: true })
        .count(),
      0,
    );
    const input = page.getByRole("textbox", { name: "What do you need?", exact: true });
    assert(
      (await page.getByRole("form", { name: "Assistant message", exact: true }).boundingBox())
        .height <= 64,
    );
    const suggestions = page.locator("summary").filter({ hasText: /^\s*Suggestions\s*$/ });
    const example = page.getByRole("button", {
      name: "Order 100 litres of lactose-free milk",
      exact: true,
    });
    assert.equal(await example.isVisible(), false);
    await suggestions.press("Enter");
    const suggestionRows = await suggestions
      .locator("..")
      .locator("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { x: box.x, y: box.y, icons: button.querySelectorAll("svg").length };
        }),
      );
    assert.equal(suggestionRows.length, 4);
    suggestionRows.forEach((row, index) => {
      assert.equal(row.x, suggestionRows[0].x);
      assert.equal(row.icons, 2);
      if (index) assert(row.y > suggestionRows[index - 1].y);
    });
    assert.equal(
      await page
        .getByText(
          "Choose an example and adjust it before sending. Human approval is required by default.",
          { exact: true },
        )
        .count(),
      0,
    );
    await example.click();
    assert.equal(await input.inputValue(), "Order 100 litres of lactose-free milk");
    assert(await input.evaluate((element) => element === document.activeElement));
    await suggestions.click();
    assert.equal(await example.isVisible(), false);
    await input.press("Enter");
    await page.waitForURL(/\/buyer\/conversations\//);
    conversation = page.url();
    await page.getByRole("textbox", { name: "Continue the conversation", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("link", { name: "New conversation", exact: true }).count(),
      0,
    );
    assert.equal(await page.getByLabel("Suggested follow-ups", { exact: true }).count(), 0);
    assert.equal(await page.getByText("About this conversation", { exact: true }).count(), 0);
    const composer = page.getByRole("textbox", { name: "Continue the conversation", exact: true });
    const initialHeight = (await composer.boundingBox()).height;
    assert(initialHeight <= 44);
    await composer.fill("A preference for this purchase. ".repeat(25));
    await page.waitForFunction(() => document.querySelector("textarea").clientHeight > 44);
    assert((await composer.boundingBox()).height > initialHeight);
    await composer.fill("");
    await page.waitForFunction(() => document.querySelector("textarea").clientHeight <= 44);
    await page.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
    const proposalCard = page.getByRole("region", { name: "Purchase proposal", exact: true });
    await proposalCard.getByText("Net total", { exact: true }).waitFor();
    await proposalCard.getByText("Proposal v1", { exact: true }).waitFor();
    assert.equal(
      await proposalCard.getByRole("button", { name: "Withdraw request", exact: true }).count(),
      0,
    );
    assert(
      await proposalCard.getByRole("button", { name: "Approve proposal", exact: true }).isVisible(),
    );
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
      await page.getByRole("button", { name: "Approve proposal", exact: true }).count(),
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
    "B2, B9, B7, B10: inline review, approval, recorded order and checkout",
    async () => {
      await page.getByRole("button", { name: "Approve proposal", exact: true }).click();
      await page.getByRole("region", { name: "Approve this proposal?", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("complementary", { name: "Review order", exact: true }).count(),
        0,
      );
      const composer = page.getByRole("textbox", {
        name: "Continue the conversation",
        exact: true,
      });
      assert(await composer.isEditable());
      await composer.fill("A question kept while reviewing");
      await assertComposerPinned();
      const approvalDialog = page.getByRole("region", {
        name: "Approve this proposal?",
        exact: true,
      });
      const hold = approvalDialog.getByRole("button", {
        name: "Hold to approve",
        exact: true,
      });
      await hold.focus();
      await page.keyboard.down("Space");
      await page.waitForTimeout(200);
      await page.keyboard.up("Space");
      const afterEarlyRelease = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("aimo:v32:records")),
      );
      assert.equal(
        afterEarlyRelease.proposals.find((p) => p.approval?.id === approval).approval.status,
        "PENDING",
        "Early release must not approve",
      );
      assert.equal(afterEarlyRelease.orders.length, 0);
      await page.keyboard.down("Space");
      await page.waitForTimeout(900);
      await page.keyboard.up("Space");
      const checkout = page.getByRole("region", { name: "Checkout", exact: true });
      await checkout.waitFor();
      const approvedRecords = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("aimo:v32:records")),
      );
      assert.equal(
        approvedRecords.orders.length,
        0,
        "Approval must not record an order before checkout",
      );
      assert.match(page.url(), /\/buyer\/conversations\//);
      assert(await composer.isEditable());
      assert.equal(
        await page.locator('details[class~="group/proposal"]').getAttribute("open"),
        null,
      );
      assert.equal(await page.getByRole("button", { name: "Checkout", exact: true }).count(), 0);
      const withdraw = checkout.getByRole("button", { name: "Withdraw request", exact: true });
      const buy = checkout.getByRole("button", { name: "Buy", exact: true });
      assert(await withdraw.isVisible());
      const withdrawBox = await withdraw.boundingBox(),
        buyBox = await buy.boundingBox();
      assert(buyBox.x > withdrawBox.x && Math.abs(buyBox.y - withdrawBox.y) < 2);
      await withdraw.click();
      await checkout
        .getByRole("region", { name: "Withdraw this request?", exact: true })
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await buy.click();
      await authorizeInDialog(page, "Record this order?", "Buy");
      await checkout.getByRole("heading", { name: "Order confirmed", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Checkout", exact: true }).count(), 0);
      await page.reload();
      await checkout.waitFor();
      await checkout.getByRole("heading", { name: "Order recorded", exact: true }).waitFor();
      assert.match(page.url(), /\/buyer\/conversations\//);
      const records = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("aimo:v32:records")),
      );
      assert.equal(records.orders.length, 1);
      order = records.orders[0].id;
      assert.equal(records.orders[0].totalExclVat, 232.5);
      await page.goto(base + `/approvals/${approval}`);
      await page.getByRole("link", { name: "Back to review list", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Approve proposal", exact: true }).count(),
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
    const recent = page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: /^\s*Recent conversations\s*$/ }) });
    await recent.locator("summary").waitFor();
    assert.equal(await recent.locator("ul").isVisible(), false);
    await recent.locator("summary").click();
    assert(await recent.locator("ul").isVisible());
    await recent.getByText("Order recorded", { exact: true }).waitFor();
    assert.equal(await recent.getByText("Continue", { exact: true }).count(), 0);
    assert.equal(await recent.locator("li").first().locator("a > svg").count(), 1);
    await recent.locator("summary").click();
    assert.equal(await recent.locator("ul").isVisible(), false);
    await page
      .getByRole("textbox", { name: "What do you need?", exact: true })
      .fill("Order 100 litres of milk");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reject purchase?", exact: true });
    await dialog.getByLabel("Reason for rejection").fill("Please use a smaller quantity.");
    await dialog.getByRole("button", { name: "Reject purchase", exact: true }).click();
    await page
      .getByText(/Please use a smaller quantity/)
      .first()
      .waitFor();
    await send("Make it 50 litres");
    await page.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
    await send("Order milk-protein-free oat drink");
    await page
      .getByRole("heading", {
        name: "Unable to verify the mandatory dietary requirement",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Approve proposal", exact: true }).count(),
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
    await page.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
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
    await page.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
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
    await page.getByRole("heading", { name: `Order ${order}`, exact: true }).waitFor();
    await page.getByRole("heading", { name: "Items in this order (1)", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Order Activity & Lifecycle", exact: true }).waitFor();
    await page.getByText("Not provided", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("link", { name: "Back to Orders", exact: true }).getAttribute("href"),
      "/orders",
    );
    await page.getByRole("link", { name: "Back to Orders", exact: true }).click();
    await page.waitForURL(base + "/orders");
    await page.getByRole("heading", { name: "Orders", exact: true }).waitFor();
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
    await page.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
    await account();
    await page.getByText("Development tools", { exact: true }).click();
    await page.getByLabel("Quote condition", { exact: true }).selectOption("price");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Approve proposal", exact: true }).click();
    await authorizeInDialog(page, "Approve this proposal?", "Approve");
    await page
      .getByRole("region", { name: "Checkout", exact: true })
      .getByRole("button", { name: "Buy", exact: true })
      .click();
    await authorizeInDialog(page, "Record this order?", "Buy");
    await page
      .getByText("The quote changed. Prepare an updated purchase proposal.", { exact: false })
      .first()
      .waitFor();
    await page
      .getByRole("region", { name: "Checkout", exact: true })
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
  await t.test(
    "product selection stays before its proposal and becomes collapsed read-only history",
    async () => {
      const flow = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await flow.goto(base + "/buyer");
        await flow
          .getByRole("textbox", { name: "What do you need?", exact: true })
          .fill("Find milk");
        await flow.getByRole("button", { name: "Send message", exact: true }).click();
        const picker = flow.getByRole("region", { name: "Product picker", exact: true });
        await picker.getByRole("checkbox").first().check();
        await flow.evaluate(() => window.scrollTo(0, 0));
        await assertComposerPinned(flow);
        await flow.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await assertComposerPinned(flow);
        await picker
          .getByRole("button", { name: "Prepare purchase for review", exact: true })
          .click();
        const completed = flow.getByLabel("Completed product selection", { exact: true });
        await completed.getByText("Products selected", { exact: true }).waitFor();
        await flow.getByRole("button", { name: "Approve proposal", exact: true }).waitFor();
        assert.equal(await completed.getAttribute("open"), null);
        assert.equal(await picker.count(), 0);
        await completed.locator("summary").click();
        assert.equal(await completed.locator("input, button").count(), 0);
        await completed
          .getByText("This selection is read-only. Send a new message to change the purchase.", {
            exact: true,
          })
          .waitFor();
        assert(
          await flow.evaluate(() => {
            const selection = document.querySelector('[aria-label="Completed product selection"]');
            const review = [...document.querySelectorAll("button")].find(
              (el) => el.textContent === "Approve proposal",
            );
            return !!(selection.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING);
          }),
        );
        await completed.locator("summary").click();
        const input = flow.getByRole("textbox", { name: "Continue the conversation", exact: true });
        await input.fill("Why this product?");
        await input.press("Enter");
        await flow.waitForFunction(() => {
          const messages = document.querySelector('[aria-label="Conversation messages"]');
          return messages.lastElementChild?.textContent.startsWith("The recommendation uses");
        });
        await flow.reload();
        await flow.getByText("Products selected", { exact: true }).waitFor();
        assert.equal(
          await flow.getByRole("region", { name: "Product picker", exact: true }).count(),
          0,
        );
        await flow.setViewportSize({ width: 390, height: 844 });
        assert(await flow.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await flow.evaluate(() => {
          document.activeElement?.blur();
          window.scrollTo(0, 0);
        });
        await flow.screenshot({
          path: join(screenshots, "completed-product-selection-mobile.png"),
          fullPage: false,
        });
      } finally {
        await flow.close();
      }
    },
  );
  await t.test("D7–D9: shared shell, themes, actual mobile layouts and screenshots", async () => {
    const views = [
      ["assistant", conversation],
      ["restocking", restockRun],
      ["recipe", base + `/recipes/${recipe}/plan`],
      ["approval", base + `/approvals/${approval}`],
      ["settings", base + "/admin/agents/kitchen"],
      ["order", base + `/orders/${order}`],
    ];
    for (const color of ["Light", "Dark"]) {
      await theme(color);
      for (const width of [1440, 1280, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [label, url] of views) {
          await page.goto(url);
          await settle();
          await overflow();
          if (label === "assistant")
            await page.waitForFunction(() => document.querySelector("textarea").clientHeight <= 44);
          if (label === "assistant") await assertComposerPinned();
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
    // A fresh preference follows the OS; subsequent clicks save an explicit override.
    await page.evaluate(() => localStorage.removeItem("aimo-theme"));
    await page.reload();
    await settle();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.themePreference),
      "system",
    );
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
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(purchasingCalls, []);
});
