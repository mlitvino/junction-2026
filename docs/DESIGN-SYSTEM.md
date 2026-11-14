# Aimo TrustBridge — Design System

**Version:** 1.0 (proposed for team approval)  
**Owner:** Frontend / Codex  
**Consumers:** Codex, Claude Code, reviewers, designers  
**Scope:** All first-party web UI screens in the Junction 2026 Next.js application  
**Design direction:** Nordic Culinary Editorial — calm, warm, trustworthy, minimal  
**Status:** Design specification, not a claim that components are already implemented

> **Purpose:** Turn fragmented Google Stitch concepts into **one coherent product**, with a single component library, shared application shell, and light/dark modes that change colors—not layout. The UI helps professional buyers accomplish procurement tasks; it is not a developer dashboard.

## 0. Authority, sources and non-goals

Read these references in order before changing frontend UI:

1. Root `AGENTS.md` — repository rules, ownership, stack, quality gates.
2. `docs/VALIO-CLIENT-TASKS.md` — **what the product must do**, routes, roles, API contracts, procurement states and acceptance criteria.
3. **This file** — **how the product should look and behave**.
4. `design/stitch/**` — visual reference material only; useful for content and composition, **not authoritative** for repeated headers, theme styles, code, API endpoints, or implementation details.

If references disagree:

- Security, domain states, business logic, DTOs and endpoints: follow the client/server task contract and agreed `src/shared/contracts/**`.
- Visual consistency, color, typography, spacing, global shell, common component behavior: follow this document.
- Specific screen inspiration not covered here: consult Stitch, then apply this design system.
- Do not implement the Stitch HTML verbatim, treat its generated backend URLs as real, or create separate React pages for its light/dark duplicates.

**Architecture boundary:** Use Next.js App Router, TypeScript strict, Tailwind CSS v4 and shadcn/ui. Frontend reads data through `src/client/api-client.ts`; do not import from `src/server/**`, invent Valio endpoints, expose secrets, or modify backend-owned files. Coordinate changes to shared contracts or dependencies with the backend owner.

## 1. Brand and experience principles

**Product promise:** *“Tell us what your kitchen needs. We will find suitable products, check commercial conditions, and guide the purchase safely.”*

1. **Assistant first, dashboard second.** The Buyer Workspace starts with a welcoming composer. It does not start with audit logs, technical diagnostics, stock matrices, or policy tables.
2. **One primary decision at a time.** Every view has one clearly dominant next action. Secondary actions use quieter styles.
3. **Progressive disclosure.** Offer summary first; reveal product evidence, package math, policy reasons, and raw trace metadata in drawers, accordions or detail pages.
4. **Trust through honesty.** Never turn `UNKNOWN` into success; never imply Terminal supplier stock is verified; never disguise a locally simulated order as a Valio order.
5. **Quiet visual hierarchy.** Reduce nested card borders, all-caps labels, competing badges, dense microtext, bright banners and unnecessary icons.
6. **Consistent and predictable.** Header, sidebar, typography, buttons, status badges and form behavior must look and work the same everywhere.
7. **Accessible by default.** Clear labels, keyboard navigation, visible focus, readable contrast, status text accompanying color, and no essential hover-only actions.
8. **Business language first.** Prefer “Waiting for manager approval” to “POLICY_REQUIRES_APPROVAL”; technical reason codes remain available in details.

**Avoid:** terminal/console aesthetics, heavy gradients, decorative activity graphs on every page, mixed serif/sans fonts across themes, large monospace technical identifiers, fake data badges, and excessive shadows.

## 2. Theme architecture and color tokens

One component tree supports **Light / Dark / System**, using semantic CSS variables and a single global theme provider. Theme choice persists across navigation; honor system preference when selected. Both themes use **the same font, spacing, sizing, radii, page layout and interactions**.

### 2.1 Core semantic tokens

The following HEX values are the *initial approved design targets*; implement them as CSS variables (not hard-coded in individual React components). Confirm accessible contrasts during implementation.

| Semantic role / CSS variable | Light | Dark | Usage |
|---|---|---|---|
| `--background` | `#F8FAF8` | `#121615` | Application background |
| `--foreground` | `#202B29` | `#CFDAD6` | Main text |
| `--card` | `#FFFFFF` | `#181E1C` | Cards, grouped content |
| `--card-foreground` | `#202B29` | `#CFDAD6` | Card text |
| `--popover` | `#FFFFFF` | `#212926` | Menus, floating content |
| `--popover-foreground` | `#202B29` | `#CFDAD6` | Floating-content text |
| `--primary` | `#176B55` | `#22A380` | Primary actions, selected navigation |
| `--primary-foreground` | `#FFFFFF` | `#101B17` | Text on primary action |
| `--secondary` | `#EAF5EF` | `#212926` | Quiet supporting action/background |
| `--secondary-foreground` | `#176B55` | `#CFDAD6` | Text on secondary background |
| `--muted` | `#F0F4F1` | `#212926` | Subtle group background |
| `--muted-foreground` | `#687571` | `#A5B3AF` | Supporting text / captions |
| `--accent` | `#EAF5EF` | `#2A3531` | Hover / active highlight |
| `--accent-foreground` | `#176B55` | `#D8F3E8` | Text on highlight |
| `--border` | `#E5EBE8` | `#283430` | Fine separators |
| `--input` | `#D7E1DB` | `#44534D` | Input outlines |
| `--ring` | `#176B55` | `#60D7AF` | Focus ring |
| `--destructive` | `#B42318` | `#F87171` | Destructive action / error |
| `--destructive-foreground` | `#FFFFFF` | `#151B19` | Text on destructive fill |

**Additional semantic colors:** define corresponding foreground and subtle-surface tokens in CSS, not scattered Tailwind arbitrary values. Use `warning` (amber), `success` (green) and `info` (slate/blue-neutral) only when they convey actual meaning. `primary` branding and `success` meaning are different concepts even when both are green.

**Color application rules**

- Base canvas = `background`; main cards = `card`; nested details = `muted` or border separator, **not three cards inside three more cards**.
- Use primary green for one high-emphasis action; do not make every label and button green.
- Reserve warning amber for incomplete information, uncertainty, approval needed, late availability or stale offers.
- Reserve red for genuine denial/failure/blocked requirement, not merely a more expensive alternative.
- Do not use color by itself to convey state: always pair with text/icon.
- All hover, focus, disabled and selected styles must exist in **both themes**.
- Do not duplicate pages as `/dark` or maintain separate light/dark component files.

### 2.2 Tailwind v4 and shadcn/ui implementation

Keep the existing `@theme inline` semantic variable mapping in `src/app/globals.css`. Replace its default neutral token values by the palette above through `:root` and `.dark`. If adding `warning` or `success` tokens, extend `@theme inline` deliberately.

```css
/* Illustrative subset; integrate with existing shadcn variables, do not replace @theme inline. */
:root {
  --background: #f8faf8;
  --foreground: #202b29;
  --card: #ffffff;
  --primary: #176b55;
  --primary-foreground: #ffffff;
  --border: #e5ebe8;
  --radius: 0.75rem;
}
.dark {
  --background: #121615;
  --foreground: #cfdad6;
  --card: #181e1c;
  --primary: #22a380;
  --primary-foreground: #101b17;
  --border: #283430;
}
```

**Implementation note:** The existing `globals.css` currently uses neutral oklch values and the root layout loads Geist. Switching to this approved Inter-based system is a frontend task, not yet completed. The CSS block above is a *subset*; preserve and populate the rest of the existing shadcn token set.

## 3. Typography

**One font family:** **Inter** for all page titles, navigation, body copy, forms, figures and status text in **both themes**. System sans-serif fallback. If external font loading fails, fallback must remain usable. No Newsreader in dark mode and no separate Geist body style.

| Token | Desktop | Mobile | Weight | Use |
|---|---|---|---|---|
| Display | 32px / 40px | 28px / 36px | 600 | Empty-state hero only |
| Page title | 28px / 36px | 24px / 32px | 600 | One `h1` per view |
| Section title | 20px / 28px | 18px / 26px | 600 | Main section heading |
| Card title | 16px / 24px | 16px / 24px | 600 | Product/approval title |
| Body | 14px / 22px | 14px / 22px | 400 | General UI copy |
| Large body | 16px / 26px | 16px / 26px | 400 | Empty state and chat text |
| Label | 13px / 18px | 13px / 18px | 500 | Form labels, headers |
| Caption | 12px / 17px | 12px / 17px | 400/500 | Secondary metadata |

Rules:

- Use weights 400, 500, 600; avoid uppercase paragraphs and dense tiny labels.
- Use `font-variant-numeric: tabular-nums` for prices, quantities, timestamps and counts.
- Technical IDs may use a monospace style **inside expandable technical details**, never as the main page headline.
- Product names can wrap across two lines; never truncate critical allergens/constraint warnings.
- English is the primary UI language. Preserve Finnish/Swedish product names as supplier data, without inventing translations.

## 4. Spacing, dimensions, surfaces and responsiveness

### 4.1 Spacing scale

Use a 4px base with an 8px structural rhythm:

`4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64px`

- Inline icon/text: 8px.
- Small item stacks: 12–16px.
- Internal card padding: 20–24px desktop, 16px mobile.
- Main section separation: 24–32px.
- Page content padding: 32px desktop, 24px tablet, 16px mobile.
- The welcome state uses extra whitespace; it is not a table placed inside a giant empty card.

### 4.2 Global layout

| Element | Rule |
|---|---|
| Persistent app header | **64px high** on desktop; shared across every authenticated page |
| Desktop sidebar | **248px** fixed width; active item uses a subtle green highlight |
| Main content | Fluid width, max **1240px** for data views; max **840px** for a conversational reading column |
| Header controls | Notifications, theme switcher, account menu **always in the same positions** |
| Demo notice | Small, persistent `Demo environment · Orders are simulated` in the shell; not a large colored alert banner |
| Data regions | Up to 2 main columns; avoid 3 dense management panels in Buyer Workspace |
| Destructive action | Confirmation dialog; never place next to the primary CTA without separation |

**Responsive breakpoints**

- **≥1280px:** Full sidebar and spacious workspace; optional secondary detail pane.
- **1024–1279px:** Keep sidebar if space allows; content may collapse to one column.
- **768–1023px:** Sidebar becomes compact or overlay; card columns stack as needed.
- **<768px:** One-column page, accessible menu/sheet, no clipped actions, no page-wide horizontal scrolling.

Target checks: **1440, 1280, 768 and 390px**. Support browser zoom to 200% without hiding critical actions.

### 4.3 Shape and depth

- Default control radius: **10px**. Card radius: **12px**. Dialog/drawer: **14px**. Pills: fully rounded.
- Borders: subtle 1px lines from `--border`; never use thick frames around each data field.
- Shadows: none for normal inline cards; very soft for dialogs/popovers only.
- Hover: gentle background/border change; no animated lifting or neon glows.
- Motion: 120–200ms for simple transitions; respect `prefers-reduced-motion`.

## 5. Global Application Shell — one implementation

`src/app/(dashboard)/layout.tsx` must render **one shared shell**, not copy-pasted headers in page files. Suggested shared components in `src/components/layout/`:

- `AppShell` — responsive layout, main landmark, theme boundary.
- `AppHeader` — current page context, notifications, theme, account.
- `AppSidebar` — section links, active state, authorized sections only.
- `MobileNavigation` — a menu/sheet at small widths.
- `NotificationsPopover` — unread indicator, readable events, empty/loading state.
- `ThemeToggle` — Light, Dark, System; accessible label and persisted setting.
- `AccountMenu` — user's display name, organization context, sign out.
- `DemoEnvironmentIndicator` — honest mode notice from backend metadata.
- `PageHeader` — one title, optional explanatory line, **one** contextual primary action.

### 5.1 Navigation model

**Primary:** Workspace, Approvals, Orders.  
**Administration:** Agents & Policies, Activity & Audit, Integrations.  
**User/account:** Settings or account menu if implemented.

- Render sections according to `SessionUser.roles`; this is **presentation only**, not authorization.
- Keep icon choices, order, labels, selection indicators, unread counts, and mobile grouping stable on every page.
- Never fabricate notification counts or an online status. Display server-derived status or a clearly labeled mock fixture.
- Direct navigation to `/approvals/[id]`, `/orders/[id]` and `/admin/agents/[id]` must preserve the same header/sidebar and work on reload.
- Login and error pages may use a minimal shell rather than the authenticated sidebar.

### 5.2 Global header behavior

Desktop order: **page context** on the left; **notification bell → theme toggle → account menu** on the right. Keep the notice for simulated ordering visibly present but quiet. Mobile: collapse nonessential text, retain accessible access to notifications, theme and account. Do not add “Export Trace”, “Agent Core Version” or “Simulate Agent Run” as universal header buttons.

## 6. Component library and visual behavior

Build reusable components on top of shadcn/ui. Do not duplicate Stitch-generated button, table, header, checkbox or dialog styles per page.

| Component | Design and interaction requirement |
|---|---|
| `Button` | Primary / secondary / ghost / destructive; 40px desktop, min 44px mobile interactive target; busy and disabled states |
| `Input` / `Textarea` | Clear label and helper text; valid/error/focus states; 40–44px height; chat composer may expand |
| `Card` | Simple 12px radius, light border, 20–24px padding; avoid nested card overload |
| `Badge` / `StatusChip` | Short meaningful label + icon/text, semantic color only, accessible contrast |
| `Dialog` | Focus trap, Escape semantics, confirmation of meaningful/destructive actions |
| `Drawer` / `Sheet` | Product evidence, agent execution details, filters and mobile navigation |
| `Table` | Low visual density; sorting/filter controls only where functional; responsive overflow handling or mobile cards |
| `Tabs` | Use for true alternative views, not to hide critical action states |
| `Accordion` | Secondary procurement evidence and technical details; never mandatory warnings |
| `Toast` | Feedback after real confirmed response; no unverified success toast |
| `Skeleton` | Calm loading placeholders that match actual content structure |
| `EmptyState` | Clear explanation and next action; no blank unexplained tables |
| `ErrorState` | Plain-English reason, safe retry, trace reference in details, never leaked secret |

**Button hierarchy:** one solid primary CTA per actionable section, secondary outline next, ghost tertiary actions. Don't show `Approve`, `Request Approval`, `Commit` and `Reject` all as equal primary buttons in one panel. Actions must be available only for the actual backend domain state.

## 7. Domain-specific patterns — procurement UI

### 7.1 Buyer Workspace

**Empty state:** single friendly headline (“What can I help you order?”), short supporting sentence, prominent multiline chat composer, 2–3 example prompts. Do not show catalog tables, policy audits or empty inspector panels.

**During run:** show the user's request, concise assistant response and one compact progress component. Progress phases come from actual SSE events: `understanding`, `catalog_search`, `offer_check`, `comparison`, `policy_check`, `approval`, `commit`. Do not show stages as complete unless events confirm them. A collapsible run detail is acceptable; raw event JSON is not a primary screen element.

**Requirements summary:** one small inline summary of quantity, unit, requested date, budget and mandatory conditions, with `Edit requirements`. Show hard constraints versus preferences separately. If date or unit mapping is uncertain, visibly ask for clarification.

**Proposal ready:** show **one recommended offer prominently**. Use `Compare alternatives` to reveal up to a few additional candidates. Each offer card prioritizes product name, package/quantity, gross price, availability date and brief match rationale. Source evidence, tax breakdown, `closingTime`, product IDs, carbon and packaging math live in accessible expanded details.

**Do not hide decision-critical exceptions:** allergen uncertainty, unknown physical conversion, unavailable quantity, later-than-requested availability, unpriced charges and Terminal supplier-stock uncertainty must remain visible near the affected proposal or action.

### 7.2 Product and offer cards

Display in this priority:

1. Product name / brand; optional thumbnail only if there is a valid asset.
2. Availability **with certainty qualifier** and exact relevant date.
3. Proposed sales quantity and requested physical quantity, as returned by backend.
4. Total gross price if known; otherwise “Price unavailable”.
5. Short match explanation and mandatory-constraint state.
6. Expandable `Why this product?` and `View evidence` containing API source, check timestamp and conversion provenance.

Do not calculate authoritative amount, VAT, availability or package conversion in components. Only format backend-issued string decimals/minor-unit values. Comparison price (`€/L`, `€/kg`) must be labeled as comparison price, not necessarily a sales-unit price.

### 7.3 Policy decision and approval

| Backend outcome/state | Human-facing label | Presentation | Primary interaction |
|---|---|---|---|
| `ALLOW` | Allowed by purchasing policy | Calm green + text | Show actual next action/state from API; don't promise completion prematurely |
| `REQUIRE_APPROVAL` | Manager approval required | Amber + explanation | Review / open approval request |
| `DENY` | Purchase blocked | Red + concise reason | Revise requirements / inspect reasons; no commit |
| `UNKNOWN` verification | Could not verify this requirement | Amber + explicit limitation | Review/clarify; **never** auto-confirm safety |
| `PENDING` approval | Waiting for approval | Neutral/amber | View request, no implied commit |
| `REAPPROVAL_REQUIRED` | Purchase details changed — review again | Amber | Re-evaluate updated proposal |
| `SIMULATED_CONFIRMED` order | Simulated order confirmed | Calm green plus explicit simulator qualifier | View order and history |

**Approvals inbox:** optimized for scanning pending requests and reasons, not an audit dashboard. **Approval detail:** fixed purchase summary, reason for approval, verified/unknown evidence; Approve and Reject with confirmation (reject requires reason). Make any changed proposal prominent and stop action until re-evaluated.

### 7.4 Order and audit views

- Orders list: reference, human-readable summary, total, date, and clear simulated status; filters should not dominate the page.
- Order detail: line items, requested delivery date, approval, traceable action history; never show goods as delivered because a simulated order was recorded.
- Audit: chronology first, reason and actor second, raw metadata expanded on demand. Only authorized events appear; no decorative “tamper-evident”, “cryptographically verified” or similar assurances unless the backend confirms that capability.
- Integrations: can be more technical than Buyer Workspace, but must use the same shell and tokens. Only show real/canonical application routes, not invented domains from Stitch.

## 8. Status language and semantics

Do not infer status color from a string containing `success` or `pass`; map documented enums explicitly. Use the same status rendering helper/components across the app.

Examples:

- **Confirmed/allowed:** “Within agent limit”, “Policy allows purchase”.
- **Needs action:** “Awaiting manager approval”, “Delivery date needs review”.
- **Unavailable/blocked:** “Product cannot be ordered”, “Mandatory allergen condition not met”.
- **Unknown:** “Supplier stock not confirmed”, “Package conversion needs verification”, “Price unavailable”.
- **Simulated:** “Recorded in local simulator — not submitted to Valio”.

A successful green `ALLOW` policy **is not** an order confirmation. An `APPROVED` approval **is not necessarily** a committed order. The only confirmed order UI must be backed by an actual server `Order` with `SIMULATED_CONFIRMED`.

### 8.1 Notifications

Notifications are a secondary navigation aid: unread count, concise subject, relative time (with exact accessible timestamp), destination link, and mark-read action only if the backend supports it. If the API doesn't yet support notification storage, display an empty-state popover or a clearly labeled mock; **do not invent persistent notification endpoints** in frontend code.

### 8.2 Theme, session and error states

- Theme control is always present within authenticated shell; toggling must not reset navigation, user input or conversation state.
- After `401`, show login/expired-session flow without leaking data from previous tenant/session.
- After `403`, show an explicit permission page/state, not a broken empty table.
- After `409`, show stale/conflict reason and safe recovery; don't retry commit silently.
- For `429`, `502`, `503`, retain editable request and make retry available when appropriate.
- Missing data displays “Not available” or “Not verified”, never placeholder `0` or checkmark.

## 9. Responsive rules and accessibility

- Test viewport widths: **1440 / 1280 / 768 / 390px** and 200% browser zoom.
- Keyboard-only path: navigate sidebar, send prompt, inspect proposal, open approval, approve/reject, open order.
- Forms have explicit labels and errors; avoid placeholder-only labels.
- Visible focus indicator in light and dark modes; keyboard focus must not disappear behind fixed header.
- Use semantic headings (`h1` per page), buttons for actions, anchors for navigation.
- Status updates from AI stream use a restrained `aria-live="polite"` region; do not announce every token or overwhelm screen readers.
- Dialogs trap focus and return focus to trigger; destructive actions require confirmation.
- Use icons plus text for blocked/unknown/approved states, never color alone.
- Aim for WCAG AA contrast: 4.5:1 for standard text, 3:1 for large text and visual components; validate final token combinations rather than assuming hex choices guarantee it.
- Support `prefers-reduced-motion`; no animated content required for comprehension.
- Avoid viewport-level horizontal scroll. Long IDs and product titles wrap/truncate responsibly with access to full text.

## 10. Component map and page coverage

| Route | Primary components | Design emphasis |
|---|---|---|
| `/login` | LoginForm, simple shell | Clear authentication and error state |
| `/buyer` | ChatComposer, WelcomeState, AgentProgress, RequirementsSummary | Conversational, lots of whitespace |
| `/buyer/conversations/[id]` | ConversationThread, AgentProgress, ProposalPreview | A single readable narrative |
| `/proposals/[id]` | ProposalSummary, ProductCard, ComparisonDrawer, PolicyDecision | One recommended option, evidence on demand |
| `/approvals` | ApprovalInbox, StatusFilter, ApprovalRow | Scan and decide |
| `/approvals/[id]` | ApprovalDetail, RiskSummary, ApproveRejectDialog | Immutable snapshot and deliberate action |
| `/orders` | OrdersList, StatusBadge | Calm, readable history |
| `/orders/[id]` | OrderDetail, AuditTimeline | Honest simulated state and traceability |
| `/audit` | AuditTimeline, Filters, EvidenceDrawer | Human explanation before technical payload |
| `/admin/agents` | AgentTable, RegisterAgentDialog | Manage access with clarity |
| `/admin/agents/[id]` | PolicyEditor, ScopedTokenDialog | High-trust forms, explicit confirmations |
| `/integrations` | ProtocolOverview, ConnectionHealth | Real REST/MCP information, no fake URLs |

The Stitch export covers only some administrative screens. **Do not treat missing Buyer Workspace screens as optional**. Build them using the product UX requirements above and `VALIO-CLIENT-TASKS.md`.

## 11. Implementation guidance for Codex

1. Read `AGENTS.md`, client tasks, this document and **all** Stitch references first.
2. Identify and preserve existing shared contracts/ownership. The backend owner controls `src/server/**`, `src/app/api/**`, backend infra and `package.json` dependencies; ask for approved dependency additions (`next-themes`, `lucide-react`, UI primitives) rather than editing their zone unilaterally.
3. Implement global design tokens and Inter, then one dashboard `AppShell` with Header/Sidebar/Theme/Account. Coordinate edits to root layout and global CSS as required by repo ownership.
4. Build the Buyer Workspace from mock DTOs and implement one complete vertical slice before porting every admin screen.
5. Refactor Stitch screens into shared components; never keep two sets of pages for light/dark and never copy Tailwind CDN markup into Next.js.
6. Keep data/mock state in `src/client/**`, not page components; all new views use typed `ApiClient` and validated fixtures.
7. Treat routes and status enums in the client/backend contract as canonical; the design document **does not** authorize new backend functionality.
8. Run `pnpm check`, `pnpm build`, frontend tests if present, and manually compare screenshots at target widths in **both** themes.
9. Report what is implemented, what is mock-only, and which integration points remain backend-dependent.

## 12. Visual and functional acceptance checklist

- [ ] All authenticated pages share one `AppHeader`, `AppSidebar` and responsive layout.
- [ ] Notifications, theme control and account menu occupy consistent positions and work consistently.
- [ ] Light/dark/system switch changes only colors/surfaces, not fonts or layout geometry.
- [ ] No hard-coded hex colors in page components; semantic tokens are used throughout.
- [ ] No clipped actions or viewport horizontal overflow at 1440/1280/768/390px.
- [ ] Buyer Welcome is simple and immediately usable.
- [ ] Agent progress reflects real SSE or explicitly labeled mock events, not fabricated progress.
- [ ] One prominent recommendation, with alternatives and deeper evidence accessible.
- [ ] Hard-constraint failures and unknown supplier data remain visible near decisions.
- [ ] Approval UI never implies that a human approved an altered proposal.
- [ ] Order success always says **simulated** and has a server-issued or explicitly fixture-issued ID.
- [ ] Accessibility: keyboard, labels, visible focus, semantic controls and checked contrast.
- [ ] UI compiles, contract fixtures validate, and `pnpm check` / `pnpm build` pass.

---

### Document change policy

Changes to tokens, shared components, global navigation or status mapping require an explicit design-system update and a quick review across at least **Buyer Workspace, Approval Detail and Orders** in both themes. If a change affects API DTOs, route names or permissions, update the shared contracts **with the backend owner**; do not quietly solve it in frontend-only code.
