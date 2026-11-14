import { z } from "zod";

import { SettingKeySchema } from "./preferences";
import { DataSourceSchema } from "./products";

// Policy check: applies the organization's buyer preferences to a draft order and decides
// ALLOW / REQUIRE_APPROVAL / DENY with reasons. The client sends products and quantities only;
// the server prices them itself. Amounts are EUR excluding VAT, like the preferences.

const productId = z.string().min(1).meta({ description: "Valio product code.", example: "469330" });

export const PolicyEvaluateRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        productId,
        quantity: z.number().positive().meta({
          description: "How many of the product's sales unit (e.g. cases).",
          example: 20,
        }),
      }),
    )
    .min(1)
    .max(50),
  date: z.iso.date().optional().meta({
    description:
      "The delivery date the goods are needed, YYYY-MM-DD. Prices and availability are checked for it. Defaults to today (Europe/Helsinki).",
    example: "2026-11-20",
  }),
});

export const PolicyOutcomeSchema = z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]).meta({
  description:
    "`ALLOW`: may be ordered without a human. `REQUIRE_APPROVAL`: an approver must decide. `DENY`: must not be ordered.",
});

export const PolicyReasonCodeSchema = z.enum([
  "UNKNOWN_PRODUCT",
  "PRICE_UNKNOWN",
  "BLOCKED_VENDOR",
  "EXCLUDED_ALLERGEN",
  "CO2_TOO_HIGH",
  "RELIABILITY_TOO_LOW",
  "ORDER_VALUE_TOO_HIGH",
  "SALES_BLOCKED",
  "NOT_ORDERABLE",
  "LATE_DELIVERY",
  "INSUFFICIENT_STOCK",
  "AVAILABILITY_UNKNOWN",
  "UNIT_PRICE_TOO_HIGH",
  "LINE_QUANTITY_TOO_HIGH",
  "CATEGORY_BLOCKED",
  "CATEGORY_NOT_ALLOWED",
  "PRODUCT_BLOCKED",
  "PRODUCT_NOT_ALLOWED",
  "SUGGEST_ONLY",
  "NO_AUTO_APPROVAL",
  "ABOVE_AUTO_APPROVAL",
  "WITHIN_LIMITS",
]);

export const PolicyReasonSchema = z.object({
  code: PolicyReasonCodeSchema,
  outcome: PolicyOutcomeSchema.meta({ description: "The level this reason leads to on its own." }),
  message: z.string(),
  setting: SettingKeySchema.optional().meta({ description: "The preference that caused it." }),
  productId: productId.optional(),
});

export const PolicyLineSchema = z.object({
  productId,
  quantity: z.number(),
  salesUnit: z.string().nullable(),
  unitPriceExclVat: z.number().nullable().meta({ description: "Null when Valio has no price." }),
  lineTotalExclVat: z.number().nullable(),
  orderable: z.boolean().nullable().meta({ description: "Null when Valio gave no availability answer." }),
  availableDate: z.string().nullable().meta({ description: "Earliest delivery date; may be later than requested." }),
  availableQuantity: z.number().nullable().meta({ description: "In salesUnit. Null when unknown (terminal products)." }),
});

export const PolicyDecisionSchema = z.object({
  outcome: PolicyOutcomeSchema,
  reasons: z.array(PolicyReasonSchema).meta({ description: "Every rule that applied; the strictest decides." }),
  lines: z.array(PolicyLineSchema),
  totalExclVat: z.number().nullable().meta({ description: "Null when a line has no price." }),
  currency: z.string().meta({ example: "EUR" }),
  pricingDate: z.iso.date(),
  source: DataSourceSchema,
  limits: z.object({
    maxOrderValue: z.number().nullable(),
    autoApproveBelow: z.number().nullable(),
    autonomy: z.enum(["suggest_only", "order_within_limits"]),
  }).meta({ description: "The buyer's effective limits the decision used." }),
  evaluatedAt: z.iso.datetime(),
});

export type PolicyEvaluateRequest = z.infer<typeof PolicyEvaluateRequestSchema>;
export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;
export type PolicyReasonCode = z.infer<typeof PolicyReasonCodeSchema>;
export type PolicyReason = z.infer<typeof PolicyReasonSchema>;
export type PolicyLine = z.infer<typeof PolicyLineSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
