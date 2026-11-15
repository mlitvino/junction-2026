# Aimo TrustBridge design system v3.2

Updated 15 November 2026. This is the current frontend visual and interaction standard. The v3.2 task, UX changelog and actual shared contracts take precedence over older Stitch copy. Stitch HTML and screenshots are design references, never runtime code.

## Shared foundation

One dashboard layout owns AppShell, AppHeader, AppSidebar, mobile drawer/tabs, notifications, theme control and account menu. Route pages supply content only. Header height is 64px; desktop sidebar width is 248px. Conversation reading width is 840px, data width 1240px. Page padding is 16px mobile, 24px tablet, 32px desktop. Review drawer is 420px on desktop and remains nonmodal with the conversation composer accessible.

Primary navigation: Assistant, To review, Restocking, Recipes, Orders. Secondary: Settings & Administration, with Agents & Policies, Organization, Activity & Audit and Integrations. Use actual buyer/approver roles, including both roles. This presentation is not server authorization.

The sidebar footer contains one full-width Settings & Administration link with a gear, visible label, softly tinted background and rounded corners, including in the mobile navigation drawer. Separate it from the navigation above with a fine border and preserve its active state. Account name and roles appear in the header account menu, without duplication in the sidebar.

The header has page context on the left and notifications, theme, account on the right, without an environment badge. Do not put Mock, Demo, Simulated, Simulation or internal status enums in customer-facing copy. Explain operational limitations where decisions need them: Payment unavailable, Not connected, Availability not confirmed, Order recorded. A recorded order never implies payment, supplier dispatch or confirmed delivery.

The account trigger shows initials and the account name; its outline, filled avatar and trailing sliders icon appear when the popup is open. Reserve the icon's space while hidden so the trigger never shifts or resizes on opening. The right-aligned popup separates identity/roles/organization from action rows with fine dividers. Use sliders for Organization preferences, an outline shield and disclosure chevron for fixture-only Development tools, and an exit icon for connected sign-out. Keep native Escape/light dismissal and close the popup after navigation.

## Semantic tokens

`src/app/globals.css` implements the tokens through Tailwind v4 `@theme inline`, `:root` and `.dark`. Use semantic utilities in components; no per-page hardcoded colors.

| Token                  | Light             | Dark              |
| ---------------------- | ----------------- | ----------------- |
| background             | #F8FAF8           | #121615           |
| foreground             | #202B29           | #CFDAD6           |
| card                   | #FFFFFF           | #181E1C           |
| card-foreground        | #202B29           | #CFDAD6           |
| popover                | #FFFFFF           | #212926           |
| popover-foreground     | #202B29           | #CFDAD6           |
| primary                | #176B55           | #22A380           |
| primary-foreground     | #FFFFFF           | #101B17           |
| secondary / muted      | #EAF5EF / #F0F4F1 | #212926           |
| secondary-foreground   | #176B55           | #CFDAD6           |
| muted-foreground       | #687571           | #A5B3AF           |
| accent                 | #EAF5EF           | #2A3531           |
| accent-foreground      | #176B55           | #D8F3E8           |
| border                 | #E5EBE8           | #283430           |
| input                  | #D7E1DB           | #44534D           |
| ring                   | #176B55           | #60D7AF           |
| destructive            | #B42318           | #F87171           |
| destructive-foreground | #FFFFFF           | #151B19           |
| warning / surface      | #916000 / #FFF6DF | #E9BB60 / #30291B |
| success / surface      | #23734A / #EAF5EF | #7AC79B / #1B3026 |
| info / surface         | #45627A / #EDF3F8 | #A5BFD5 / #202C36 |

Light, Dark and System use the same markup, layout and typography. System is the default until the user chooses an override. The header button immediately switches to the opposite resolved theme, without a menu; it shows a sun in Light and a moon in Dark, with a short rotation/fade transition that respects reduced-motion preferences. The dependency-free theme provider persists the user's choice, listens to system changes and initializes the document before hydration. Theme switching works if storage is unavailable.

## Typography and spacing

Inter throughout, with system sans fallback; weights 400, 500, 600. No alternate dark-mode font. Use tabular numerals for quantities and prices. Technical IDs belong in expandable evidence.

| Use             | Desktop | Mobile  |
| --------------- | ------- | ------- |
| Welcome display | 32/40px | 28/36px |
| Page title      | 28/36px | 24/32px |
| Section title   | 20/28px | 18/26px |
| Card title      | 16/24px | 16/24px |
| Body            | 14/22px | 14/22px |
| Conversation    | 16/26px | 16/26px |
| Label           | 13/18px | 13/18px |
| Caption         | 12/17px | 12/17px |

Spacing scale: 4, 8, 12, 16, 24, 32, 40, 48, 64px. Card padding 16px mobile, 24px desktop. Fine borders, 8-14px radii, restrained shadows for floating controls only. Prefer whitespace and progressive disclosure to nested bordered grids.

## Common components and behaviors

Shared presentation lives in `src/features/workspace/ui.tsx` and existing `src/components/`: PageHeader, StatusBadge, ProductLine, PriceDisplay, OrderSummary, ApprovalCard, BasketReviewDrawer, EvidenceDisclosure, loading/empty/error states and confirmation dialogs. ConversationComposer, AgentProgress, RecipeIngredientRow and RestockPlanCard are reused in their feature contexts. One ApprovalCard governs chat and approval-detail actions.

- Assistant welcome: vertically and horizontally centered title/description with a compact single-line request composer and circular send button. No decorative hero icon or separate catalog CTA. Suggestions and recent conversations sit underneath in native disclosures, collapsed by default, with small chevrons beside their labels. Each suggestion occupies one full-width row with a relevant outline icon, single-line label and trailing chevron. Choosing it fills and focuses the composer; Enter submits. Recent conversations have a chat icon and a status badge derived from their latest purchase record; never replace missing data with a successful order status. Keep these lists free of explanatory filler.
- Conversation: use a spacious message stream with compact right-aligned user bubbles and a small assistant preparation indicator with expandable progress. Avoid a duplicate page heading, New conversation action, fixed follow-up suggestions or About this conversation footer. The bottom composer shares the welcome field's rounded styling, starts at one line and grows with wrapped text up to 192px before scrolling. Enter sends; Shift+Enter adds a line. Keep helper instructions accessible without visible filler inside the field. The composer remains usable while working, reviewing, blocked, rejected and ordered. Show one current recommendation; older versions and evidence collapse. Progress describes local preparation, never fictitious SSE delivery.
- Conversation composer positioning: fixed to the viewport, 16px above the desktop bottom or 8px above mobile navigation plus the safe area. Align its width with the message column and adapt to the review drawer. Reserve its measured height in the document so the final message can scroll fully above it; keep an opaque background below the input.
- Conversation history: persist the presentation sequence of messages, product selections and proposals. Insert each new entry after the previous one; never regroup cards below all messages. Successful product selection collapses into a read-only summary in its original position, before its proposal. Failed preparation remains editable. New requests use a new selection; submitted selections cannot create a second proposal. Preserve the sequence across refresh without changing canonical purchasing contracts.
- Material changes withdraw the old canonical proposal before superseding it. Information questions preserve its hash and pending approval. A cancellation failure cannot silently invalidate server state.
- Human review is the default. Autonomous ordering needs explicit server ALLOW, configured autonomy, valid quote and confirmed sufficient supply. No timer or refresh automatically places an order.
- Approval and order confirmations refer to the frozen server proposal. Rejection requires a reason. Quote expiry and 409 conflicts require an updated proposal, never a local fallback success.
- Restocking plans and schedules are local until server support exists. Manual checks separate ready, partial/late, unknown and already-covered items. Unknown items remain excluded.
- Recipe planning scales yield, aggregates compatible ingredients, subtracts kitchen stock once and verifies sales-unit conversions. Mandatory free-from requirements remain blocked when positive evidence is missing. Recipe edits are explicitly local drafts; creating a new version is a separate supported write.
- Orders show recorded status, exact net totals, line details and available approval history. Checkout explains unavailable payment and has no fake payment action.
- Order detail begins with Back to Orders, a reference/status heading, source and approval metadata, then the assistant and checkout actions. A divided items card uses package icons, clear quantity/date/unit-price hierarchy and right-aligned totals. A separate card shows a timestamped lifecycle with connecting lines and state icons; technical evidence expands below. Supplier identity, dietary claims, VAT and delivery confirmation must come from records, not the design reference.
- Audit states its browser-local scope; integrations distinguish app health from provider connectivity. Unsupported credentials, scheduler and MCP actions explain missing support.

## Price, stock and status language

Canonical purchasing money is numeric EUR **excluding VAT**. Always label totals `excl. VAT`. Gross amounts and tax rates may appear only if the server supplies them; never assume a universal rate. Proposal prices are frozen until `quoteExpiresAt`; an offer fetch time is not a reservation.

Display internal READY as Prepared, PENDING_APPROVAL as Awaiting review, APPROVED as Approved, REJECTED as Rejected, BLOCKED as Needs attention, CANCELLED as Withdrawn (or Superseded for a replaced revision), ORDERED as Order recorded. Canonical order SIMULATED_CONFIRMED displays Recorded. Unknown quantity is not zero or confirmed stock; terminal supplier stock is not verified.

## Accessibility and verification

One h1, one main and one shared header per page. Native controls have labels, visible keyboard focus and adequate touch targets. Never encode status only with color. Drawers/menus support Escape; confirmation dialogs trap focus and restore it. Critical product/safety text wraps instead of truncating.

Verify 1440, 1280, 768 and 390px, both themes, System changes, 200% zoom, no horizontal page overflow, keyboard controls and persistent composer. Current evidence and all 29 state mappings are in `FRONTEND-UX-IMPLEMENTATION-STATUS.md`. Browser screenshots are comparison artifacts, not proof of supplier fulfillment or backend security.
