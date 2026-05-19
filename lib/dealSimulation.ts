/**
 * Deal Modeler simulation engine.
 *
 * Distinct from lib/dealMath.ts in three important ways:
 *
 *   1. Covers ALL five deal types — flat, percentage_of_gross,
 *      percentage_of_net, vs, and door — not just the two the legacy
 *      settlement tool handles.
 *   2. Knows about RecoupDeclaration entries on the deal, and respects
 *      each recoup's `deductionOrder` (inside_expense_cap /
 *      outside_expense_cap / before_split / after_split).
 *   3. Supports the new `walkout_pot` bonus variant.
 *
 * The engine is pure: same input → same SimResult. UI components run it
 * synchronously on every slider change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE on the inside/outside expense-cap semantics
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Coastal Spell dispute (March 2025) hinged on this single field, and
 * the historical $720 delta between Mariana's calc ($11,565) and WME's
 * counter ($12,285) only reproduces under a SPECIFIC reading:
 *
 *   inside_expense_cap → the expense cap is a CEILING. Total deductions
 *     (actual expenses + recoup) are capped at expense_cap.
 *       deductions = min(actual_expenses + recoup_amount, expense_cap)
 *
 *   outside_expense_cap → the expense cap is treated as a venue BUYOUT
 *     (a flat amount the venue keeps regardless of actual costs), and the
 *     recoup is taken on TOP of it.
 *       deductions = expense_cap + recoup_amount
 *
 * The "outside" reading is asymmetric to "inside" — it doesn't just move the
 * recoup outside the ceiling, it also reinterprets the cap as a floor. This
 * matches how the venue actually argued the dispute, where "expense cap"
 * was read as a guaranteed venue cut rather than a max. Documented here
 * because the asymmetry is non-obvious and changing it would silently
 * break the demo's hero number.
 */

import type {
  Deal,
  Bonus,
  RecoupDeclaration,
  AmbiguityFlag,
} from "@/db/schema";

// Standard ticketing fees as a fraction of gross. Matches what the seed
// generates and what real venues see (~10%).
const DEFAULT_FEE_RATE = 0.1;

// -------- Public types --------

/**
 * A "decoded" deal — the raw Drizzle row with its JSON columns parsed into
 * structured objects. The simulator operates on this shape so callers don't
 * have to deal with JSON.parse at every step.
 */
export type DealRecord = {
  dealType: Deal["dealType"];
  guaranteeAmount: number | null;
  percentage: number | null;
  percentageBasis: "gross" | "net" | null;
  expenseCap: number | null;
  hospitalityCap: number | null;
  bonuses: Bonus[];
  recoupDeclarations: RecoupDeclaration[];
  ambiguityFlags: AmbiguityFlag[];
};

export type SimInput = {
  deal: DealRecord;
  hypothetical: {
    gross: number;
    expenses?: number;
    ticketsSold?: number;
    sellout?: boolean;
    // Capacity is needed for attendance-threshold bonuses. Optional — if
    // omitted, attendance bonuses are reported as "can't determine".
    capacity?: number;
  };
  // Optionally pin one ambiguity flag to a chosen reading. Used by
  // simulateBothReadings to compute each side of a dual-reading delta.
  flagOverride?: { flagId: string; readingLabel: string };
};

export type SimStep = {
  label: string;
  value: number; // the dollar magnitude associated with this step
  kind:
    | "input" // a starting value (e.g. gross)
    | "deduction" // subtracts from the running total
    | "subtotal" // a checkpoint (e.g. "net box office")
    | "split" // a percentage split (e.g. "80% of $X")
    | "bonus" // adds a bonus
    | "total"; // the final number-to-artist
  note?: string;
};

export type SimResult = {
  steps: SimStep[];
  totalToArtist: number;
  // Which reading was applied for each flag — empty if no flag overrides
  // and no resolved flags. Useful for UI annotations.
  appliedReadings: Record<string, string>;
};

// -------- Decoder --------

/**
 * Take a raw Drizzle deal row (with JSON columns as strings) plus its
 * already-parsed neighbours and return a DealRecord ready for simulation.
 * Most callers will get these parsed sub-fields from getShowById /
 * getDealByShareToken, which already JSON.parse them.
 */
export function decodeDeal(
  deal: Deal,
  opts?: {
    bonuses?: Bonus[];
    recoupDeclarations?: RecoupDeclaration[];
    ambiguityFlags?: AmbiguityFlag[];
  },
): DealRecord {
  const safeParse = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  return {
    dealType: deal.dealType,
    guaranteeAmount: deal.guaranteeAmount,
    percentage: deal.percentage,
    percentageBasis: deal.percentageBasis,
    expenseCap: deal.expenseCap,
    hospitalityCap: deal.hospitalityCap,
    bonuses: opts?.bonuses ?? safeParse<Bonus[]>(deal.bonusesJson, []),
    recoupDeclarations:
      opts?.recoupDeclarations ??
      safeParse<RecoupDeclaration[]>(deal.recoupDeclarationsJson, []),
    ambiguityFlags:
      opts?.ambiguityFlags ??
      safeParse<AmbiguityFlag[]>(deal.ambiguityFlagsJson, []),
  };
}

// -------- Flag override resolution --------

/**
 * Apply a single reading's `configDelta` to a deal in place. The configDelta
 * uses dotted/bracketed paths like "recoupDeclarations[0].deductionOrder".
 * Returns the mutated deal for fluent chaining; callers should pass a clone.
 */
function applyConfigDelta(
  deal: DealRecord,
  configDelta: Record<string, unknown>,
): DealRecord {
  for (const [path, value] of Object.entries(configDelta)) {
    setByPath(deal as unknown as Record<string, unknown>, path, value);
  }
  return deal;
}

/**
 * Tiny path-setter. Supports dotted segments and `[idx]` indexes only —
 * the configDelta paths we generate are always shallow. Quietly no-ops on
 * malformed paths to avoid throwing in the middle of a simulation.
 */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  // Normalize "a.b[0].c" → ["a","b","0","c"]
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current == null || typeof current !== "object") return;
  (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
}

function cloneDeal(deal: DealRecord): DealRecord {
  return JSON.parse(JSON.stringify(deal)) as DealRecord;
}

/**
 * Walk the deal's flags and apply (a) any explicit flagOverride from input,
 * and (b) any resolved flag's chosen reading. Returns a new deal (does not
 * mutate the input) plus a map of which reading was applied for each flag.
 */
function applyReadings(
  deal: DealRecord,
  flagOverride: SimInput["flagOverride"],
): { deal: DealRecord; appliedReadings: Record<string, string> } {
  const working = cloneDeal(deal);
  const applied: Record<string, string> = {};

  for (const flag of working.ambiguityFlags) {
    // The override beats the flag's own resolved state — that's how the
    // dual-reading UI lets viewers preview the "other" reading.
    if (flagOverride && flagOverride.flagId === flag.id) {
      const reading = flag.readings.find(
        (r) => r.label === flagOverride.readingLabel,
      );
      if (reading) {
        applyConfigDelta(working, reading.configDelta);
        applied[flag.id] = reading.label;
        continue;
      }
    }
    if (flag.status === "resolved" && flag.resolvedReading) {
      const reading = flag.readings.find(
        (r) => r.label === flag.resolvedReading,
      );
      if (reading) {
        applyConfigDelta(working, reading.configDelta);
        applied[flag.id] = reading.label;
      }
    }
  }

  return { deal: working, appliedReadings: applied };
}

// -------- Deduction computation (the load-bearing recoup logic) --------

type DeductionResult = {
  // Net the artist's percentage is computed against — i.e. what's left of
  // the box office after every deduction that happens BEFORE the split.
  netForSplit: number;
  // Deductions that happen AFTER the split, taken out of the artist's share.
  afterSplitDeductions: number;
  steps: SimStep[];
};

/**
 * Apply all expense + recoup deductions per the deal's structure. Net flows
 * through these stages:
 *
 *   gross
 *     → (less ticketing fees if dealType uses net) → net
 *     → (less inside/outside-cap deductions)        → netForSplit
 *     → split into artist's share
 *     → (less after_split recoups)
 *
 * The `before_split` recoups are deducted from gross/net before the split.
 * The `after_split` recoups are returned separately so the deal-type switch
 * can subtract them after computing the artist's share.
 */
function computeDeductions(
  net: number,
  actualExpenses: number,
  expenseCap: number | null,
  recoups: RecoupDeclaration[],
): DeductionResult {
  const steps: SimStep[] = [];

  // Partition recoups by deduction order.
  const inside = recoups.filter((r) => r.deductionOrder === "inside_expense_cap");
  const outside = recoups.filter((r) => r.deductionOrder === "outside_expense_cap");
  const beforeSplit = recoups.filter((r) => r.deductionOrder === "before_split");
  const afterSplit = recoups.filter((r) => r.deductionOrder === "after_split");

  let netForSplit = net;

  if (expenseCap != null) {
    if (outside.length > 0) {
      // Venue-favorable buyout reading: cap functions as a flat amount, and
      // outside-cap recoups stack on top. See file-level note.
      const outsideTotal = outside.reduce((s, r) => s + r.capAmount, 0);
      netForSplit -= expenseCap;
      steps.push({
        label: `Expense cap (treated as flat buyout)`,
        value: expenseCap,
        kind: "deduction",
      });
      if (outsideTotal > 0) {
        netForSplit -= outsideTotal;
        for (const r of outside) {
          steps.push({
            label: `${r.label} (outside cap)`,
            value: r.capAmount,
            kind: "deduction",
            note: `Recoup deducted on top of the $${expenseCap.toLocaleString()} cap`,
          });
        }
      }
      // If there are inside-cap recoups in addition to outside ones, that's
      // a mixed structure — still cap their sum-with-expenses at the cap.
      if (inside.length > 0) {
        const insideTotal = inside.reduce((s, r) => s + r.capAmount, 0);
        const insideAbsorbed = Math.min(actualExpenses + insideTotal, expenseCap);
        // Already counted the cap above; nothing more to subtract.
        for (const r of inside) {
          steps.push({
            label: `${r.label} (inside cap)`,
            value: r.capAmount,
            kind: "deduction",
            note: `Absorbed by the cap (no additional deduction)`,
          });
        }
        void insideAbsorbed; // documented for reader; cap already taken
      }
    } else {
      // No outside-cap recoups → cap behaves as a ceiling.
      const insideTotal = inside.reduce((s, r) => s + r.capAmount, 0);
      const totalAbsorbable = actualExpenses + insideTotal;
      const deductedToCap = Math.min(totalAbsorbable, expenseCap);
      netForSplit -= deductedToCap;
      if (actualExpenses > 0) {
        steps.push({
          label: actualExpenses + insideTotal > expenseCap
            ? `Expenses + recoups, capped at $${expenseCap.toLocaleString()}`
            : `Expenses`,
          value: actualExpenses + insideTotal > expenseCap
            ? expenseCap
            : actualExpenses,
          kind: "deduction",
        });
      }
      for (const r of inside) {
        const willOverflowCap = actualExpenses + insideTotal > expenseCap;
        steps.push({
          label: `${r.label} (inside cap)`,
          value: r.capAmount,
          kind: "deduction",
          note: willOverflowCap
            ? `Cap reached — recoup absorbed`
            : `Counts toward the $${expenseCap.toLocaleString()} cap`,
        });
      }
    }
  } else {
    // No expense cap defined — deduct expenses straight, and treat
    // inside/outside-cap recoups identically (just deduct).
    if (actualExpenses > 0) {
      netForSplit -= actualExpenses;
      steps.push({
        label: "Expenses (no cap)",
        value: actualExpenses,
        kind: "deduction",
      });
    }
    for (const r of [...inside, ...outside]) {
      netForSplit -= r.capAmount;
      steps.push({
        label: r.label,
        value: r.capAmount,
        kind: "deduction",
      });
    }
  }

  // Before-split recoups: deducted straight off the net before the artist's
  // percentage is applied.
  for (const r of beforeSplit) {
    netForSplit -= r.capAmount;
    steps.push({
      label: `${r.label} (before split)`,
      value: r.capAmount,
      kind: "deduction",
    });
  }

  // After-split recoups: held for the caller to subtract post-split.
  const afterSplitDeductions = afterSplit.reduce((s, r) => s + r.capAmount, 0);

  return {
    netForSplit: Math.max(0, netForSplit),
    afterSplitDeductions,
    steps,
  };
}

// -------- Bonuses --------

function computeBonuses(
  bonuses: Bonus[],
  gross: number,
  ticketsSold: number | undefined,
  sellout: boolean | undefined,
  capacity: number | undefined,
): { applied: { label: string; amount: number }[]; total: number } {
  const applied: { label: string; amount: number }[] = [];

  for (const b of bonuses) {
    switch (b.type) {
      case "gross_threshold":
        if (gross >= b.threshold) {
          applied.push({ label: b.label, amount: b.amount });
        }
        break;
      case "sellout":
        if (sellout) applied.push({ label: b.label, amount: b.amount });
        break;
      case "attendance_threshold":
        if (
          ticketsSold != null &&
          (capacity == null || ticketsSold >= b.threshold)
        ) {
          if (ticketsSold >= b.threshold) {
            applied.push({ label: b.label, amount: b.amount });
          }
        }
        break;
      case "walkout_pot":
        if (gross > b.threshold) {
          const overage = gross - b.threshold;
          applied.push({
            label: b.label,
            amount: Math.round(overage * b.surplusRate * 100) / 100,
          });
        }
        break;
      case "tier_ratchet": {
        // Ratchet bonus: the artist's percentage is computed in tiers, each
        // tier paying a different rate on the gross slice. Returned as a
        // single bonus value, not as a replacement of the deal's percentage.
        let bonusAmount = 0;
        for (const tier of b.tiers) {
          const top = tier.to ?? gross;
          if (gross <= tier.from) continue;
          const sliceTop = Math.min(gross, top);
          const slice = Math.max(0, sliceTop - tier.from);
          bonusAmount += slice * tier.percentage;
        }
        if (bonusAmount > 0) {
          applied.push({
            label: b.label,
            amount: Math.round(bonusAmount * 100) / 100,
          });
        }
        break;
      }
    }
  }

  const total = applied.reduce((s, b) => s + b.amount, 0);
  return { applied, total };
}

// -------- Main simulation --------

export function simulate(input: SimInput): SimResult {
  const { deal: rawDeal, hypothetical, flagOverride } = input;
  const { gross, expenses = 0, ticketsSold, sellout, capacity } = hypothetical;

  const { deal, appliedReadings } = applyReadings(rawDeal, flagOverride);

  const steps: SimStep[] = [];

  const fees = Math.round(gross * DEFAULT_FEE_RATE * 100) / 100;
  const net = gross - fees;

  steps.push({ label: "Gross box office", value: gross, kind: "input" });
  steps.push({
    label: "Ticketing fees (10%)",
    value: fees,
    kind: "deduction",
  });
  steps.push({ label: "Net box office", value: net, kind: "subtotal" });

  let totalToArtist = 0;
  const guarantee = deal.guaranteeAmount ?? 0;
  const percentage = deal.percentage ?? 0;

  switch (deal.dealType) {
    case "flat": {
      totalToArtist = guarantee;
      steps.push({
        label: "Flat guarantee",
        value: guarantee,
        kind: "total",
      });
      break;
    }

    case "percentage_of_gross": {
      const split = gross * percentage;
      // Percentage-of-gross deals don't typically have expense deductions
      // but we still respect any recoups marked before/after split.
      const deductions = computeDeductions(
        gross,
        0,
        null,
        deal.recoupDeclarations,
      );
      steps.push(...deductions.steps);
      const splitBase = deductions.netForSplit; // gross less any before-split recoups
      const artistShare = splitBase * percentage;
      steps.push({
        label: `${Math.round(percentage * 100)}% of gross`,
        value: artistShare,
        kind: "split",
      });
      const guaranteed = Math.max(guarantee, artistShare);
      if (guarantee > 0 && guarantee > artistShare) {
        steps.push({
          label: "Guarantee floor",
          value: guarantee,
          kind: "input",
          note: "Percentage was lower than the minimum guarantee",
        });
      }
      totalToArtist = guaranteed - deductions.afterSplitDeductions;
      void split;
      break;
    }

    case "percentage_of_net": {
      const deductions = computeDeductions(
        net,
        expenses,
        deal.expenseCap,
        deal.recoupDeclarations,
      );
      steps.push(...deductions.steps);
      steps.push({
        label: "Net for split",
        value: deductions.netForSplit,
        kind: "subtotal",
      });
      const artistShare = deductions.netForSplit * percentage;
      steps.push({
        label: `${Math.round(percentage * 100)}% of net`,
        value: artistShare,
        kind: "split",
      });
      const guaranteed = Math.max(guarantee, artistShare);
      totalToArtist = guaranteed - deductions.afterSplitDeductions;
      break;
    }

    case "vs": {
      const deductions = computeDeductions(
        net,
        expenses,
        deal.expenseCap,
        deal.recoupDeclarations,
      );
      steps.push(...deductions.steps);
      steps.push({
        label: "Net after deductions",
        value: deductions.netForSplit,
        kind: "subtotal",
      });
      const pctPayout = deductions.netForSplit * percentage;
      steps.push({
        label: `${Math.round(percentage * 100)}% of net`,
        value: pctPayout,
        kind: "split",
      });
      const base = Math.max(guarantee, pctPayout);
      if (guarantee > pctPayout) {
        steps.push({
          label: "Guarantee wins",
          value: guarantee,
          kind: "input",
          note: `Percentage payout (${pctPayout.toLocaleString()}) below the $${guarantee.toLocaleString()} guarantee`,
        });
      }
      totalToArtist = base - deductions.afterSplitDeductions;
      break;
    }

    case "door": {
      // "Door deal" — artist takes the door, less venue's pass-through.
      const deductions = computeDeductions(
        gross,
        expenses,
        deal.expenseCap,
        deal.recoupDeclarations,
      );
      steps.push(...deductions.steps);
      steps.push({
        label: "Door after deductions",
        value: deductions.netForSplit,
        kind: "subtotal",
      });
      totalToArtist = deductions.netForSplit - deductions.afterSplitDeductions;
      break;
    }
  }

  // Bonuses are applied last. For `vs` deals only, bonuses are suppressed
  // when the guarantee won out over the percentage — matching the legacy
  // dealMath convention (artists don't earn over-performance bonuses if the
  // show under-performed badly enough to trigger the guarantee floor).
  const { applied } = computeBonuses(
    deal.bonuses,
    gross,
    ticketsSold,
    sellout,
    capacity,
  );

  const suppressBonusesForVs =
    deal.dealType === "vs" && totalToArtist === guarantee;

  if (!suppressBonusesForVs) {
    for (const b of applied) {
      totalToArtist += b.amount;
      steps.push({ label: b.label, value: b.amount, kind: "bonus" });
    }
  }

  totalToArtist = Math.max(0, Math.round(totalToArtist * 100) / 100);

  steps.push({
    label: "Total to artist",
    value: totalToArtist,
    kind: "total",
  });

  return {
    steps,
    totalToArtist,
    appliedReadings,
  };
}

// -------- Dual-reading helper --------

export type DualReadingResult = {
  flagId: string;
  sourceClause: string;
  readingA: { label: string; result: SimResult };
  readingB: { label: string; result: SimResult };
  delta: number;
};

/**
 * Run the simulation twice, once under each reading of the given flag, and
 * return both results plus the dollar delta between them. Powers F4 in the
 * Modeler spec.
 */
export function simulateBothReadings(
  deal: DealRecord,
  flagId: string,
  hypothetical: SimInput["hypothetical"],
): DualReadingResult | null {
  const flag = deal.ambiguityFlags.find((f) => f.id === flagId);
  if (!flag || flag.readings.length < 2) return null;

  const [a, b] = flag.readings;
  const readingA = simulate({
    deal,
    hypothetical,
    flagOverride: { flagId, readingLabel: a.label },
  });
  const readingB = simulate({
    deal,
    hypothetical,
    flagOverride: { flagId, readingLabel: b.label },
  });

  return {
    flagId,
    sourceClause: flag.sourceClause,
    readingA: { label: a.label, result: readingA },
    readingB: { label: b.label, result: readingB },
    delta:
      Math.round(
        Math.abs(readingA.totalToArtist - readingB.totalToArtist) * 100,
      ) / 100,
  };
}
