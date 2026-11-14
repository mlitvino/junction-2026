# Paste this into Codex (in the checked-out `frontend` branch)

Implement the **entire Aimo TrustBridge frontend v3.2** in one coordinated task, not just a shell or a few mock screens.

Read **all** of `docs/CODEX-FULL-FRONTEND-IMPLEMENTATION-v3.2.md` and `docs/FRONTEND-READINESS-AND-CHECKLIST-v3.2.md`, plus the user-provided `docs/UX-CHANGELOG-v3.2.md`, `design/stitch-v3.2/SCREEN-MANIFEST.md`, `design/stitch-v3.2/DESIGN.md`, every relevant screen.png/code.html, `CHECKLIST.md`, root/nested `AGENTS.md`, current `docs/DESIGN-SYSTEM.md`, the actual `src/shared/contracts/` and the actual backend Hono route definitions.

**Do the full work now.** First inspect current code and explain a brief implementation plan, then proceed across the complete frontend scope in the task document. Do not stop after planning; do not wait for my teammate to provide new contracts. Use the existing server APIs and Zod contracts in connected mode wherever available and typed deterministic frontend mocks for only the genuinely missing capabilities. You are not authorized to change backend-owned source, database/migrations, shared contracts or package dependencies.

Requirements that cannot be compromised:

- One consistent Nordic-green design system, one header/sidebar/account/theme, all 29 Stitch frames mapped to actual screens/states, dark and responsive mobile layouts.
- Clean human-centered Assistant, continuous composer, proposal revisions, inline approval, unified To Review, orders/checkout, restocking, recipes/meal planning, members/policies/admin/audit/integrations.
- Human approval for **every purchase by default**; autonomy only when real server policy explicitly allows it. Buyer+Approver can act in both capacities where server permits.
- **Real connected purchasing** must use `/api/proposals`, `/api/approvals`, `/api/proposals/{id}/order` rather than existing browser-local order state; never mix the alternate `/api/orders` AI model with canonical purchasing IDs/types.
- Preserve correct net vs gross VAT semantics, quote expiry/409 handling, idempotency, verified quantity units, stale approval blocking and source-of-truth safety.
- Only one unobtrusive `Development` tag; never visually repeat `Mock`, `Demo`, `Simulated` in customer-facing UI; never pretend supplier order/payment/stock verification occurred.
- Keep background restock scheduler, external MCP and global audit as explicit backend blockers if not implemented. Don't fake persistent cross-user behavior.
- Satisfy **every achievable frontend item** in `CHECKLIST.md`, add tests, update integration tracker truthfully, and list backend-owned remaining tasks.

Run baseline and final `pnpm check`, `pnpm test`, `pnpm build`; exercise connected and mock flows and browser visual/responsive tests when environment supports them. Report exactly what was verified vs only built.

**Expected result:** a complete functional v3.2 UI that matches the design direction and maximizes integration with the existing backend, not static Stitch HTML or a mock-only demo.
