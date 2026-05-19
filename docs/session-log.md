# Greenroom Deal Modeler — Session Log

> Exported from Claude Code session `e90da271-4ef2-4368-8eca-74e6e99cf7a2`  
> Date: 2026-05-17  
> Project: `c:\Users\eesh2\greenroom-starter`

---

## Project Overview

**Greenroom** is a Next.js + Drizzle/SQLite venue management app for **The Crescent**, a 650-cap Nashville venue. Primary user is **Mariana**, the booker. The session built out a **Deal Modeler** feature on top of an existing settlement/show-tracking app.

### Stack
- Next.js (App Router, React 19 Server Actions)
- Drizzle ORM + SQLite (`data/greenroom.db`)
- Anthropic SDK (`@anthropic-ai/sdk`) — claude-opus-4-7 for extraction
- Tailwind CSS with custom design tokens (`ink-*`, `brand-*`)

### Key domain concepts
- **Recoup declarations** — venue costs taken before the artist's share. `deductionOrder` is the dispute-defining field (4 options: `inside_expense_cap`, `outside_expense_cap`, `before_split`, `after_split`).
- **Ambiguity flags** — deal email clauses with multiple valid structured readings. Each carries a `configDelta` (path/value pairs) so the simulator can run both and show the dollar delta.
- **`vs` deal** — guarantee vs percentage, whichever is greater. Bonuses suppressed when guarantee wins.
- **`walkout_pot`** bonus — artist takes `surplusRate` of every gross dollar above a threshold.
- **Coastal Spell dispute** — the reference dispute. Hinged on whether a $900 marketing recoup was `inside_expense_cap` (artist-favorable) or `outside_expense_cap` (venue-favorable), producing a $720 delta between Mariana's calc ($11,565) and WME's counter ($12,285).

---

## Implementation Plan Reference

Full plan lives at `docs/deal-modeler-plan.md`. Recommended execution order:

1. **Phase 0** ✅ — Schema, types, seed, queries
2. **Phase 3** ✅ — Simulation engine (`lib/dealSimulation.ts`)
3. **Phase 1** ✅ — Extraction service + intake UI
4. **Phase 2** ✅ — Ambiguity detection pattern catalog
5. **Phase 4** ✅ — Review, recoups, and resolution UI
6. **Phase 5** ⬜ — Sharing (`/shared/[token]`)
7. **Phase 6** ⬜ — Surfacing on existing pages (shows list indicators, reports)
8. **Phase 7** ⬜ — Export (clarification email, CSV)

---

## Completed Work (This Session)

### Bugs Fixed

#### 1. `ANTHROPIC_API_KEY` not found at runtime
**Cause:** Dev server was running before `.env.local` was created/modified. Next.js reads env files at startup.  
**Fix:** Restart the dev server. The key lives at `c:\Users\eesh2\greenroom-starter\.env.local`.

#### 2. 400 error from Anthropic API — invalid JSON schema
**Error:** `output_config.format.schema: Invalid schema: Enum value 'gross' does not match declared type '['string', 'null']'`  
**Cause:** The Anthropic structured output validator does not support `type: ["string", "null"]` (JSON Schema array-type union syntax). It also rejects `enum` arrays containing `null`.  
**Fix:** In `lib/dealExtraction.ts`, replaced all nullable fields from:
```ts
// BEFORE (invalid)
{ type: ["string", "null"] }
{ type: ["number", "null"] }
{ type: ["string", "null"], enum: ["gross", "net", null] }

// AFTER (valid)
{ anyOf: [{ type: "string" }, { type: "null" }] }
{ anyOf: [{ type: "number" }, { type: "null" }] }
{ anyOf: [{ type: "string", enum: ["gross", "net"] }, { type: "null" }] }
```
Fields affected: `showDate`, `artist.genre`, `agent.name`, `agent.email`, `agent.agency`, `deal.guaranteeAmount`, `deal.percentage`, `deal.percentageBasis`, `deal.expenseCap`, `deal.hospitalityCap`.

---

### Phase 2 — Ambiguity Detection Catalog

**File created:** `lib/ambiguityDetection.ts`

Typed catalog of the 4 known ambiguity patterns the Claude extractor is primed on. The actual detection runs in the LLM pass (`lib/dealExtraction.ts`); this file is the code-level source of truth so labels stay consistent between the extractor and the UI.

```ts
type AmbiguityPattern = {
  id: string;
  summary: string;
  matchHints: string[];       // keyword/phrase triggers in the email
  affectedFields: string[];   // dotted/bracketed configDelta path prefixes
  readings: readonly [string, string]; // [reading A label, reading B label]
};
```

The 4 patterns:
1. `marketing_recoup_vs_cap` — inside vs. outside the expense cap (the Coastal Spell pattern)
2. `after_expenses_cap_behavior` — cap as ceiling vs. flat venue buyout
3. `sellout_bonus_comps` — paid tickets only vs. including comps
4. `gross_face_vs_net_fees` — % of gross: face value vs. net of ticketing fees

---

### Phase 4 — Review, Recoups, and Resolution UI

#### Server Actions

**`app/actions/resolveAmbiguity.ts`** *(new)*

Called when Mariana picks a reading on an ambiguity card.

1. Loads deal row by `showId`
2. Finds the flag by `flagId`, finds the chosen reading by `readingLabel`
3. Applies `reading.configDelta` to a mutable object mirroring the `DealRecord` shape using `setByPath` (handles paths like `recoupDeclarations[0].deductionOrder`)
4. Marks flag: `status: "resolved"`, `resolvedReading`, `resolvedBy`, `resolutionNote`, `resolvedAt: Date.now()`
5. Writes updated `ambiguityFlagsJson`, `recoupDeclarationsJson`, and affected scalar columns back to DB
6. Calls `revalidatePath` on `/shows/${showId}` and `/shows/${showId}/model`

```ts
export async function resolveAmbiguity(
  showId: string,
  flagId: string,
  readingLabel: string,
  resolvedBy: string,
  resolutionNote: string,
): Promise<{ ok: true } | { ok: false; error: string }>
```

**`app/actions/updateDealField.ts`** *(new)*

Type-safe single-field updater. Uses a discriminated union and a `switch` statement to produce typed Drizzle patch objects.

```ts
type DealFieldUpdate =
  | { field: "dealType"; value: "flat" | "percentage_of_gross" | "percentage_of_net" | "vs" | "door" }
  | { field: "guaranteeAmount"; value: number | null }
  | { field: "percentage"; value: number | null }
  | { field: "percentageBasis"; value: "gross" | "net" | null }
  | { field: "expenseCap"; value: number | null }
  | { field: "hospitalityCap"; value: number | null }
  | { field: "recoupDeclarations"; value: RecoupDeclaration[] };

export async function updateDealField(
  showId: string,
  update: DealFieldUpdate,
): Promise<{ ok: true } | { ok: false; error: string }>
```

#### UI Components

**`components/modeler/extraction-review.tsx`** *(new)*

Client component. Two panels side-by-side inside a `Card`:

- **Left — Source email**: Renders raw email as `<pre>`. When a field is focused on the right, finds that field's `sourceSpan` in the email text and wraps it in an amber `<mark>`. Clicking another field switches the highlight; clicking the same field clears it.
- **Right — Extracted fields**: All 6 deal fields as editable inputs (number inputs with `$`/`%` affixes; selects for `dealType` and `percentageBasis`). Each field shows a colored confidence dot from `extractionMeta`:
  - Green dot: confidence ≥ 0.9
  - Amber dot: 0.6 ≤ confidence < 0.9
  - Rose dot: confidence < 0.6
  - Clicking a field focuses it (highlights email span) and shows the source phrase below
- When any field is edited, a "Save changes" button appears; fires `updateDealField` for all 6 scalar fields sequentially

**`components/modeler/recoup-editor.tsx`** *(new)*

Client component. Editable table of `RecoupDeclaration[]`:

| Column | Input type |
|---|---|
| Label | Text input (inline, border appears on hover/focus) |
| Category | Display only |
| Cap amount | Number input with `$` prefix |
| Basis | Select (gross / net) |
| Deduction order | Select — **color-coded**: brand green = `inside_expense_cap`, rose = `outside_expense_cap`, neutral = before/after split |

Info icon on the "Deduction order" header shows a tooltip explaining all 4 options. Save button calls `updateDealField("recoupDeclarations", updatedArray)`.

**`components/modeler/ambiguity-card.tsx`** *(new)*

Client component. One card per `AmbiguityFlag`.

**Open flag:**
- Blockquote showing `sourceClause`
- Runs `simulateBothReadings(deal, flag.id, { gross: defaultGross, expenses: 1500 })`
- Two panels side-by-side: reading label + dollar total + description text
- ±swing badge (rose if > $500)
- "Choose this reading" button opens a confirmation form with optional name + note fields
- Confirming calls `resolveAmbiguity`; `revalidatePath` re-renders the page with resolved state

**Resolved flag:**
- Shows which reading was chosen (brand-green border on winning panel)
- Displays `resolvedBy`, `resolutionNote`, resolution date

#### Page Updated

**`app/shows/[id]/model/page.tsx`** *(modified)*

New render order when a deal email is present:

1. Header (unchanged — breadcrumb, artist name, status badges, open question count)
2. `<Simulator>` — hero number + dual-reading cards (unchanged)
3. `<ExtractionReview>` — email with span highlighting + editable fields with confidence pips
4. `<RecoupEditor>` — conditional on `recoupDeclarations.length > 0`
5. `<AmbiguityCard>` — one per flag, conditional on `ambiguityFlags.length > 0`

The old static "Source email" card (left column of the 2/5 + 3/5 grid) is removed — its content is now inside `ExtractionReview` with interactive highlighting.

---

## File Map — Current State

```
greenroom-starter/
├── app/
│   ├── actions/
│   │   ├── createShowFromEmail.ts   ✅ Phase 1
│   │   ├── resolveAmbiguity.ts      ✅ Phase 4 (new)
│   │   └── updateDealField.ts       ✅ Phase 4 (new)
│   └── shows/
│       ├── intake-card.tsx          ✅ Phase 1
│       ├── page.tsx                 ✅ Phase 0
│       ├── shows-list.tsx
│       └── [id]/
│           ├── layout.tsx           ✅ Phase 1
│           ├── page.tsx
│           ├── model/
│           │   └── page.tsx         ✅ Phase 4 (updated)
│           ├── settle/
│           └── show-tabs.tsx
├── components/
│   └── modeler/
│       ├── ambiguity-card.tsx       ✅ Phase 4 (new)
│       ├── extraction-review.tsx    ✅ Phase 4 (new)
│       ├── recoup-editor.tsx        ✅ Phase 4 (new)
│       └── simulator.tsx            ✅ Phase 3
├── db/
│   ├── index.ts
│   ├── schema.ts                    ✅ Phase 0
│   └── seed.ts                      ✅ Phase 0
├── lib/
│   ├── ambiguityDetection.ts        ✅ Phase 2 (new)
│   ├── dealExtraction.ts            ✅ Phase 1 (bug fixed)
│   ├── dealMath.ts                  (legacy — used by /settle)
│   ├── dealSimulation.ts            ✅ Phase 3
│   ├── format.ts
│   ├── queries.ts                   ✅ Phase 0
│   └── utils.ts
└── docs/
    ├── deal-modeler-plan.md         (full spec)
    └── session-log.md               (this file)
```

---

## Remaining Work

### Phase 5 — Sharing
- `app/shared/[token]/page.tsx` — public read-only deal view
- `app/shared/[token]/confirm.tsx` — identity picker + confirmation
- `app/actions/shareDeal.ts` — generates `shareToken`, sets `modelStatus: "shared"`
- `app/actions/confirmAsViewer.ts` — sets `agentConfirmedAt` / `venueConfirmedAt`

### Phase 6 — Surfacing on existing pages
- `app/shows/shows-list.tsx` — rose pill for shows with open ambiguity flags
- `app/shows/[id]/page.tsx` — banner linking to Model tab when open flags exist
- `app/reports/page.tsx` — "Deals with unresolved questions" metric block (count + total $ at stake via `simulateBothReadings` deltas)

### Phase 7 — Export
- `lib/exports/clarificationEmail.ts` — generates a clarification email body for each open flag
- `lib/exports/dealSpreadsheet.ts` — CSV export of structured deal terms, bonuses, recoups, open questions

---

## Key Design Decisions (for reference)

| Decision | Choice |
|---|---|
| Nullable fields in JSON schema | Must use `anyOf: [{type: "string"}, {type: "null"}]` — Anthropic API rejects `type: ["string", "null"]` |
| `configDelta` paths | Relative to `DealRecord` shape (e.g. `recoupDeclarations[0].deductionOrder`) — matches `dealSimulation.ts`'s `applyConfigDelta` |
| `outside_expense_cap` semantics | Cap is reinterpreted as a flat buyout (floor), not just moving the recoup outside a ceiling — this asymmetry is load-bearing for the Coastal Spell demo |
| Bonuses suppressed for `vs` deals | When guarantee wins over the percentage, bonuses are suppressed — matches the legacy `dealMath` convention |
| No Drizzle Kit migrations | Schema changes are applied by rewriting `schema.ts` and re-seeding with `db/seed.ts` |
| Prompt caching | The large system prompt in `dealExtraction.ts` is sent with `cache_control: { type: "ephemeral" }` |
