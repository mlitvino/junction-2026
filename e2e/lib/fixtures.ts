// Shared setup for the e2e scenarios: unique names per run, an organization with three members,
// preference helpers, dates and orderable products from the real (imported) catalog.
import assert from "node:assert/strict";

import { MeResponseSchema } from "@/shared/contracts/me";
import { MemberSchema } from "@/shared/contracts/organization";
import type { PreferencesLayerValues } from "@/shared/contracts/preferences";
import { LayerSchema } from "@/shared/contracts/preferences";
import { OffersResponseSchema, ProductSearchResponseSchema } from "@/shared/contracts/products";

import { ok, PASSWORD, Session } from "./client.ts";

/** Prefix of every user this test process creates; cleanup deletes by it. */
export const RUN = `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;

let counter = 0;
/** A unique username for this run (≤ 30 chars: Better Auth's limit). */
export function username(tag: string): string {
  return `${RUN}_${tag}${++counter}`.slice(0, 30);
}

/** YYYY-MM-DD in Helsinki, `days` from today: the delivery date the scenarios order for. */
export function deliveryDate(days = 3): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date(Date.now() + days * 86_400_000));
}

export type Org = {
  /** Signed up: buyer + approver of a new organization. */
  owner: Session;
  /** Created by the owner: buyer only. */
  buyer: Session;
  /** Created by the owner: approver only. */
  approver: Session;
  organizationId: string;
  buyerId: string;
  approverId: string;
};

/** Signs up an owner and lets them create a buyer-only and an approver-only colleague. */
export async function newOrg(tag = "org"): Promise<Org> {
  const owner = await new Session(`${tag}-owner`).signUp(username(`${tag}o`));
  const me = ok(await owner.get("/api/me"), 200, MeResponseSchema, "owner /api/me");

  const member = async (role: "buyer" | "approver") => {
    const name = username(`${tag}${role[0]}`);
    const created = ok(
      await owner.post("/api/organization/members", { username: name, password: PASSWORD, roles: [role] }),
      201,
      MemberSchema,
      `create ${role}`,
    );
    const session = await new Session(`${tag}-${role}`).signIn(name);
    return { session, id: created.userId };
  };
  const buyer = await member("buyer");
  const approver = await member("approver");
  return {
    owner,
    buyer: buyer.session,
    approver: approver.session,
    organizationId: me.user.organization.id,
    buyerId: buyer.id,
    approverId: approver.id,
  };
}

/** Replaces a preference layer (approver session). */
export async function setLayer(
  approver: Session,
  scope: "base" | "buyer" | "approver",
  values: PreferencesLayerValues,
  locked?: string[],
) {
  return ok(
    await approver.put(`/api/preferences/layers/${scope}`, { values, ...(locked ? { locked } : {}) }),
    200,
    LayerSchema,
    `set ${scope} preferences`,
  );
}

export type Pick = {
  id: string;
  name: string;
  salesUnit: string;
  unitPriceExclVat: number;
  allergens: string[];
  contentPerSalesUnit: { value: number; unit: "L" | "KG" } | null;
};

let picked: Pick[] | undefined;

/**
 * Products that can be ordered for `date` without availability rules firing: priced, orderable,
 * deliverable by the date and (when known) in stock for `quantity`. From a "milk" search, so at
 * least one contains milk (GS1 "ML"). Fails with a hint when the catalog is empty.
 */
export async function orderableProducts(session: Session, date: string, quantity = 5): Promise<Pick[]> {
  if (picked) return picked;
  const search = ok(await session.get("/api/products?q=milk&limit=40"), 200, ProductSearchResponseSchema, "search milk");
  assert.ok(search.items.length > 0, "The catalog has no milk products: run `pnpm data:import` first.");
  const offers = ok(
    await session.post("/api/offers", { productIds: search.items.map((p) => p.id), date }),
    200,
    OffersResponseSchema,
    "offers for milk products",
  );
  const byId = new Map(search.items.map((p) => [p.id, p]));
  picked = offers.offers.flatMap((o) => {
    const p = byId.get(o.productId);
    const a = o.availability;
    const fine =
      p &&
      o.price?.found &&
      o.price.priceExclVat !== null &&
      a?.orderable &&
      !a.salesBlock &&
      (!a.availableDate || a.availableDate.slice(0, 10) <= date) &&
      (a.availableQuantity === null || a.availableQuantity >= quantity);
    return fine
      ? [
          {
            id: p.id,
            name: p.name,
            salesUnit: p.salesUnit,
            unitPriceExclVat: o.price!.priceExclVat!,
            allergens: p.allergens,
            contentPerSalesUnit: p.contentPerSalesUnit,
          },
        ]
      : [];
  });
  assert.ok(picked.length >= 2, `Need at least 2 orderable milk products for ${date}, found ${picked.length}.`);
  return picked;
}
