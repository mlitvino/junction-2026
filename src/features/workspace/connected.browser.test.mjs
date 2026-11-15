// Run against a connected build and a local backend with imported catalog data.
// Uses disposable QA organizations/accounts. No supplier dispatch or payment is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = process.env.FRONTEND_BASE_URL || "http://localhost:3001";

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

test("connected canonical purchasing across Buyer and Approver browser contexts", async (t) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const buyer = await browser.newContext(),
    approver = await browser.newContext();
  const page = await buyer.newPage(),
    review = await approver.newPage();
  page.setDefaultTimeout(15000);
  review.setDefaultTimeout(15000);
  const errors = [];
  for (const p of [page, review]) p.on("pageerror", (e) => errors.push(e.message));
  assert.equal((await buyer.request.get(base + "/api/me")).status(), 401);
  await page.goto(base + "/buyer");
  await page.waitForURL(/\/login/);
  const suffix = Date.now().toString(36),
    username = `qa32_${suffix}`,
    colleague = `qa32_a_${suffix}`;
  const password = crypto.randomUUID() + "Aa1!";
  const signup = await buyer.request.post(base + "/api/auth/sign-up/email", {
    headers: { Origin: base },
    data: { username, name: username, email: username + "@users.invalid", password },
  });
  assert.equal(signup.status(), 200, "Local backend signup must work for this integration test");
  const me = await (await buyer.request.get(base + "/api/me")).json();
  const member = await buyer.request.post(base + "/api/organization/members", {
    data: { username: colleague, password, roles: ["approver"] },
  });
  assert.equal(member.status(), 201);
  const roles = await buyer.request.put(base + `/api/organization/members/${me.user.id}/roles`, {
    data: { roles: ["buyer"] },
  });
  assert.equal(roles.status(), 200);
  const login = await approver.request.post(base + "/api/auth/sign-in/username", {
    headers: { Origin: base },
    data: { username: colleague, password },
  });
  assert.equal(login.status(), 200);

  await page.goto(base + "/buyer/products");
  await page.getByLabel("Search products", { exact: true }).fill("maito");
  await page.getByRole("checkbox").first().waitFor();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Check prices & conditions", exact: true }).click();
  await page.getByText(/Human approval required\./).waitFor();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/proposals") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Prepare purchase for review", exact: true }).click();
  const created = await (await response).json();
  assert.equal(created.status, "READY");
  await page.waitForURL(/\/buyer\/conversations\//);
  await page.getByText("Waiting for another authorized approver.", { exact: false }).waitFor();
  const pending = await (await buyer.request.get(base + `/api/proposals/${created.id}`)).json();
  assert.equal(pending.status, "PENDING_APPROVAL");
  assert.equal((await buyer.request.get(base + "/api/orders")).status(), 200);
  assert.equal((await (await buyer.request.get(base + "/api/orders")).json()).items.length, 0);

  await review.goto(base + "/approvals");
  await review.getByRole("link", { name: "Review purchase", exact: true }).click();
  await review.waitForURL(base + `/approvals/${pending.approval.id}`);
  await review.getByRole("button", { name: "Discuss in assistant", exact: true }).click();
  await review.waitForURL(/\/buyer\/conversations\//);
  await review
    .getByRole("textbox", { name: "Continue the conversation", exact: true })
    .fill("Why this product?");
  await review.getByRole("button", { name: "Send message", exact: true }).click();
  await review
    .getByText("This explanation does not change your proposal.", { exact: false })
    .waitFor();
  assert.equal(
    (await (await approver.request.get(base + `/api/proposals/${created.id}`)).json()).hash,
    pending.hash,
  );
  await review.goto(base + `/approvals/${pending.approval.id}`);
  await review.getByRole("button", { name: "Approve proposal", exact: true }).click();
  await authorizeInDialog(review, "Approve this proposal?", "Approve");
  await review.getByText("Approved", { exact: true }).first().waitFor();
  const approved = await (await buyer.request.get(base + `/api/proposals/${created.id}`)).json();
  assert.equal(approved.hash, pending.hash);
  assert.equal(approved.approval.status, "APPROVED");
  await page.reload();
  await page.getByRole("region", { name: "Checkout", exact: true }).waitFor();
  await page
    .getByRole("region", { name: "Checkout", exact: true })
    .getByRole("button", { name: "Buy", exact: true })
    .click();
  await authorizeInDialog(page, "Record this order?", "Buy");
  await page.getByRole("link", { name: "View order details", exact: true }).waitFor();
  const orders = await (await buyer.request.get(base + "/api/orders")).json();
  assert.equal(orders.items.length, 1);
  const order = orders.items[0];
  assert.equal(order.proposalId, created.id);
  assert.equal(order.proposalHash, pending.hash);
  assert.equal(order.totalExclVat, pending.totalExclVat);
  assert.equal(order.source, "LOCAL_SIMULATOR");
  const replay = await buyer.request.post(base + `/api/proposals/${created.id}/order`, {
    data: { idempotencyKey: order.idempotencyKey },
  });
  assert.equal((await replay.json()).id, order.id);
  await page.reload();
  assert.equal((await (await buyer.request.get(base + "/api/orders")).json()).items.length, 1);
  await page.getByRole("region", { name: "Checkout", exact: true }).waitFor();
  await page.getByRole("link", { name: "View order details", exact: true }).click();
  await page.getByRole("heading", { name: `Order ${order.id}`, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("aimo:v32:records")), null);
  const presentation = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("aimo:v32:connected:presentation")),
  );
  assert(!Object.hasOwn(presentation, "orders"));
  assert(!Object.hasOwn(presentation, "proposals"));

  for (const path of ["/api/preferences/effective", "/api/inventory", "/api/recipes"])
    assert.equal((await buyer.request.get(base + path)).status(), 200, path);
  await review.goto(base + "/admin/agents/kitchen");
  await review.getByRole("button", { name: "Save purchasing settings", exact: true }).click();
  await review.getByText("Settings saved", { exact: false }).waitFor();
  await review.goto(base + "/admin/organization");
  await review.getByRole("heading", { name: username, exact: true }).waitFor();
  const buyerCard = review
    .locator("section")
    .filter({ has: review.getByRole("heading", { name: username, exact: true }) })
    .last();
  await buyerCard.getByRole("checkbox", { name: "Approver", exact: true }).check();
  await buyerCard.getByRole("button", { name: "Save roles", exact: true }).click();
  await review.getByText("Member roles updated.", { exact: true }).waitFor();
  await page.goto(base + "/recipes/new");
  const recipeName = `QA kitchen recipe ${suffix}`;
  await page.getByLabel("Recipe name", { exact: true }).fill(recipeName);
  await page.getByRole("textbox", { name: "Ingredient 1", exact: true }).fill("Onion");
  await page.getByRole("button", { name: "Create recipe", exact: true }).click();
  await page.getByRole("heading", { name: recipeName, exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit recipe", exact: true }).click();
  await page.getByRole("button", { name: "Save draft locally", exact: true }).click();
  await page.getByText("Draft saved in this browser.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Create separate recipe version", exact: true }).click();
  await page.getByRole("heading", { name: `${recipeName} — new version`, exact: true }).waitFor();
  await page.goto(base + "/restocking/inventory");
  await page.getByText("Add kitchen stock", { exact: true }).click();
  await page.getByLabel("Stock ingredient", { exact: true }).fill("QA onion");
  await page.getByLabel("Initial on-hand quantity", { exact: true }).fill("8");
  await page.getByLabel("Minimum stock level", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Add stock snapshot", exact: true }).click();
  await page.getByRole("heading", { name: "QA onion", exact: true }).waitFor();
  const stockCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "QA onion", exact: true }) })
    .last();
  await stockCard.getByLabel("On-hand quantity", { exact: true }).fill("10");
  const adjusted = page.waitForResponse(
    (r) => r.url().includes("/api/inventory/items/") && r.request().method() === "PATCH",
  );
  await stockCard.getByRole("button", { name: "Update stock snapshot", exact: true }).click();
  assert.equal((await (await adjusted).json()).quantityInStock, 10);
  assert.deepEqual(errors, []);
});
