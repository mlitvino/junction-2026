import "server-only";

import {
  adjustInventoryItem,
  InventoryServiceError,
  listInventory,
  replaceInventory,
  upsertInventoryItem,
} from "@/server/services/inventory";
import {
  InventoryItemSchema,
  InventoryListResponseSchema,
} from "@/shared/contracts/inventory";

import { resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  adjustInventoryItemRoute,
  listInventoryRoute,
  replaceInventoryRoute,
  upsertInventoryItemRoute,
} from "./inventory.docs";

export const inventoryRouter = createRouter()
  .openapi(listInventoryRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await listInventory(actor);
    return c.json(InventoryListResponseSchema.parse(result), 200);
  })
  .openapi(upsertInventoryItemRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const item = await upsertInventoryItem(c.req.valid("json"), actor);
    return c.json(InventoryItemSchema.parse(item), 200);
  })
  .openapi(replaceInventoryRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await replaceInventory(c.req.valid("json"), actor);
    return c.json(InventoryListResponseSchema.parse(result), 200);
  })
  .openapi(adjustInventoryItemRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const updated = await adjustInventoryItem(
        c.req.valid("param").itemId,
        c.req.valid("json"),
        actor,
      );
      return c.json(InventoryItemSchema.parse(updated), 200);
    } catch (err) {
      if (err instanceof InventoryServiceError && err.status === 404) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });
