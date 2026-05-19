# Deal Modeler — Implementation Plan

A code-level plan for adding the **Deal Modeler** to `greenroom-starter`. The Deal Modeler turns the prose deal email into a structured, simulatable, shared deal object at capture time — and explicitly flags clauses that read two ways, before the show, for everyone.

This plan is the handoff artifact for the implementation model (Sonnet). Pair it with the original spec (`Greenroom-enhancements.md`) when starting work.

---

## Locked-in decisions

| Decision | Choice | Notes |
|---|---|---|
| Extraction backend | **Claude API** via `@anthropic-ai/sdk` | Requires `ANTHROPIC_API_KEY`. Prompt-cached system prompt. |
| Mutations | **Server Actions** (React 19 / Next 16) | Codebase has no `/api` routes today — keep it that way. |
| Modeler UI location | **Tab on the show detail page** | Implement via a new shared `app/shows/[id]/layout.tsx` with tabs Overview / Settle / Model. The Model tab lives at `app/shows/[id]/model/page.tsx`. |
| Shared view | **`/shared/[token]/page.tsx`** | Opaque 32-char token, no auth. Viewer self-identifies as agent/tour-manager + email. |
| JSON-shaped fields | **Drizzle JSON columns** | Matches existing `bonuses_json`, `calculation_json` convention. |
| Migration strategy | **Hand-edit `schema.ts`, regenerate `data/greenroom.db`** via `db/seed.ts` rewrite | No Drizzle Kit migrations — the starter is seeded fresh. |
| Demo data | **4 pre-modeled deals seeded** (one Coastal Spell-style ambiguity) + live extraction works for new pasted emails | Reports/shows list have data immediately. |

---

## Phase 0 — Schema & seed foundation

**Files touched:** `db/schema.ts`, `db/seed.ts`, `data/greenroom.db`, `lib/queries.ts`

### 0.1 Extend the `Bonus` union in `schema.ts`
Add the `walkout_pot` variant alongside the existing four:
```ts
| { type: "walkout_pot"; label: string; threshold: number; surplusRate: number }
```
`surplusRate = 1.0` means 100% of gross above the threshold.

### 0.2 Add new columns to the `deals` table
```ts
sourceEmailText:        text("source_email_text"),
modelStatus:            text("model_status", { enum: ["draft","shared","confirmed"] }).default("draft"),
shareToken:             text("share_token").unique(),
agentConfirmedAt:       integer("agent_confirmed_at", { mode: "timestamp" }),
venueConfirmedAt:       integer("venue_confirmed_at", { mode: "timestamp" }),
recoupDeclarationsJson: text("recoup_declarations_json", { mode: "json" }).$type<RecoupDeclaration[]>(),
ambiguityFlagsJson:     text("ambiguity_flags_json", { mode: "json" }).$type<AmbiguityFlag[]>(),
extractionMetaJson:     text("extraction_meta_json", { mode: "json" }).$type<ExtractionMeta>(),
```

### 0.3 Define and export new TS types from `schema.ts`

```ts
export type RecoupDeclaration = {
  id: string;
  category: "marketing" | "hospitality_overage" | "production_overage"
          | "prior_advance" | "damages" | "other";
  label: string;
  capAmount: number;
  deductionBasis: "gross" | "net";
  deductionOrder: "inside_expense_cap" | "outside_expense_cap"
                | "before_split" | "after_split";
};

export type AmbiguityFlag = {
  id: string;
  sourceClause: string;
  affectedFields: string[];
  readings: {
    label: string;
    description: string;
    configDelta: Record<string, unknown>;
  }[];
  status: "open" | "resolved";
  resolvedReading: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
};

export type ExtractionMeta = Record<
  string,
  { confidence: number; sourceSpan: string }
>;
```

### 0.4 Rewrite seed data for 3–4 deals

Pick four existing seeded shows and populate:
- `sourceEmailText` — a realistic deal email (write four: one flat, one % of gross, one Vs, one with a marketing-recoup ambiguity).
- The **Coastal Spell-style** deal: include a clause like _"$900 marketing recoupable against the $2,500 expense cap"_ — ambiguous on inside-vs-outside the cap. Pre-populate `ambiguityFlagsJson` with one open flag so the UI renders data before extraction is wired up.
- Pre-populate `recoupDeclarationsJson` and `extractionMetaJson` so screens are demoable independently of the LLM.

### 0.5 Update `lib/queries.ts`
- `getShowById` already pulls the deal; ensure the new JSON fields deserialize.
- Add `getDealByShareToken(token: string)` for the public shared view.
- Add `getShowsWithOpenAmbiguity()` for the shows-list indicator and reports metric.

---

## Phase 1 — Extraction service & intake

**Files added:**
- `lib/dealExtraction.ts`
- `app/shows/[id]/layout.tsx` (new shared layout with tabs)
- `app/shows/[id]/model/page.tsx`
- `app/shows/[id]/model/intake.tsx` (client component)
- `app/actions/extractDeal.ts` (Server Action)

### 1.1 Install dependency
```
npm install @anthropic-ai/sdk
```
Add `ANTHROPIC_API_KEY` to `.env.local` and document it in `README.md`.

### 1.2 Shared layout with tabs
`app/shows/[id]/layout.tsx`:
- Renders the show header (artist, date, status, deal type pill).
- Tab bar: **Overview / Settle / Model**, each linking to its route segment.
- Active tab is determined from the URL pathname.
- Wraps `{children}` (the active tab's page).

### 1.3 `lib/dealExtraction.ts`
```ts
export async function extractDealFromEmail(emailText: string): Promise<{
  deal: Partial<DealFields>;
  recoupDeclarations: RecoupDeclaration[];
  bonuses: Bonus[];
  extractionMeta: ExtractionMeta;
  candidateAmbiguities: AmbiguityFlag[];
}>;
```
- Single Claude call with **prompt caching** on the (long) system prompt that describes the JSON output contract.
- System prompt rule: "leave fields empty if not found, never guess. Always return `sourceSpan` quoting the exact phrase from the email."
- For each extracted field: `{ value, confidence: 0–1, sourceSpan: "exact substring from email" }`.
- Ambiguity detection is done inline in the same LLM pass — see Phase 2.

### 1.4 Intake UI
On the Model tab when `deals.sourceEmailText` is null:
- Paste textarea OR forwarded-email block.
- "Extract deal" button → calls Server Action `extractDeal(showId, emailText)`.
- Action: saves `sourceEmailText`, calls extractor, writes structured fields/flags/meta. Sets `modelStatus = 'draft'`.

---

## Phase 2 — Ambiguity detection

**Files added/modified:** `lib/ambiguityDetection.ts`; used inside `lib/dealExtraction.ts`.

### 2.1 Pattern catalog
Hard-code 3–5 known ambiguity patterns informed by the dispute history:
```ts
type AmbiguityPattern = {
  id: string;
  matchHint: string;
  buildFlag: (clause: string) => AmbiguityFlag;
};
```
Required patterns:
- **Marketing recoup vs. expense cap** (Coastal Spell case): two readings — `inside_expense_cap` vs. `outside_expense_cap`, each with concrete `configDelta` on `recoupDeclarations[i].deductionOrder`.
- **"After expenses" without specifying cap behavior** → reading A vs. B on cap inclusion.
- **Sellout bonus on "tickets sold"** — counts comps or not?
- **Vs deal "or X% of gross"** — gross of face value or net of fees?

### 2.2 Detector
The LLM is asked: _"For each clause, does it admit more than one consistent structured reading? If yes, return the source clause and competing readings."_ The pattern catalog gives the LLM strong priors in the prompt. Post-process by mapping LLM-returned readings into `configDelta` shape using the pattern's helper.

---

## Phase 3 — Simulation engine (centerpiece)

**Files added:** `lib/dealSimulation.ts` (the existing `lib/dealMath.ts` stays for the legacy `/settle` page).

### 3.1 Function signature
```ts
type SimInput = {
  deal: DealRecord;             // structured deal incl. recoupDeclarations
  hypothetical: {
    gross: number;
    expenses?: number;
    ticketsSold?: number;
    sellout?: boolean;
  };
  flagOverride?: { flagId: string; readingLabel: string };
};

type SimResult = {
  steps: SimStep[];
  totalToArtist: number;
  appliedReadings: Record<string, string>;
};

export function simulate(input: SimInput): SimResult;
```

### 3.2 Deal-type coverage (load-bearing)
Implement all five types: `flat`, `percentage_of_gross`, `percentage_of_net`, `vs`, `door`. Each respects:
- Expense cap
- Recoup declarations **in the order specified by `deductionOrder`** (this is the load-bearing change vs. existing `dealMath`)
- Bonuses, including the new `walkout_pot` type → `surplusRate * max(0, gross - threshold)`

### 3.3 Dual-reading API
```ts
export function simulateBothReadings(
  deal: DealRecord,
  flagId: string,
  hypothetical: SimInput["hypothetical"]
): {
  readingA: { label: string; result: SimResult };
  readingB: { label: string; result: SimResult };
  delta: number;
};
```
Deep-clone the deal, apply each reading's `configDelta`, run `simulate`, diff the totals.

### 3.4 Simulator UI
`components/modeler/simulator.tsx`:
- Gross input, optional expense input, sellout toggle.
- For each open flag, render side-by-side payouts with the dollar delta highlighted (rose if > $500, else neutral).
- Collapsible step-by-step formula breakdown per reading.

---

## Phase 4 — Review, recoups, and resolution UI

**Files added:**
- `components/modeler/extraction-review.tsx`
- `components/modeler/recoup-editor.tsx`
- `components/modeler/ambiguity-card.tsx`
- `app/actions/updateDealField.ts`, `app/actions/resolveAmbiguity.ts`

### 4.1 Side-by-side review (F2)
- Left pane: raw `sourceEmailText` with highlighted `sourceSpan` ranges keyed to focused field.
- Right pane: editable structured deal fields. Each shows a confidence pip — green ≥ 0.9 / amber 0.6–0.9 / rose < 0.6.
- Low-confidence fields auto-scrolled into view.

### 4.2 Recoup editor (F5)
Table columns: label, category, capAmount, deductionBasis, **deductionOrder**.
- `deductionOrder` is a 4-option dropdown — the dispute-defining field.
- Tooltip on the header explains each option with a one-line example.

### 4.3 Ambiguity card (F3 + F7 resolution)
Each open flag renders:
- Source clause (quoted, attributed to the email).
- Two readings side-by-side, each with a "Choose this reading" button.
- Inline mini-sim showing the dollar gap at a default gross (uses `simulateBothReadings`).
- Resolution form: optional note, submitter name. On submit, action writes `status: 'resolved'`, `resolvedReading`, `resolvedBy`, `resolvedAt`, applies `configDelta` to the deal.

---

## Phase 5 — Sharing

**Files added:**
- `app/shared/[token]/page.tsx`
- `app/shared/[token]/confirm.tsx` (client)
- `app/actions/shareDeal.ts`, `app/actions/confirmAsViewer.ts`

### 5.1 Share token generation
`shareDeal(dealId)` action:
- Generates `share_token` (`crypto.randomUUID()` without dashes) if not present.
- Sets `modelStatus = 'shared'`.
- Returns `{ url: '/shared/<token>' }`.
- "Copy link" UI element on the modeler page.

### 5.2 Public view (`/shared/[token]/page.tsx`)
- Same structured deal display as the venue view, but **all inputs read-only**.
- Banner: "You're viewing the deal model The Crescent has built. Confirm or flag issues."
- Identity picker: "I'm the agent" / "I'm the tour manager" + email field.
- Simulator is fully functional (read-only deal, viewer can run hypotheticals).
- Ambiguity cards visible but resolution is **suggest-only** (writes a note, doesn't apply the `configDelta` — venue makes the final call).

### 5.3 Confirmation tracking
`confirmAsViewer(token, role, email)` sets `agentConfirmedAt` or `venueConfirmedAt`.
When both are set + all flags resolved → `modelStatus = 'confirmed'`.

---

## Phase 6 — Surfacing on existing pages

**Files modified:**
- `app/shows/shows-list.tsx` — small rose pill when `ambiguityFlagsJson` has open flags ("2 open questions").
- `app/shows/[id]/page.tsx` — banner at top if open flags exist, linking to the Model tab.
- `components/layout/sidebar.tsx` — optional count badge on "Shows" link.
- `app/reports/page.tsx` — new metric block: "Deals with unresolved questions" (count + total $ at stake, summed from `simulateBothReadings` deltas).

---

## Phase 7 — Export

**Files added:**
- `lib/exports/clarificationEmail.ts` (pure function returning a string)
- `lib/exports/dealSpreadsheet.ts` (CSV generation)

### 7.1 Clarification email (F8)
For each open flag, generate a paragraph:
> "Quick clarification on _[show]_: the email says _'[sourceClause]'_. We're reading this two ways — (A) [reading A], or (B) [reading B]. At a hypothetical $X gross, the difference is $Y. Can you confirm which we agreed?"

Outputs a single email body. Use `mailto:?subject=…&body=…` or copy-to-clipboard.

### 7.2 Spreadsheet export (F8)
CSV of the structured deal with a section per: terms, bonuses, recoups, open questions. Download as `deal-<artist>-<date>.csv`.

---

## File-by-file deliverables summary

| Path | Action | Phase |
|---|---|---|
| `db/schema.ts` | Edit: add columns, new types, Bonus union | 0 |
| `db/seed.ts` | Rewrite: include 4 demo deal emails + pre-flagged Coastal Spell case | 0 |
| `lib/queries.ts` | Edit: add 2 queries, deserialize new JSON | 0 |
| `lib/dealExtraction.ts` | New | 1 |
| `lib/ambiguityDetection.ts` | New | 2 |
| `lib/dealSimulation.ts` | New (full deal-type coverage) | 3 |
| `lib/exports/clarificationEmail.ts` | New | 7 |
| `lib/exports/dealSpreadsheet.ts` | New | 7 |
| `app/shows/[id]/layout.tsx` | New (tab bar shared across Overview/Settle/Model) | 1 |
| `app/shows/[id]/model/page.tsx` | New | 1 (built up through phases) |
| `app/shows/[id]/model/intake.tsx` | New | 1 |
| `app/shared/[token]/page.tsx` | New | 5 |
| `app/shared/[token]/confirm.tsx` | New | 5 |
| `app/actions/extractDeal.ts` | New | 1 |
| `app/actions/updateDealField.ts` | New | 4 |
| `app/actions/resolveAmbiguity.ts` | New | 4 |
| `app/actions/shareDeal.ts` | New | 5 |
| `app/actions/confirmAsViewer.ts` | New | 5 |
| `components/modeler/extraction-review.tsx` | New | 4 |
| `components/modeler/recoup-editor.tsx` | New | 4 |
| `components/modeler/ambiguity-card.tsx` | New | 4 |
| `components/modeler/simulator.tsx` | New | 3 |
| `app/shows/shows-list.tsx` | Edit: unresolved indicator | 6 |
| `app/shows/[id]/page.tsx` | Edit: banner + Model tab now appears | 6 |
| `app/reports/page.tsx` | Edit: new metric block | 6 |

---

## Out of scope for this prototype

- `deal_negotiated_by_agent_id` column (deal-time agent provenance, spec SP7). Note it in the closing memo as a follow-up.
- Normalizing `recoup_declarations_json` and `ambiguity_flags_json` into related tables. The prototype uses JSON to match the existing `bonuses_json` convention.
- Magic-link auth for the shared view. The role-picker + email path is the prototype-appropriate substitute.

---

## Recommended execution order

1. **Phase 0** (schema, types, seed, queries) — stop here for review before going further. Everything downstream depends on the JSON shapes being right.
2. **Phase 3** (simulation engine) — implement before the UI so the UI can call into a real engine from day one.
3. **Phase 1** (extraction + intake) — gets the LLM call working end-to-end on one pasted email.
4. **Phase 2** (ambiguity detection) — extends the same LLM pass.
5. **Phase 4** (review/recoups/ambiguity UI) — assembles the modeler experience.
6. **Phase 5** (sharing) — once the modeler is whole, expose it read-only.
7. **Phase 6** (surfacing) — wire indicators into the rest of the app.
8. **Phase 7** (export) — small, last; doesn't block the demo.
