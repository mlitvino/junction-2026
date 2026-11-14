import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  AdjustInventoryItemRequestSchema,
  InventoryItemSchema,
  InventoryListResponseSchema,
  ReplaceInventoryRequestSchema,
  UpsertInventoryItemRequestSchema,
} from "@/shared/contracts/inventory";

export const listInventoryRoute = createRoute({
  method: "get",
  path: "/inventory",
  tags: ["Inventory"],
  summary: "List customer kitchen/warehouse ingredient inventory",
  description:
    "Returns on-hand ingredient stock levels, par levels, and storage locations for the caller's " +
    "organization (or default restaurant/canteen inventory when unauthenticated). Used by the " +
    "recipe-to-order workflow (`actuallyNeeded = totalNeeded - inventoryStock`).",
  responses: {
    200: {
      description: "Current kitchen inventory items.",
      content: { "application/json": { schema: InventoryListResponseSchema } },
    },
  },
});

export const upsertInventoryItemRoute = createRoute({
  method: "post",
  path: "/inventory/items",
  tags: ["Inventory"],
  summary: "Create or update a single kitchen inventory item",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: UpsertInventoryItemRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Created or updated inventory item.",
      content: { "application/json": { schema: InventoryItemSchema } },
    },
  },
});

export const replaceInventoryRoute = createRoute({
  method: "put",
  path: "/inventory",
  tags: ["Inventory"],
  summary: "Replace or bulk-sync customer inventory stock",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ReplaceInventoryRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Synchronized inventory list.",
      content: { "application/json": { schema: InventoryListResponseSchema } },
    },
  },
});

export const adjustInventoryItemRoute = createRoute({
  method: "patch",
  path: "/inventory/items/{itemId}",
  tags: ["Inventory"],
  summary: "Adjust on-hand stock quantity or par level for an inventory item",
  request: {
    params: z.object({
      itemId: z.string().min(1).meta({ example: "inv-cooking-cream" }),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: AdjustInventoryItemRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated inventory item.",
      content: { "application/json": { schema: InventoryItemSchema } },
    },
    404: {
      description: "Inventory item not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
