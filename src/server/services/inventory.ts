import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { procurementInventoryItem } from "@/server/db/schema";
import type {
  AdjustInventoryItemRequest,
  InventoryItem,
  InventoryListResponse,
  ReplaceInventoryRequest,
  UpsertInventoryItemRequest,
} from "@/shared/contracts/inventory";
import type { SessionUser } from "@/shared/contracts/me";
import type { OrderLineItem } from "@/shared/contracts/orders";
import type {
  RecipeIngredient,
  RecipeIngredientReconciliation,
} from "@/shared/contracts/recipes";

export class InventoryServiceError extends Error {
  readonly status: 400 | 404;
  constructor(message: string, status: 400 | 404) {
    super(message);
    this.name = "InventoryServiceError";
    this.status = status;
  }
}

export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Normalizes kitchen quantities into standard B2B procurement units ('KG' for mass, 'L' for volume).
 */
export function normalizeQuantityAndUnit(
  quantity: number,
  rawUnit: string,
): { quantity: number; unit: string } {
  const u = rawUnit.trim().toLowerCase();
  if (u === "g" || u === "gr" || u === "gram" || u === "grams") {
    return { quantity: roundQuantity(quantity / 1000), unit: "KG" };
  }
  if (u === "kg" || u === "kilo" || u === "kilogram" || u === "kilograms") {
    return { quantity: roundQuantity(quantity), unit: "KG" };
  }
  if (
    u === "ml" ||
    u === "milliliter" ||
    u === "milliliters" ||
    u === "millilitre" ||
    u === "millilitres"
  ) {
    return { quantity: roundQuantity(quantity / 1000), unit: "L" };
  }
  if (u === "dl" || u === "deciliter" || u === "deciliters") {
    return { quantity: roundQuantity(quantity / 10), unit: "L" };
  }
  if (u === "l" || u === "lt" || u === "liter" || u === "liters" || u === "litre" || u === "litres") {
    return { quantity: roundQuantity(quantity), unit: "L" };
  }
  return { quantity: roundQuantity(quantity), unit: rawUnit.trim().toUpperCase() || "KG" };
}

const DEFAULT_INVENTORY_TIMESTAMP = "2026-11-14T08:00:00.000Z";

export const DEFAULT_MOCK_INVENTORY: Omit<InventoryItem, "organizationId">[] = [
  {
    id: "inv-salmon-fillet",
    ingredientName: "Salmon fillet",
    productType: "Fish",
    linkedProductId: "460603",
    quantityInStock: 0,
    unit: "KG",
    minParLevel: 4,
    location: "Fish Chiller",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
  {
    id: "inv-diced-potatoes",
    ingredientName: "Diced potatoes",
    productType: "Potato",
    linkedProductId: "460701",
    quantityInStock: 5,
    unit: "KG",
    minParLevel: 10,
    location: "Cold Pantry B",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
  {
    id: "inv-cooking-cream",
    ingredientName: "Cooking cream",
    productType: "Cream",
    linkedProductId: "460501",
    quantityInStock: 2.5,
    unit: "L",
    minParLevel: 5,
    location: "Walk-in Cooler A",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
  {
    id: "inv-unsalted-butter",
    ingredientName: "Unsalted butter",
    productType: "Butter",
    linkedProductId: "460401",
    quantityInStock: 0.8,
    unit: "KG",
    minParLevel: 2,
    location: "Walk-in Cooler A",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
  {
    id: "inv-sliced-leek",
    ingredientName: "Sliced leek",
    productType: "Vegetables",
    linkedProductId: "460703",
    quantityInStock: 3,
    unit: "KG",
    minParLevel: 1,
    location: "Vegetable Cooler",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
  {
    id: "inv-fresh-dill",
    ingredientName: "Fresh dill",
    productType: "Herbs",
    linkedProductId: "460801",
    quantityInStock: 0.05,
    unit: "KG",
    minParLevel: 0.2,
    location: "Herb Fridge",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
  {
    id: "inv-whipping-cream",
    ingredientName: "Heavy whipping cream",
    productType: "Cream",
    linkedProductId: "460502",
    quantityInStock: 0.5,
    unit: "L",
    minParLevel: 3,
    location: "Walk-in Cooler A",
    updatedAt: DEFAULT_INVENTORY_TIMESTAMP,
  },
];

const DEFAULT_SCOPE_KEY = "__default__";
const fallbackInventoryStore = new Map<string, InventoryItem[]>();

function defaultInventoryForOrg(organizationId: string | null): InventoryItem[] {
  return DEFAULT_MOCK_INVENTORY.map((item) => ({
    ...item,
    organizationId,
  }));
}

function rowToInventoryItem(
  row: typeof procurementInventoryItem.$inferSelect,
): InventoryItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ingredientName: row.ingredientName,
    productType: row.productType,
    linkedProductId: row.linkedProductId,
    quantityInStock: row.quantityInStock,
    unit: row.unit,
    minParLevel: row.minParLevel,
    location: row.location,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Lists active customer inventory items for the caller's organization (or default mock kitchen). */
export async function listInventory(
  actor?: SessionUser | null,
): Promise<InventoryListResponse> {
  const orgId = actor?.organization.id ?? null;

  if (orgId && process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const rows = await db
        .select()
        .from(procurementInventoryItem)
        .where(eq(procurementInventoryItem.organizationId, orgId))
        .orderBy(asc(procurementInventoryItem.ingredientName));

      if (rows.length > 0) {
        return {
          organizationId: orgId,
          items: rows.map(rowToInventoryItem),
        };
      }
    } catch {
      // Fall back to in-memory/default kitchen inventory below.
    }
  }

  const key = orgId ?? DEFAULT_SCOPE_KEY;
  const current = fallbackInventoryStore.get(key) ?? defaultInventoryForOrg(orgId);
  return {
    organizationId: orgId,
    items: structuredClone(current),
  };
}

/** Upserts a single ingredient stock entry into the customer's inventory. */
export async function upsertInventoryItem(
  input: UpsertInventoryItemRequest,
  actor?: SessionUser | null,
): Promise<InventoryItem> {
  const orgId = actor?.organization.id ?? null;
  const key = orgId ?? DEFAULT_SCOPE_KEY;
  const currentList = (await listInventory(actor)).items;
  const now = new Date();
  const normalized = normalizeQuantityAndUnit(input.quantityInStock, input.unit);

  const existingIndex = currentList.findIndex(
    (it) =>
      (input.id && it.id === input.id) ||
      it.ingredientName.trim().toLowerCase() === input.ingredientName.trim().toLowerCase(),
  );

  const existing = existingIndex >= 0 ? currentList[existingIndex] : undefined;
  const itemId =
    input.id ??
    existing?.id ??
    `inv-${randomUUID().slice(0, 8).toLowerCase()}`;

  const record: InventoryItem = {
    id: itemId,
    organizationId: orgId,
    ingredientName: input.ingredientName.trim(),
    productType: input.productType.trim(),
    linkedProductId:
      input.linkedProductId !== undefined
        ? input.linkedProductId
        : (existing?.linkedProductId ?? null),
    quantityInStock: normalized.quantity,
    unit: normalized.unit,
    minParLevel:
      input.minParLevel !== undefined ? input.minParLevel : (existing?.minParLevel ?? null),
    location: input.location !== undefined ? input.location : (existing?.location ?? null),
    updatedAt: now.toISOString(),
  };

  if (existingIndex >= 0) {
    currentList[existingIndex] = record;
  } else {
    currentList.push(record);
  }
  fallbackInventoryStore.set(key, currentList);

  if (orgId && process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      await db
        .insert(procurementInventoryItem)
        .values({
          id: record.id,
          organizationId: orgId,
          ingredientName: record.ingredientName,
          productType: record.productType,
          linkedProductId: record.linkedProductId,
          quantityInStock: record.quantityInStock,
          unit: record.unit,
          minParLevel: record.minParLevel,
          location: record.location,
          updatedByUserId: actor?.id ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: procurementInventoryItem.id,
          set: {
            ingredientName: record.ingredientName,
            productType: record.productType,
            linkedProductId: record.linkedProductId,
            quantityInStock: record.quantityInStock,
            unit: record.unit,
            minParLevel: record.minParLevel,
            location: record.location,
            updatedByUserId: actor?.id ?? null,
            updatedAt: now,
          },
        });
    } catch {
      // Keep in-memory state if DB write fails.
    }
  }

  return record;
}

/** Replaces the organization's inventory stock snapshot in bulk. */
export async function replaceInventory(
  input: ReplaceInventoryRequest,
  actor?: SessionUser | null,
): Promise<InventoryListResponse> {
  const orgId = actor?.organization.id ?? null;
  const key = orgId ?? DEFAULT_SCOPE_KEY;
  const now = new Date();

  const nextItems: InventoryItem[] = input.items.map((item) => {
    const normalized = normalizeQuantityAndUnit(item.quantityInStock, item.unit);
    return {
      id: item.id ?? `inv-${randomUUID().slice(0, 8).toLowerCase()}`,
      organizationId: orgId,
      ingredientName: item.ingredientName.trim(),
      productType: item.productType.trim(),
      linkedProductId: item.linkedProductId ?? null,
      quantityInStock: normalized.quantity,
      unit: normalized.unit,
      minParLevel: item.minParLevel ?? null,
      location: item.location ?? null,
      updatedAt: now.toISOString(),
    };
  });

  fallbackInventoryStore.set(key, nextItems);

  if (orgId && process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      await db
        .delete(procurementInventoryItem)
        .where(eq(procurementInventoryItem.organizationId, orgId));

      if (nextItems.length > 0) {
        await db.insert(procurementInventoryItem).values(
          nextItems.map((it) => ({
            id: it.id,
            organizationId: orgId,
            ingredientName: it.ingredientName,
            productType: it.productType,
            linkedProductId: it.linkedProductId,
            quantityInStock: it.quantityInStock,
            unit: it.unit,
            minParLevel: it.minParLevel,
            location: it.location,
            updatedByUserId: actor?.id ?? null,
            updatedAt: now,
          })),
        );
      }
    } catch {
      // Keep in-memory fallback.
    }
  }

  return {
    organizationId: orgId,
    items: nextItems,
  };
}

/** Adjusts stock quantity or par level for an existing inventory item. */
export async function adjustInventoryItem(
  itemId: string,
  input: AdjustInventoryItemRequest,
  actor?: SessionUser | null,
): Promise<InventoryItem> {
  const orgId = actor?.organization.id ?? null;
  const key = orgId ?? DEFAULT_SCOPE_KEY;
  const currentList = (await listInventory(actor)).items;
  const idx = currentList.findIndex((it) => it.id === itemId);

  if (idx < 0) {
    throw new InventoryServiceError(`Inventory item '${itemId}' not found.`, 404);
  }

  const existing = currentList[idx]!;
  let nextQty = existing.quantityInStock;
  if (input.quantityInStock !== undefined) {
    nextQty = input.quantityInStock;
  } else if (input.quantityDelta !== undefined) {
    nextQty = Math.max(0, roundQuantity(existing.quantityInStock + input.quantityDelta));
  }

  const now = new Date();
  const updated: InventoryItem = {
    ...existing,
    quantityInStock: roundQuantity(nextQty),
    minParLevel: input.minParLevel !== undefined ? input.minParLevel : existing.minParLevel,
    location: input.location !== undefined ? input.location : existing.location,
    updatedAt: now.toISOString(),
  };

  currentList[idx] = updated;
  fallbackInventoryStore.set(key, currentList);

  if (orgId && process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      await db
        .update(procurementInventoryItem)
        .set({
          quantityInStock: updated.quantityInStock,
          minParLevel: updated.minParLevel,
          location: updated.location,
          updatedByUserId: actor?.id ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(procurementInventoryItem.id, itemId),
            eq(procurementInventoryItem.organizationId, orgId),
          ),
        );
    } catch {
      // Keep in-memory update.
    }
  }

  return updated;
}

/** Replenishes kitchen inventory stock when a checked-out order specifies `replenishInventory: true`. */
export async function replenishInventoryFromOrderLines(
  lines: OrderLineItem[],
  actor?: SessionUser | null,
): Promise<void> {
  const current = (await listInventory(actor)).items;
  for (const line of lines) {
    const normalized = normalizeQuantityAndUnit(line.quantity, line.unit);
    const match = current.find(
      (it) =>
        it.linkedProductId === line.productId ||
        it.ingredientName.trim().toLowerCase() === line.requestedProductName.trim().toLowerCase(),
    );
    if (match) {
      await adjustInventoryItem(
        match.id,
        { quantityDelta: normalized.quantity },
        actor,
      );
    } else {
      await upsertInventoryItem(
        {
          ingredientName: line.requestedProductName,
          productType: line.productType,
          linkedProductId: line.productId,
          quantityInStock: normalized.quantity,
          unit: normalized.unit,
        },
        actor,
      );
    }
  }
}

function tokenizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9äöå]+/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function ingredientMatchesInventoryItem(
  ingredientName: string,
  productType: string,
  normalizedUnit: string,
  inv: InventoryItem,
): boolean {
  const invNorm = normalizeQuantityAndUnit(inv.quantityInStock, inv.unit);
  if (invNorm.unit !== normalizedUnit) return false;

  const ingLower = ingredientName.trim().toLowerCase();
  const invLower = inv.ingredientName.trim().toLowerCase();
  if (ingLower === invLower) return true;
  if (ingLower.includes(invLower) || invLower.includes(ingLower)) return true;

  const typeCompat =
    productType.trim().toLowerCase() === inv.productType.trim().toLowerCase() ||
    productType.trim().toLowerCase().includes(inv.productType.trim().toLowerCase()) ||
    inv.productType.trim().toLowerCase().includes(productType.trim().toLowerCase());

  if (!typeCompat) return false;

  const ingTokens = tokenizeWords(ingLower);
  const invTokens = tokenizeWords(invLower);
  if (ingTokens.length === 0 || invTokens.length === 0) return false;

  let overlap = 0;
  for (const t of ingTokens) {
    if (invTokens.some((it) => it === t || it.startsWith(t) || t.startsWith(it))) {
      overlap += 1;
    }
  }
  return overlap / Math.min(ingTokens.length, invTokens.length) >= 0.6;
}

/**
 * User Story 2 Steps 2 & 3:
 * 1. Aggregates duplicate recipe ingredients in normalized units ('KG' / 'L').
 * 2. Scales each item by `scaleFactor` to compute `totalNeededQuantity`.
 * 3. Subtracts matching on-hand `inventoryStockQuantity` to compute `actuallyNeededQuantity`.
 */
export function reconcileRecipeIngredientsWithInventory(params: {
  ingredients: RecipeIngredient[];
  scaleFactor: number;
  inventory: InventoryItem[];
}): RecipeIngredientReconciliation[] {
  const { ingredients, scaleFactor, inventory } = params;

  // Step 2a: Aggregate duplicate ingredients by (lowercased productName + normalized unit)
  const aggregatedMap = new Map<
    string,
    {
      productName: string;
      productType: string;
      normalizedUnit: string;
      aggregatedBaseQuantity: number;
    }
  >();

  for (const ing of ingredients) {
    const norm = normalizeQuantityAndUnit(ing.quantity, ing.unit);
    const key = `${ing.productName.trim().toLowerCase()}::${norm.unit}`;
    const existing = aggregatedMap.get(key);
    if (existing) {
      existing.aggregatedBaseQuantity = roundQuantity(
        existing.aggregatedBaseQuantity + norm.quantity,
      );
    } else {
      aggregatedMap.set(key, {
        productName: ing.productName.trim(),
        productType: ing.productType.trim(),
        normalizedUnit: norm.unit,
        aggregatedBaseQuantity: norm.quantity,
      });
    }
  }

  // Track remaining available stock per inventory item so shared stock is never double-counted
  const remainingStockById = new Map<string, number>();
  for (const inv of inventory) {
    const norm = normalizeQuantityAndUnit(inv.quantityInStock, inv.unit);
    remainingStockById.set(inv.id, norm.quantity);
  }

  const results: RecipeIngredientReconciliation[] = [];

  for (const item of aggregatedMap.values()) {
    const totalNeededQuantity = roundQuantity(item.aggregatedBaseQuantity * scaleFactor);
    const matchedIds: string[] = [];
    let allocatedStock = 0;

    for (const inv of inventory) {
      if (
        ingredientMatchesInventoryItem(
          item.productName,
          item.productType,
          item.normalizedUnit,
          inv,
        )
      ) {
        matchedIds.push(inv.id);
        const avail = remainingStockById.get(inv.id) ?? 0;
        if (avail > 0) {
          allocatedStock = roundQuantity(allocatedStock + avail);
          const consumed = Math.min(avail, Math.max(0, totalNeededQuantity - (allocatedStock - avail)));
          remainingStockById.set(inv.id, roundQuantity(avail - consumed));
        }
      }
    }

    const actuallyNeededQuantity = Math.max(
      0,
      roundQuantity(totalNeededQuantity - allocatedStock),
    );

    results.push({
      productName: item.productName,
      productType: item.productType,
      normalizedUnit: item.normalizedUnit,
      aggregatedBaseQuantity: item.aggregatedBaseQuantity,
      totalNeededQuantity,
      inventoryStockQuantity: allocatedStock,
      actuallyNeededQuantity,
      coveredByInventory: actuallyNeededQuantity <= 0,
      matchedInventoryItemIds: matchedIds,
    });
  }

  return results;
}
