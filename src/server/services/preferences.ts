import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { preferenceLayer } from "@/server/db/schema";
import type { Role } from "@/shared/contracts/me";
import {
  PreferencesLayerValuesSchema,
  PreferencesSchema,
  SettingKeySchema,
  type EffectivePreferences,
  type EffectiveResponse,
  type Layer,
  type LayerScope,
  type LayersResponse,
  type Preferences,
  type PreferencesLayerValues,
  type PreferenceSource,
  type SettingKey,
  type UpdateLayerRequest,
} from "@/shared/contracts/preferences";

// Preferences of an organization's buyers and approvers, in three layers:
//   base (everyone, can lock settings) → buyer / approver (per role)
// Effective value for a role = role layer (unless the setting is locked) → base → system default.
// Consumers (agent tools, the approval flow) call getEffective() for the role they act in.
// All functions take the caller's organization id: organizations never see each other's layers.

/** Used where no layer sets a value. Deliberately cautious: suggest only, every order needs approval. */
export const DEFAULT_PREFERENCES: Preferences = {
  maxCo2PerKg: null,
  minDeliveryReliability: null,
  preferredOriginCountries: [],
  excludedAllergens: [],
  preferredVendors: [],
  blockedVendors: [],
  preferredBrands: [],
  maxOrderValue: null,
  autoApproveBelow: null,
  autonomy: "suggest_only",
  allowSubstitutes: false,
  language: "en",
};

const SETTING_KEYS = SettingKeySchema.options;
const ROLE_SCOPES = ["buyer", "approver"] as const satisfies readonly Role[];

/** Expected failures, mapped to HTTP statuses by the route. */
export class PreferencesError extends Error {
  /** 409: conflicts with an organization lock. 422: valid shape, but not allowed. */
  readonly status: 409 | 422;
  constructor(status: 409 | 422, message: string) {
    super(message);
    this.name = "PreferencesError";
    this.status = status;
  }
}

type StoredLayer = { values: PreferencesLayerValues; locked: SettingKey[]; updatedAt: Date | null };
type StoredLayers = Record<LayerScope, StoredLayer>;

const emptyLayer = (): StoredLayer => ({ values: {}, locked: [], updatedAt: null });

// ---------- Resolving (pure) ----------

/**
 * The effective settings for `role`: defaults, then the organization base, then the role's layer.
 * Settings the base locked ignore the role layer, even if it has a stored value (e.g. set before
 * the lock). A key that is absent in a layer inherits; null (no limit) is a value.
 */
export function resolvePreferences(role: Role, base: StoredLayer, roleLayer: StoredLayer): EffectivePreferences {
  const values: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  const sources: Record<string, PreferenceSource> = {};
  const locked = new Set(base.locked);

  for (const key of SETTING_KEYS) {
    sources[key] = "default";
    if (base.values[key] !== undefined) {
      values[key] = base.values[key];
      sources[key] = "organization";
    }
    if (!locked.has(key) && roleLayer.values[key] !== undefined) {
      values[key] = roleLayer.values[key];
      sources[key] = role;
    }
  }
  return {
    values: PreferencesSchema.parse(values),
    sources: sources as EffectivePreferences["sources"],
    locked: SETTING_KEYS.filter((k) => locked.has(k)),
  };
}

/** Rules that span settings; returns a message when the effective set is invalid. */
function crossFieldProblem(role: Role, { values }: EffectivePreferences): string | null {
  const { autoApproveBelow, maxOrderValue } = values;
  if (autoApproveBelow !== null && maxOrderValue !== null && autoApproveBelow > maxOrderValue) {
    return `For ${role}s autoApproveBelow (${autoApproveBelow}) would exceed maxOrderValue (${maxOrderValue})`;
  }
  return null;
}

// ---------- Storage ----------

type Executor = Pick<ReturnType<typeof getDb>, "select">;

async function loadLayers(d: Executor, organizationId: string): Promise<StoredLayers> {
  const rows = await d.select().from(preferenceLayer).where(eq(preferenceLayer.organizationId, organizationId));
  const layers: StoredLayers = { base: emptyLayer(), buyer: emptyLayer(), approver: emptyLayer() };
  for (const row of rows) {
    const scope = row.scope as LayerScope;
    layers[scope] = {
      // Settings were validated on the way in; parsing again drops keys a newer schema removed.
      values: PreferencesSchema.partial().parse(row.settings),
      locked: row.locked.filter((k): k is SettingKey => SettingKeySchema.safeParse(k).success),
      updatedAt: row.updatedAt,
    };
  }
  return layers;
}

const toLayer = (scope: LayerScope, l: StoredLayer): Layer => ({
  scope,
  values: l.values,
  locked: l.locked,
  updatedAt: l.updatedAt ? l.updatedAt.toISOString() : null,
});

// ---------- Public API ----------

/** The three raw layers (what each one sets), for the approvers' editing screen. */
export async function getLayers(organizationId: string): Promise<LayersResponse> {
  await ensureDatabase();
  const layers = await loadLayers(getDb(), organizationId);
  return { base: toLayer("base", layers.base), buyer: toLayer("buyer", layers.buyer), approver: toLayer("approver", layers.approver) };
}

/** Effective settings for each of `roles` (the roles the caller holds). */
export async function getEffective(organizationId: string, roles: Role[]): Promise<EffectiveResponse> {
  await ensureDatabase();
  const layers = await loadLayers(getDb(), organizationId);
  const result: EffectiveResponse = {};
  for (const role of ROLE_SCOPES) {
    if (roles.includes(role)) result[role] = resolvePreferences(role, layers.base, layers[role]);
  }
  return result;
}

/** Effective settings for one role; for agent tools and the approval flow. */
export async function getEffectiveFor(organizationId: string, role: Role): Promise<EffectivePreferences> {
  const effective = (await getEffective(organizationId, [role]))[role];
  if (!effective) throw new Error(`No preferences for role ${role}`);
  return effective;
}

/**
 * Replaces one layer's settings (and, on `base`, its locks unless `locked` is omitted). Rules:
 * - `locked` is only valid on `base` (422);
 * - a role layer can't set settings the base has locked (409);
 * - the effective settings of both roles must stay valid, e.g. autoApproveBelow ≤ maxOrderValue (422).
 */
export async function updateLayer(
  organizationId: string,
  userId: string,
  scope: LayerScope,
  request: UpdateLayerRequest,
): Promise<Layer> {
  await ensureDatabase();
  const values = PreferencesLayerValuesSchema.parse(request.values);
  if (scope !== "base" && request.locked !== undefined && request.locked.length > 0) {
    throw new PreferencesError(422, "Only the base layer can lock settings");
  }

  return getDb().transaction(async (tx) => {
    // One writer per organization at a time: the cross-layer checks below read other layers.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`);
    const layers = await loadLayers(tx, organizationId);

    if (scope !== "base") {
      const lockedKeys = Object.keys(values).filter((k) => layers.base.locked.includes(k as SettingKey));
      if (lockedKeys.length > 0) {
        throw new PreferencesError(409, `Locked by the organization, can't be set here: ${lockedKeys.join(", ")}`);
      }
    }

    const next: StoredLayer = {
      values,
      locked: scope === "base" ? (request.locked !== undefined ? [...new Set(request.locked)] : layers.base.locked) : [],
      updatedAt: new Date(),
    };
    const after: StoredLayers = { ...layers, [scope]: next };
    for (const role of ROLE_SCOPES) {
      const problem = crossFieldProblem(role, resolvePreferences(role, after.base, after[role]));
      if (problem) throw new PreferencesError(422, problem);
    }

    await tx
      .insert(preferenceLayer)
      .values({ organizationId, scope, settings: values, locked: next.locked, updatedAt: next.updatedAt!, updatedBy: userId })
      .onConflictDoUpdate({
        target: [preferenceLayer.organizationId, preferenceLayer.scope],
        set: { settings: values, locked: next.locked, updatedAt: next.updatedAt!, updatedBy: userId },
      });
    return toLayer(scope, next);
  });
}
