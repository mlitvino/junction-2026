// Optional browser harness; Playwright can be supplied externally without a repo dependency.
// PLAYWRIGHT_MODULE_PATH=<absolute installed playwright directory> pnpm exec node --test <this file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = process.env.FRONTEND_BASE_URL || "http://localhost:3001";
const storageKey = "aimo-procurement-demo-v1";
const shots = join(tmpdir(), "aimo-procurement-browser-qa");
mkdirSync(shots, { recursive: true });

test("procurement browser workflow", async (t) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = [],
    businessCalls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1")) businessCalls.push(request.url());
  });
  const read = () => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
  async function waitDone() {
    await page.waitForFunction(
      (key) => JSON.parse(sessionStorage.getItem(key))?.conversations.at(-1)?.status === "DONE",
      storageKey,
    );
  }
  async function chooseRole(role) {
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await page.getByLabel("Demo identity (UI simulation)", { exact: true }).selectOption(role);
    await page.keyboard.press("Escape");
  }
  async function runScenario(name) {
    await page.goto(base + "/buyer");
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Send demo request", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await waitDone();
    return page.url();
  }
  async function chooseTheme(theme) {
    await page.getByRole("button", { name: "Choose theme", exact: true }).click();
    await page.getByRole("radio", { name: theme, exact: true }).check();
    await page.keyboard.press("Escape");
  }
  async function noOverflow() {
    // PPR may temporarily retain hidden streamed Suspense fragments in the DOM.
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      header: [...document.querySelectorAll("header")].filter((e) => e.checkVisibility()).length,
      main: [...document.querySelectorAll("main")].filter((e) => e.checkVisibility()).length,
      h1: [...document.querySelectorAll("h1")].filter((e) => e.checkVisibility()).length,
    }));
    assert(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
    assert.equal(dimensions.header, 1, `headers at ${page.url()}: ${JSON.stringify(dimensions)}`);
    assert.equal(dimensions.main, 1, `main at ${page.url()}: ${JSON.stringify(dimensions)}`);
    assert.equal(dimensions.h1, 1, `h1 at ${page.url()}: ${JSON.stringify(dimensions)}`);
  }

  if (process.env.WORKFLOW_TEST_MODE === "unavailable") {
    for (const route of [
      "/buyer",
      "/approvals",
      "/orders",
      "/proposals/missing",
      "/approvals/missing",
      "/orders/missing",
    ]) {
      await page.goto(base + route);
      await page
        .getByRole("heading", { name: "Procurement integration unavailable", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Send demo request", exact: true }).count(),
        0,
      );
      assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
    }
    assert.deepEqual(businessCalls, []);
    assert.deepEqual(errors, []);
    return;
  }

  let autoConversation, approvalUrl, orderUrl, proposalUrl;
  await t.test("autonomous purchase and persistent order detail", async () => {
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "No simulated orders yet" }).waitFor();
    autoConversation = await runScenario("Within the demo limit");
    const data = await read();
    assert.equal(data.orders.length, 1);
    orderUrl = base + `/orders/${data.orders[0].id}`;
    proposalUrl = base + `/proposals/${data.proposals[0].id}`;
    await page.getByRole("link", { name: "View simulated order", exact: true }).click();
    await page.getByRole("heading", { name: "Your simulated order", exact: true }).waitFor();
    assert((await page.locator("main").innerText()).includes("has not been submitted to Valio"));
    await page.reload();
    assert.equal((await read()).orders.length, 1);
    await page.getByRole("heading", { name: "Activity history", exact: true }).waitFor();
  });

  await t.test("request, inbox, approval and buyer share one state in the same tab", async () => {
    const conversationUrl = await runScenario("Manager approval needed");
    assert.equal((await read()).orders.length, 1);
    await page.getByRole("button", { name: "Send for demo approval", exact: true }).click();
    const approval = (await read()).approvals[0];
    approvalUrl = base + `/approvals/${approval.id}`;
    await page.getByRole("link", { name: "View demo approval", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "Approve demo purchase", exact: true }).count(),
      0,
    );
    await chooseRole("APPROVER");
    await page.goto(base + "/approvals");
    await page.getByRole("button", { name: "Pending (1)", exact: true }).waitFor();
    await page.locator(`main a[href="/approvals/${approval.id}"]`).click();
    await page.getByRole("button", { name: "Approve demo purchase", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Approve this demo purchase?", exact: true })
      .getByRole("button", { name: "Approve and simulate order", exact: true })
      .click();
    await page.getByRole("link", { name: "Open resulting simulated order", exact: true }).waitFor();
    assert.equal((await read()).orders.length, 2);
    await page.reload();
    assert.equal((await read()).orders.length, 2);
    await page.goto(conversationUrl);
    await page.getByRole("link", { name: "View simulated order", exact: true }).waitFor();
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "Orders", exact: true }).waitFor();
    await page.locator("main li").first().waitFor();
    assert.equal(await page.locator("main li").count(), 2);
  });

  await t.test("rejection with required reason creates no order", async () => {
    await chooseRole("BUYER");
    await runScenario("Manager approval needed");
    await page.getByRole("button", { name: "Send for demo approval", exact: true }).click();
    await page.getByRole("link", { name: "View demo approval", exact: true }).click();
    await chooseRole("APPROVER");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Reject request", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reject this demo request?", exact: true });
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await dialog.getByRole("button", { name: "Reject demo request", exact: true }).click();
    assert(await dialog.isVisible());
    await dialog.getByLabel("Reason for rejection", { exact: true }).fill("Menu plan changed.");
    await dialog.getByRole("button", { name: "Reject demo request", exact: true }).click();
    await page.getByRole("heading", { name: "Decision note", exact: true }).waitFor();
    assert.equal((await read()).orders.length, 2);
    assert.equal((await read()).approvals.at(-1).status, "REJECTED");
    assert.equal(
      await page.getByRole("button", { name: "Approve demo purchase", exact: true }).count(),
      0,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await t.test(
    "unverified constraints remain blocked; alternatives and evidence expand",
    async () => {
      await chooseRole("BUYER");
      await runScenario("A requirement cannot be verified");
      assert.equal((await read()).orders.length, 2);
      await page.getByText("Purchase blocked", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Send for demo approval", exact: true }).count(),
        0,
      );
      await page.getByText("Compare alternatives (1)", { exact: true }).click();
      await page
        .getByRole("heading", { name: "Barista oat drink, 1 litre", exact: true })
        .waitFor();
      await page
        .getByText("Why this product? View fixture evidence", { exact: true })
        .first()
        .click();
      assert(
        (await page.locator("main").innerText()).includes(
          "No live price, stock, allergen or supplier validation",
        ),
      );
    },
  );

  await t.test("unsupported requests are transparent and preserve the editable draft", async () => {
    const before = (await read()).conversations.length;
    await page.goto(base + "/buyer");
    await page.getByRole("button", { name: /Within the demo limit/ }).click();
    await page
      .getByLabel("Your request", { exact: true })
      .fill("Find something outside the configured scenarios");
    await page.getByRole("button", { name: "Send demo request", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "This request is not configured" }).waitFor();
    assert.equal((await read()).conversations.length, before);
    assert.equal(
      await page.getByLabel("Your request", { exact: true }).inputValue(),
      "Find something outside the configured scenarios",
    );
  });

  await t.test("refresh interrupts a running request without completing a purchase", async () => {
    await page.goto(base + "/buyer");
    await page.getByRole("button", { name: /Within the demo limit/ }).click();
    await page.getByRole("button", { name: "Send demo request", exact: true }).click();
    await page.waitForURL(/\/buyer\/conversations\//);
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "interrupted by a refresh" }).waitFor();
    await page.waitForTimeout(2200);
    assert.equal((await read()).orders.length, 2);
    assert.equal((await read()).conversations.at(-1).status, "INTERRUPTED");
    await page.getByRole("link", { name: "Start a new demo request", exact: true }).click();
    await page.getByRole("heading", { name: "What can I help you order?", exact: true }).waitFor();
  });

  await t.test("shared shell, themes, responsive layouts and keyboard controls", async () => {
    for (const theme of ["Light", "Dark"]) {
      await chooseTheme(theme);
      for (const width of [1440, 1280, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const url of [
          autoConversation,
          proposalUrl,
          approvalUrl,
          orderUrl,
          base + "/orders",
        ]) {
          await page.goto(url);
          await page.getByRole("heading", { level: 1 }).waitFor();
          await noOverflow();
          assert.equal(
            await page.locator("html").evaluate((e) => e.classList.contains("dark")),
            theme === "Dark",
          );
        }
        await page.goto(autoConversation);
        await page.screenshot({
          path: join(shots, `conversation-${theme.toLowerCase()}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.goto(approvalUrl);
    await chooseRole("APPROVER");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert(await page.getByRole("dialog", { name: "Navigation", exact: true }).isVisible());
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Choose theme", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("radio", { name: "System", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  });

  await t.test("missing local resource has an explicit empty state", async () => {
    await page.goto(base + "/orders/not-in-local-demo");
    await page
      .getByRole("heading", { name: "Order not found in this demo", exact: true })
      .waitFor();
  });
  await t.test("reset confirmation cancels safely and then clears local demo state", async () => {
    const before = (await read()).orders.length;
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await page.getByRole("button", { name: "Reset local demo", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reset local demo?", exact: true });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await read()).orders.length, before);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await page.getByRole("button", { name: "Reset local demo", exact: true }).click();
    await dialog.getByRole("button", { name: "Reset demo", exact: true }).click();
    await page.waitForFunction(
      (key) => JSON.parse(sessionStorage.getItem(key)).orders.length === 0,
      storageKey,
    );
    assert.equal((await read()).conversations.length, 0);
    await page.goto(base + "/buyer");
    await page.getByRole("heading", { name: "What can I help you order?", exact: true }).waitFor();
  });
  assert.deepEqual(businessCalls, []);
  assert.deepEqual(errors, []);
});
