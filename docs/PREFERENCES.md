# Preferences

Settings that steer the purchasing agent and the approval flow. Defined in `src/shared/contracts/preferences.ts` (`PreferencesSchema`).

## How they work

Each organization has three **layers**: `base` (everyone) and one per role, `buyer` and `approver`.
The value a role gets is the first one found: **role layer → base → system default**.

- A setting left out of a layer inherits. `null` means "no limit" and overrides the layer above.
- Lists replace the layer above; they are not merged.
- The base can **lock** a setting: role layers can't override it.
- Users holding both roles get a separate set per role.

| | Buyer | Approver |
| --- | --- | --- |
| Reads own effective settings | yes | yes |
| Edits layers and locks | no | yes |

## Settings

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| **Product criteria** | | | |
| `maxCo2PerKg` | number or null | null | Highest kg CO2-eq per kg of product. Products without CO2 data aren't excluded. |
| `minDeliveryReliability` | 0–1 or null | null | Lowest acceptable delivery reliability. Products without data aren't excluded. |
| `preferredOriginCountries` | list of ISO alpha-2 (lowercase) | [] | Countries of origin to prefer, e.g. `fi`. |
| `excludedAllergens` | list | [] | Allergens to avoid: GS1 codes (`AM`, `AW`) or names (`milk`, `gluten`); a name covers all its codes. |
| `dietaryRestrictions` | list | [] | Tags the agent's products must have, e.g. `lactose-free`, `vegetarian`. |
| **Vendors and brands** | | | |
| `preferredVendors` | list | [] | Vendors to prefer, spelled as in the catalog. |
| `blockedVendors` | list | [] | Vendors never to order from. |
| `preferredBrands` | list | [] | Brands to prefer. |
| **Spending and approval** | | | |
| `maxOrderValue` | number or null | null | Highest total of one order, EUR excl. VAT. |
| `maxUnitPrice` | number or null | null | Unit price (EUR excl. VAT) above which a line needs approval. |
| `maxLineQuantity` | number or null | null | Quantity of one line above which it needs approval. |
| `allowedCategories` / `blockedCategories` | lists | [] | Valio category codes; outside allowed (if set) or blocked → approval. |
| `allowedProductIds` / `blockedProductIds` | lists | [] | Product codes; outside allowed (if set) or blocked → approval. |
| `autoApproveBelow` | number or null | null | Orders below this total (EUR excl. VAT) are approved automatically. Null: every order needs an approver. Can't exceed `maxOrderValue`. |
| **AI behavior** | | | |
| `autonomy` | `suggest_only` or `order_within_limits` | `suggest_only` | Whether the agent only proposes or may order within the limits. |
| `allowSubstitutes` | boolean | false | May lines stand in for what was requested (short-stock split, swap, fallback when the best match can't be delivered) without approval. False → those proposals need an approver. |
| `language` | `en`, `fi`, `sv` | `en` | Language of the agent's answers. |

## API

| Endpoint | Who |
| --- | --- |
| `GET /api/preferences/layers` | approver |
| `PUT /api/preferences/layers/{scope}` (`base`, `buyer`, `approver`) | approver |
| `GET /api/preferences/effective` | any member |

Full request and response shapes: `/api/docs`.

## Status

Backend only. The **policy check** (`POST /api/policy/evaluate`) applies the buyer's effective settings to a draft order (products + quantities; the server prices them):

| Outcome | When |
| --- | --- |
| `DENY` | unknown product, no price, blocked vendor, excluded allergen, CO2 above `maxCo2PerKg`, reliability below `minDeliveryReliability`, total above `maxOrderValue`, sales-blocked or not deliverable on any date |
| `REQUIRE_APPROVAL` | `autonomy` is `suggest_only`, `autoApproveBelow` is null, or the total is not below it; unit price or line quantity above the caps; category or product outside the allow/block lists; a substitute line while `allowSubstitutes` is false; a product that may contain an excluded allergen; earliest delivery later than the requested `date`; known stock below the quantity; no availability answer from Valio |
| `ALLOW` | none of the above |

Missing product data (no CO2, allergens or reliability) never triggers a rule. Preferred origins, vendors and brands aren't checked: they are for ranking, which the agent will do.
