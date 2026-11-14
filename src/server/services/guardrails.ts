import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { organizationProcurementSettings } from "@/server/db/schema";
import {
  type AgentGuardrails,
  AgentGuardrailsSchema,
  type CustomerPreferences,
  CustomerPreferencesSchema,
  type GuardrailEvaluation,
  type GuardrailViolation,
  type PartialAgentGuardrails,
  type ProcurementSettings,
  type UpdateProcurementSettingsRequest,
} from "@/shared/contracts/guardrails";
import type { SessionUser } from "@/shared/contracts/me";
import type { OrderLineItem } from "@/shared/contracts/orders";

export class ProcurementPermissionError extends Error {
  readonly status: 403;
  constructor(message: string) {
    super(message);
    this.name = "ProcurementPermissionError";
    this.status = 403;
  }
}

export const DEFAULT_MOCK_BUDGET_EUR = 2500;

export const DEFAULT_MOCK_PREFERENCES: CustomerPreferences = {
  dietaryRestrictions: ["vegetarian", "gluten-free"],
  excludedAllergens: ["peanuts", "tree-nuts", "soy", "crustaceans"],
  nutrition: {
    maxCaloriesPer100g: 420,
    maxFatPer100g: 36,
    maxSugarPer100g: 15,
    maxSaltPer100g: 2.2,
    minProteinPer100g: 3,
  },
};

export const DEFAULT_AGENT_GUARDRAILS: AgentGuardrails = {
  budgetEur: DEFAULT_MOCK_BUDGET_EUR,
  autoApproveLimitEur: DEFAULT_MOCK_BUDGET_EUR,
  allowedCategories: [],
  blockedCategories: ["ALCOHOL", "TOBACCO"],
  allowedProductIds: [],
  blockedProductIds: [],
  requireApprovalOnStockShortfall: true,
  requireCustomerConfirmation: false,
};

const DEFAULT_SCOPE_KEY = "__default__";
const fallbackSettingsStore = new Map<string, ProcurementSettings>();

function defaultSettings(organizationId: string | null): ProcurementSettings {
  return {
    organizationId,
    preferences: structuredClone(DEFAULT_MOCK_PREFERENCES),
    guardrails: structuredClone(DEFAULT_AGENT_GUARDRAILS),
    updatedAt: new Date().toISOString(),
  };
}

export function mergeGuardrails(
  base: AgentGuardrails,
  override?: PartialAgentGuardrails,
  budgetEurOverride?: number,
): AgentGuardrails {
  const merged: AgentGuardrails = {
    ...base,
    ...override,
    allowedCategories: override?.allowedCategories ?? base.allowedCategories,
    blockedCategories: override?.blockedCategories ?? base.blockedCategories,
    allowedProductIds: override?.allowedProductIds ?? base.allowedProductIds,
    blockedProductIds: override?.blockedProductIds ?? base.blockedProductIds,
  };
  if (budgetEurOverride !== undefined) {
    merged.budgetEur = budgetEurOverride;
    if (override?.autoApproveLimitEur === undefined) {
      merged.autoApproveLimitEur = budgetEurOverride;
    }
  }
  return merged;
}

/** Reads saved customer preferences and agent guardrails for the caller's organization (or default scope). */
export async function getProcurementSettings(
  actor?: SessionUser | null,
): Promise<ProcurementSettings> {
  const orgId = actor?.organization.id ?? null;

  if (orgId && process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const [row] = await db
        .select()
        .from(organizationProcurementSettings)
        .where(eq(organizationProcurementSettings.organizationId, orgId));

      if (row) {
        const parsedPrefs = CustomerPreferencesSchema.safeParse(row.preferences);
        const parsedGuardrails = AgentGuardrailsSchema.safeParse(row.guardrails);
        return {
          organizationId: orgId,
          preferences: parsedPrefs.success ? parsedPrefs.data : DEFAULT_MOCK_PREFERENCES,
          guardrails: parsedGuardrails.success ? parsedGuardrails.data : DEFAULT_AGENT_GUARDRAILS,
          updatedAt: row.updatedAt.toISOString(),
        };
      }
    } catch {
      // Fall back to in-memory settings when DB is unreachable.
    }
  }

  const key = orgId ?? DEFAULT_SCOPE_KEY;
  return fallbackSettingsStore.get(key) ?? defaultSettings(orgId);
}

/**
 * Updates customer preferences and agent permission guardrails.
 * When signed in, only users holding the `approver` role in their organization may modify settings.
 */
export async function updateProcurementSettings(
  actor: SessionUser | null | undefined,
  input: UpdateProcurementSettingsRequest,
): Promise<ProcurementSettings> {
  if (actor && !actor.roles.includes("approver")) {
    throw new ProcurementPermissionError(
      "Only an organization approver can update procurement preferences and agent guardrails.",
    );
  }

  const current = await getProcurementSettings(actor);
  const orgId = actor?.organization.id ?? null;
  const nextPreferences: CustomerPreferences = input.preferences ?? current.preferences;
  const nextGuardrails: AgentGuardrails = mergeGuardrails(current.guardrails, input.guardrails);
  const now = new Date();

  const updated: ProcurementSettings = {
    organizationId: orgId,
    preferences: nextPreferences,
    guardrails: nextGuardrails,
    updatedAt: now.toISOString(),
  };

  if (orgId && process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      await db
        .insert(organizationProcurementSettings)
        .values({
          organizationId: orgId,
          preferences: nextPreferences,
          guardrails: nextGuardrails,
          updatedByUserId: actor?.id ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: organizationProcurementSettings.organizationId,
          set: {
            preferences: nextPreferences,
            guardrails: nextGuardrails,
            updatedByUserId: actor?.id ?? null,
            updatedAt: now,
          },
        });
      fallbackSettingsStore.set(orgId, updated);
      return updated;
    } catch {
      // Fall back to in-memory store below if DB write fails.
    }
  }

  const key = orgId ?? DEFAULT_SCOPE_KEY;
  fallbackSettingsStore.set(key, updated);
  return updated;
}

/**
 * Evaluates order lines and totals against the active agent permission guardrails.
 */
export function evaluateOrderGuardrails(params: {
  lines: OrderLineItem[];
  totalPriceEur: number;
  guardrails: AgentGuardrails;
  forceApproval?: boolean;
  preferenceOverrideReasons?: string[];
}): GuardrailEvaluation {
  const { lines, totalPriceEur, guardrails, forceApproval, preferenceOverrideReasons } = params;
  const violations: GuardrailViolation[] = [];

  if (totalPriceEur > guardrails.budgetEur) {
    violations.push({
      rule: "budget_exceeded",
      severity: "approval_required",
      productId: null,
      message: `Order total (${totalPriceEur.toFixed(2)} EUR) exceeds budget (${guardrails.budgetEur.toFixed(2)} EUR).`,
    });
  }

  if (totalPriceEur > guardrails.autoApproveLimitEur) {
    violations.push({
      rule: "auto_approve_limit_exceeded",
      severity: "approval_required",
      productId: null,
      message: `Order total (${totalPriceEur.toFixed(2)} EUR) exceeds autonomous spending authority (${guardrails.autoApproveLimitEur.toFixed(2)} EUR).`,
    });
  }

  const allowedCats = new Set(guardrails.allowedCategories.map((c) => c.trim().toLowerCase()));
  const blockedCats = new Set(guardrails.blockedCategories.map((c) => c.trim().toLowerCase()));
  const allowedIds = new Set(guardrails.allowedProductIds.map((id) => id.trim().toLowerCase()));
  const blockedIds = new Set(guardrails.blockedProductIds.map((id) => id.trim().toLowerCase()));

  for (const line of lines) {
    const catNorm = line.category.trim().toLowerCase();
    const typeNorm = line.productType.trim().toLowerCase();
    const idNorm = line.productId.trim().toLowerCase();

    if (
      guardrails.maxUnitPriceEur !== undefined &&
      line.unitPriceEur > guardrails.maxUnitPriceEur
    ) {
      violations.push({
        rule: "max_unit_price_exceeded",
        severity: "approval_required",
        productId: line.productId,
        message: `Unit price for '${line.productName}' (${line.unitPriceEur.toFixed(2)} EUR) exceeds cap (${guardrails.maxUnitPriceEur.toFixed(2)} EUR).`,
      });
    }

    if (
      guardrails.maxSingleLineQuantity !== undefined &&
      line.quantity > guardrails.maxSingleLineQuantity
    ) {
      violations.push({
        rule: "max_line_quantity_exceeded",
        severity: "approval_required",
        productId: line.productId,
        message: `Quantity for '${line.productName}' (${line.quantity} ${line.unit}) exceeds single-line cap (${guardrails.maxSingleLineQuantity}).`,
      });
    }

    if (blockedCats.has(catNorm) || blockedCats.has(typeNorm)) {
      violations.push({
        rule: "category_blocked",
        severity: "approval_required",
        productId: line.productId,
        message: `Category '${line.category}' for '${line.productName}' is restricted by agent guardrails.`,
      });
    }

    if (allowedCats.size > 0 && !allowedCats.has(catNorm) && !allowedCats.has(typeNorm)) {
      violations.push({
        rule: "category_not_allowed",
        severity: "approval_required",
        productId: line.productId,
        message: `Category '${line.category}' for '${line.productName}' is outside permitted categories.`,
      });
    }

    if (blockedIds.has(idNorm)) {
      violations.push({
        rule: "product_blocked",
        severity: "approval_required",
        productId: line.productId,
        message: `Product '${line.productName}' (${line.productId}) is on the restricted product list.`,
      });
    }

    if (allowedIds.size > 0 && !allowedIds.has(idNorm)) {
      violations.push({
        rule: "product_not_allowed",
        severity: "approval_required",
        productId: line.productId,
        message: `Product '${line.productName}' (${line.productId}) is not on the pre-approved product whitelist.`,
      });
    }

    if (
      guardrails.requireApprovalOnStockShortfall &&
      (line.stockStatus === "out_of_stock" || line.stockStatus === "partial_stock")
    ) {
      const availDesc =
        line.availableQuantity !== null
          ? `${line.availableQuantity} ${line.unit} available`
          : "0 available";
      violations.push({
        rule: "stock_shortfall",
        severity: "approval_required",
        productId: line.productId,
        message: `Insufficient stock for '${line.productName}': requested ${line.quantity} ${line.unit}, ${availDesc} (${line.stockStatus}).`,
      });
    }
  }

  if (guardrails.requireCustomerConfirmation || forceApproval) {
    violations.push({
      rule: "customer_confirmation_required",
      severity: "approval_required",
      productId: null,
      message: "Explicit human review and confirmation is enabled before order commitment.",
    });
  }

  if (preferenceOverrideReasons && preferenceOverrideReasons.length > 0) {
    violations.push({
      rule: "customer_confirmation_required",
      severity: "approval_required",
      productId: null,
      message: `Manual product override triggered preference review: ${preferenceOverrideReasons.join("; ")}`,
    });
  }

  const requiresHumanApproval = violations.some((v) => v.severity === "approval_required");
  return {
    authorizedForAutoConfirm: !requiresHumanApproval,
    requiresHumanApproval,
    violations,
  };
}
