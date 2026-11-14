import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { organizationProcurementSettings } from "@/server/db/schema";
import { normalizeAllergenList } from "@/server/services/mock-catalog";
import { getEffectiveFor, getLayers } from "@/server/services/preferences";
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
import type { Preferences } from "@/shared/contracts/preferences";

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

export type ProcurementPreferencesContext = {
  settings: ProcurementSettings;
  layered: Preferences | null;
};

/**
 * Reads customer preferences, agent guardrails, and effective 3-layer organization preferences
 * for the caller's organization (or unauthenticated default scope).
 */
export async function getProcurementContext(
  actor?: SessionUser | null,
  roleOverride?: "buyer" | "approver",
): Promise<ProcurementPreferencesContext> {
  if (!actor) {
    return {
      settings: fallbackSettingsStore.get(DEFAULT_SCOPE_KEY) ?? defaultSettings(null),
      layered: null,
    };
  }

  const orgId = actor.organization.id;
  const actingRole: "buyer" | "approver" =
    roleOverride ?? (actor.roles.includes("buyer") ? "buyer" : "approver");

  let settings: ProcurementSettings | null = null;
  let hasOrgSettingsRow = false;

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const [row] = await db
        .select()
        .from(organizationProcurementSettings)
        .where(eq(organizationProcurementSettings.organizationId, orgId));

      if (row) {
        hasOrgSettingsRow = true;
        const parsedPrefs = CustomerPreferencesSchema.safeParse(row.preferences);
        const parsedGuardrails = AgentGuardrailsSchema.safeParse(row.guardrails);
        settings = {
          organizationId: orgId,
          preferences: parsedPrefs.success
            ? structuredClone(parsedPrefs.data)
            : structuredClone(DEFAULT_MOCK_PREFERENCES),
          guardrails: parsedGuardrails.success
            ? structuredClone(parsedGuardrails.data)
            : structuredClone(DEFAULT_AGENT_GUARDRAILS),
          updatedAt: row.updatedAt.toISOString(),
        };
      }
    } catch {
      // Fall back to in-memory settings when DB is unreachable.
    }
  }

  settings ??= structuredClone(fallbackSettingsStore.get(orgId) ?? defaultSettings(orgId));

  let layered: Preferences | null = null;
  let hasSavedLayers = false;

  if (process.env.DATABASE_URL) {
    try {
      const [effective, layers] = await Promise.all([
        getEffectiveFor(orgId, actingRole),
        getLayers(orgId),
      ]);
      layered = effective.values;
      hasSavedLayers =
        layers.base.updatedAt !== null ||
        layers.buyer.updatedAt !== null ||
        layers.approver.updatedAt !== null;
    } catch {
      // Gracefully fall back to null layered preferences when DB is unreachable.
    }
  }

  if (layered) {
    const existingLower = new Set(
      settings.preferences.excludedAllergens.map((a) => a.trim().toLowerCase()),
    );
    const mergedExcluded = [...settings.preferences.excludedAllergens];
    for (const norm of normalizeAllergenList(layered.excludedAllergens)) {
      if (!existingLower.has(norm)) {
        existingLower.add(norm);
        mergedExcluded.push(norm);
      }
    }
    settings.preferences.excludedAllergens = mergedExcluded;

    if (hasSavedLayers || !hasOrgSettingsRow) {
      if (layered.maxOrderValue !== null) {
        settings.guardrails.budgetEur = hasOrgSettingsRow
          ? Math.min(settings.guardrails.budgetEur, layered.maxOrderValue)
          : layered.maxOrderValue;
      }
      if (layered.autonomy === "suggest_only" || layered.autoApproveBelow === null) {
        settings.guardrails.requireCustomerConfirmation = true;
        settings.guardrails.autoApproveLimitEur = 0;
      } else if (layered.autonomy === "order_within_limits" && layered.autoApproveBelow !== null) {
        settings.guardrails.autoApproveLimitEur = Math.min(
          layered.autoApproveBelow,
          settings.guardrails.budgetEur,
        );
        settings.guardrails.requireCustomerConfirmation = false;
      }
    }
  }

  return { settings, layered };
}

/** Reads saved customer preferences and agent guardrails for the caller's organization (or default scope). */
export async function getProcurementSettings(
  actor?: SessionUser | null,
): Promise<ProcurementSettings> {
  return (await getProcurementContext(actor)).settings;
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
  allowSubstitutes?: boolean;
  usedSubstitutes?: boolean;
}): GuardrailEvaluation {
  const {
    lines,
    totalPriceEur,
    guardrails,
    forceApproval,
    preferenceOverrideReasons,
    allowSubstitutes,
    usedSubstitutes,
  } = params;
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

  if (allowSubstitutes === false && usedSubstitutes) {
    violations.push({
      rule: "customer_confirmation_required",
      severity: "approval_required",
      productId: null,
      message: "Organization preferences disallow automatic substitutes; human approval required.",
    });
  }

  const requiresHumanApproval = violations.some((v) => v.severity === "approval_required");
  return {
    authorizedForAutoConfirm: !requiresHumanApproval,
    requiresHumanApproval,
    violations,
  };
}
