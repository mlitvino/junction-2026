# User Stories Sync

## Frontend

### Story 1: Simple buy X of Y quantity

| Step | Page / Component | `apiClient` / Store Method | Status |
| --- | --- | --- | --- |
| 1. Extract `[Product name] - [Product type] - [Quantity]` from prompt | `/buyer`, `/buyer/conversations/[id]` (`AssistantWelcome`, `ConversationComposer`, `SelectionTrail` in `src/features/workspace/selection-trail.tsx`) | `apiClient.workspace.sendMessage` → `runAgent` / `extract` | Covered |
| 2. API request to get products by `[Product type]` | `SelectionTrail` (`matchedByTypeCount`), `ProductPicker` (`/buyer/products`) | `runAgent` / `searchProducts` | Covered |
| 3. Sorted list of best match by `[Product name]` | `SelectionTrail` (`sortedCandidates` with `nameMatchScore`, `rankScore`, `rankReasons`), `ProductComparison` | `runAgent` / `rankProducts` | Covered |
| 4. Remove entries not matching customer preferences (dietary, allergens, nutrition) | `SelectionTrail` (`removedByPreferences` expandable list with per-product reasons) | `runAgent` / `rankProducts` / `evaluatePolicy` | Partial (dietary, allergens, blocked vendors, CO2 & delivery reliability enforced; per-100g nutrition limits not yet configurable) |
| 5. Sort by previous orders (product, brand) | `SelectionTrail` (`previouslyOrderedProduct`, `previouslyOrderedBrand` badges & `previousOrdersUsed`) | `runAgent` (`selection.previousOrdersUsed`) | Covered |
| 6. Compare prices to customer budget | `BudgetComparison` in `src/features/workspace/selection-trail.tsx` (rendered in `ApprovalCard`) | `proposal.totalExclVat` vs `proposal.decision.limits` (`maxOrderValue`, `autoApproveBelow`) | Covered |
| 7. Create an order (proposal draft) | `AssistantConversation`, `ProductPicker`, `ApprovalCard` (`/proposals/[id]`) | `runAgent` / `createProposal` | Covered |
| 8. Ask for customer approval or changes (`change product X to Y`) | `ApprovalCard` (Approve / Reject / Send for review), `SelectionTrail` & `ProductComparison` ("Swap to this" button), `ConversationComposer` (NL follow-up) | `apiClient.workspace.approve`, `apiClient.workspace.reviseProposal`, `apiClient.requestApproval` | Covered |
| 9. Checkout order and provide receipt | `ApprovalCard` ("Record order"), `/orders/[id]` (`OrderDetail`), `/checkout/[id]` (`Checkout`), `ReceiptPanel` | `apiClient.workspace.placeOrder`, `apiClient.getOrderReceipt`, `apiClient.verifyProposal` | Covered |

### Story 2: Order products based on customer recipe

| Step | Page / Component | `apiClient` / Store Method | Status |
| --- | --- | --- | --- |
| Pre-req: Recipe list (salmon soup) & inventory stock | `/recipes` (`Recipes`), `/recipes/[id]` (`RecipePage`), `/restocking/inventory` | `apiClient.workspace.loadRecipes`, `apiClient.workspace.loadInventory` | Covered |
| 1. Query recipe data `[Product name] - [Product type] - [Quantity]` | `RecipePage`, `MealPlan` (`/recipes/[id]/plan`), `AssistantConversation` | `loadRecipe`, `createPurchaseFromRecipe` | Covered |
| 2. Calculate total quantity for each item | `MealPlan` (`recipeNeeds`), `AssistantConversation` (`thread.recipeReconciliation`) | `recipeNeeds` / `createProposalFromRecipe` | Covered |
| 3. Calculate `actually needed = total needed - inventory stock` | `MealPlan` (per-ingredient `Total needed · Inventory stock · Actually needed`), `AssistantConversation` (`Recipe inventory check` panel) | `recipeNeeds` / `createProposalFromRecipe` | Covered |
| 4–8. Product search, ranking, preference filtering, history sort, budget check | `MealPlan` ("Auto-prepare from recipe" / manual picker), `ApprovalCard`, `SelectionTrail`, `BudgetComparison` | `createPurchaseFromRecipe`, `searchProducts`, `quote`, `createPurchase` | Partial (per-100g nutrition limits not yet configurable; all other rules enforced) |
| 9–11. Create proposal, approve or change (`change product X to Y`), checkout & receipt | `ApprovalCard`, `SelectionTrail` / `ProductComparison` ("Swap to this"), `/orders/[id]`, `/checkout/[id]` (`ReceiptPanel`) | `createPurchaseFromRecipe`, `reviseProposal`, `approve`, `placeOrder`, `getOrderReceipt` | Covered |

### Needed backend/contract changes

- None required for the core flows above; all endpoints (`POST /api/agent/run`, `POST /api/extract`, `POST /api/products/rank`, `POST /api/proposals/from-prompt`, `POST /api/proposals/from-recipe`, `POST /api/proposals/{id}/revise`, `POST /api/proposals/{id}/approval`, `POST /api/approvals/{id}/decision`, `POST /api/proposals/{id}/order`, `GET /api/orders/{id}/receipt`, `GET /api/proposals/{id}/verify`, `GET /api/recipes`, `GET /api/inventory`) already exist in `src/shared/contracts/`.
- Note: In connected mode without `GOOGLE_GENERATIVE_AI_API_KEY` (and `TEST_MODE` not `TRUE`), `POST /api/agent/run`, `POST /api/extract`, and `POST /api/proposals/{id}/revise` with `prompt` return `503 AGENT_NOT_CONFIGURED`. Structured `POST /api/proposals/{id}/revise` (`replacements`, `quantityUpdates`), `POST /api/products/rank`, and `POST /api/proposals/from-recipe` work without an LLM key.


## Backend

### Story 1: Simple buy X of Y quantity

| Step | Endpoint | Service / Function | Status |
| --- | --- | --- | --- |
| 1. Extract `[Product name] - [Product type] - [Quantity]` from prompt | `POST /api/extract`, `POST /api/proposals/from-prompt`, `POST /api/agent/run` | `extractProductsFromPrompt` (`src/server/services/extract.ts`), `extractorAgent` (`src/server/agents/extractor-agent.ts`) | Covered |
| 2. API request to get products by `[Product type]` | `GET /api/products`, `POST /api/products/rank`, `POST /api/proposals/from-prompt` | `searchProducts` (`src/server/services/catalog.ts`), `getCandidatesByProductType` (`src/server/services/selection.ts`) | Covered |
| 3. Sorted list of best match by `[Product name]` | `POST /api/products/rank`, `POST /api/proposals/from-prompt` | `computeNameMatchScore` (`src/server/services/selection.ts`), `rankCandidates` (`src/server/purchasing/ranking.ts`) | Covered |
| 4. Remove entries not matching customer preferences (dietary, allergens, nutrition, blocked vendors, CO2, reliability) | `POST /api/products/rank`, `POST /api/policy/evaluate`, `POST /api/proposals/from-prompt` | `evaluateBuyerPreferences` & `createProposalFromItems` (`src/server/services/selection.ts`), `evaluateDraft` (`src/server/services/policy.ts`) | Partial (dietary + allergens + vendor/CO2/reliability; nutrition limits not configurable: needs contract change) |
| 5. Sort by previous orders (product, brand) | `POST /api/products/rank`, `POST /api/proposals/from-prompt` | `loadHistoricalOrderRecords` (`src/server/services/selection.ts`), `rankCandidates` (`src/server/purchasing/ranking.ts`) | Covered |
| 6. Compare prices to customer budget | `POST /api/policy/evaluate`, `POST /api/proposals`, `POST /api/proposals/from-prompt` | `evaluateDraft` (`src/server/services/policy.ts`), `evaluatePolicy` (`src/server/policy/evaluate.ts`) | Covered |
| 7. Create an order (frozen proposal) | `POST /api/proposals`, `POST /api/proposals/from-prompt`, `POST /api/agent/run` | `createProposal` (`src/server/services/purchasing.ts`), `createProposalFromItems` (`src/server/services/selection.ts`) | Covered |
| 8. Ask for customer approval or changes (`change product X on product Y`) | `POST /api/proposals/{id}/approval`, `POST /api/approvals/{id}/decision`, `POST /api/proposals/{id}/revise`, `POST /api/agent/run` | `requestApproval` & `decideApproval` (`src/server/services/purchasing.ts`), `reviseProposalFromRequest` (`src/server/services/selection.ts`), `parseOrderChangeDeterministically` (`src/server/agents/order-change-agent.ts`) | Covered |
| 9. Checkout order and provide receipt | `POST /api/proposals/{id}/order`, `GET /api/orders/{id}/receipt`, `GET /api/proposals/{id}/verify`, `POST /api/agent/run` | `placeOrder`, `getOrderReceipt`, `verifyProposal` (`src/server/services/purchasing.ts`) | Covered |

### Story 2: Order products based on customer recipe

| Step | Endpoint | Service / Function | Status |
| --- | --- | --- | --- |
| Pre-req 1: Mock recipe data for salmon soup | `GET /api/recipes`, `GET /api/recipes/{id}` | `DEFAULT_VALIO_RECIPES` (`recipe-salmon-soup`), `listRecipes`, `getRecipeById` (`src/server/services/recipes.ts`) | Covered |
| Pre-req 2: Mock inventory ingredients stock | `GET /api/inventory`, `PUT /api/inventory` | `DEFAULT_MOCK_INVENTORY`, `listInventory` (`src/server/services/inventory.ts`) | Covered |
| 1. Query recipe data `[Product name] - [Product type] - [Quantity]` | `POST /api/proposals/from-recipe`, `POST /api/agent/run` | `createProposalFromRecipe`, `findRecipeByDishQuery` (`src/server/services/recipes.ts`) | Covered |
| 2. Calculate total quantity for each item | `POST /api/proposals/from-recipe` | `reconcileRecipeIngredientsWithInventory` (`src/server/services/inventory.ts`) | Covered |
| 3. Calculate `actually needed = total needed - inventory stock` | `POST /api/proposals/from-recipe` | `reconcileRecipeIngredientsWithInventory` (`src/server/services/inventory.ts`) | Covered |
| 4–8. Product search, name match ranking, preference filtering, history sort, budget check | `POST /api/proposals/from-recipe` | `createProposalFromItems` (`src/server/services/selection.ts`) → `evaluateDraft` (`src/server/services/policy.ts`) | Partial (dietary + allergens + vendor/CO2/reliability; nutrition limits not configurable: needs contract change) |
| 9. Create an order (frozen proposal) | `POST /api/proposals/from-recipe` | `createProposal` (`src/server/services/purchasing.ts`) | Covered |
| 10. Ask for customer approval or changes (`change product X on product Y`) | `POST /api/proposals/{id}/approval`, `POST /api/approvals/{id}/decision`, `POST /api/proposals/{id}/revise`, `POST /api/agent/run` | `requestApproval`, `decideApproval`, `reviseProposalFromRequest` | Covered |
| 11. Checkout order and provide receipt | `POST /api/proposals/{id}/order`, `GET /api/orders/{id}/receipt`, `POST /api/agent/run` | `placeOrder`, `getOrderReceipt` (`src/server/services/purchasing.ts`) | Covered |

### Core Features Coverage

1. **Connect to the synthetic backend**: `src/server/valio/client.ts` (`fetchPrices`, `fetchAvailability`, mock fallback when `VALIO_API_KEY` unset) + `src/server/services/mock-catalog.ts` (when real catalog is empty).
2. **Structured product search**: `GET /api/products`, `GET /api/products/{id}` (`src/server/services/catalog.ts`).
3. **Price and availability lookup**: `GET /api/products/{id}/offer`, `POST /api/offers` (`src/server/services/catalog.ts`, 5-minute snapshot cache).
4. **Requirement-based filtering**: `GET /api/products` filters, `POST /api/products/rank`, `evaluateBuyerPreferences` (`src/server/services/selection.ts`).
5. **Price-and-availability inquiry**: `POST /api/inquiries` (`src/server/services/inquiry.ts`).
6. **Product comparison and selection**: `POST /api/products/rank` (`src/server/purchasing/ranking.ts`).
7. **Order preview and validation**: `POST /api/policy/evaluate`, `POST /api/proposals` (`src/server/services/policy.ts`, `src/server/services/purchasing.ts`).
8. **Order placement**: `POST /api/proposals/{id}/order` (`placeOrder` with idempotency key + live price/availability re-check).
9. **Agent permission rules (guardrails)**: `GET/PUT /api/preferences/*`, `evaluatePolicy` (`src/server/policy/evaluate.ts`).
10. **Human approval workflow**: `POST /api/proposals/{id}/approval`, `GET /api/approvals`, `POST /api/approvals/{id}/decision`, lazy expiry (`expireStaleApprovals`).
11. **Open, documented agent interface**: OpenAPI 3.1 at `/api/openapi.json` and Swagger UI at `/api/docs`, plus Mastra tools in `src/server/agents/tools/`.
12. **End-to-end autonomous purchasing flow**: `POST /api/agent/run` (`src/server/services/agent.ts`, `src/server/agents/purchasing-agent.ts`).

### Needed contract changes

- **`src/shared/contracts/preferences.ts` (`PreferencesSchema`)**: add configurable nutrition limits so `customerPreferencesFor` and `evaluateBuyerPreferences` can enforce organization-level nutrition thresholds instead of hardcoding `nutrition: {}`:
  ```ts
  // Proposed addition to PreferencesSchema (plus DEFAULT_PREFERENCES.nutrition = null):
  nutrition: z.object({
    maxCaloriesPer100g: z.number().positive().optional(),
    maxFatPer100g: z.number().nonnegative().optional(),
    maxSugarPer100g: z.number().nonnegative().optional(),
    maxSaltPer100g: z.number().nonnegative().optional(),
    minProteinPer100g: z.number().nonnegative().optional(),
  }).nullable().meta({
    description: "Per-100g nutritional limits. Null = no nutrition limits. Products without nutrition data are not excluded.",
  }),
  ```
