import { z } from "zod";

/** Single ingredient stock record in the customer's kitchen or canteen inventory */
export const InventoryItemSchema = z.object({
  id: z.string().meta({
    description: "Unique inventory record identifier.",
    example: "inv-cooking-cream",
  }),
  organizationId: z.string().nullable().meta({
    description: "Organization ID owning this inventory item, or null for default scope.",
    example: null,
  }),
  ingredientName: z.string().meta({
    description: "Kitchen ingredient name matched against recipe ingredients.",
    example: "Cooking cream",
  }),
  productType: z.string().meta({
    description: "General product type/category used for catalog and recipe matching.",
    example: "Cream",
  }),
  linkedProductId: z.string().nullable().meta({
    description: "Optional Valio Aimo SKU currently stocked for this ingredient.",
    example: "460501",
  }),
  quantityInStock: z.number().nonnegative().meta({
    description: "Current available stock quantity in the customer's kitchen.",
    example: 2.5,
  }),
  unit: z.string().meta({
    description: "Stock measurement unit (e.g., 'KG', 'G', 'L', 'ML').",
    example: "L",
  }),
  minParLevel: z.number().nonnegative().nullable().meta({
    description: "Minimum target par level before low-stock / reorder alerts trigger.",
    example: 5,
  }),
  location: z.string().nullable().meta({
    description: "Storage area in the restaurant or canteen.",
    example: "Walk-in Cooler A",
  }),
  updatedAt: z.iso.datetime(),
});

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/** GET /api/inventory — response body */
export const InventoryListResponseSchema = z.object({
  organizationId: z.string().nullable(),
  items: z.array(InventoryItemSchema),
});

export type InventoryListResponse = z.infer<typeof InventoryListResponseSchema>;

/** POST /api/inventory/items — create or upsert an inventory stock entry */
export const UpsertInventoryItemRequestSchema = z.object({
  id: z.string().trim().min(1).optional().meta({
    description: "Optional inventory item ID when updating a known item.",
    example: "inv-cooking-cream",
  }),
  ingredientName: z.string().trim().min(1).max(160).meta({
    description: "Ingredient name in the kitchen.",
    example: "Cooking cream",
  }),
  productType: z.string().trim().min(1).max(80).meta({
    description: "General product category or type.",
    example: "Cream",
  }),
  linkedProductId: z.string().trim().min(1).nullable().optional().meta({
    description: "Optional linked Valio Aimo product ID.",
    example: "460501",
  }),
  quantityInStock: z.number().nonnegative().meta({
    description: "Current on-hand stock quantity.",
    example: 4,
  }),
  unit: z.string().trim().min(1).max(24).meta({
    description: "Measurement unit (e.g. 'KG', 'L', 'G', 'ML').",
    example: "L",
  }),
  minParLevel: z.number().nonnegative().nullable().optional().meta({
    description: "Optional minimum target par level.",
    example: 5,
  }),
  location: z.string().trim().max(120).nullable().optional().meta({
    description: "Optional storage location.",
    example: "Walk-in Cooler A",
  }),
});

export type UpsertInventoryItemRequest = z.infer<typeof UpsertInventoryItemRequestSchema>;

/** PUT /api/inventory — replace or bulk-sync customer inventory stock */
export const ReplaceInventoryRequestSchema = z.object({
  items: z.array(UpsertInventoryItemRequestSchema).max(200).meta({
    description: "Complete list of kitchen inventory items to sync for the organization.",
  }),
});

export type ReplaceInventoryRequest = z.infer<typeof ReplaceInventoryRequestSchema>;

/** PATCH /api/inventory/items/{itemId} — adjust stock quantity or par level */
export const AdjustInventoryItemRequestSchema = z.object({
  quantityInStock: z.number().nonnegative().optional().meta({
    description: "Set an explicit absolute stock quantity.",
    example: 6,
  }),
  quantityDelta: z.number().optional().meta({
    description:
      "Signed delta to add or subtract from current quantityInStock (clamped at 0).",
    example: -1.5,
  }),
  minParLevel: z.number().nonnegative().nullable().optional().meta({
    description: "Updated minimum par level.",
    example: 5,
  }),
  location: z.string().trim().max(120).nullable().optional(),
});

export type AdjustInventoryItemRequest = z.infer<typeof AdjustInventoryItemRequestSchema>;
