/**
 * Known ambiguity patterns in music venue deal emails.
 *
 * These patterns prime the Claude extractor and serve as the typed source of
 * truth for what the UI labels mean. The actual detection runs inside the LLM
 * extraction pass (lib/dealExtraction.ts) — this catalog documents what
 * patterns the extractor is primed on and how they map to configDelta paths.
 */

export type AmbiguityPattern = {
  id: string;
  summary: string;
  matchHints: string[]; // keyword/phrase triggers in the email text
  affectedFields: string[]; // dotted/bracketed configDelta path prefixes
  readings: readonly [string, string]; // [reading A label, reading B label]
};

export const AMBIGUITY_PATTERNS: readonly AmbiguityPattern[] = [
  {
    id: "marketing_recoup_vs_cap",
    summary: "Marketing recoup: inside or outside the expense cap?",
    matchHints: ["recoupable against", "marketing recoup", "recoup of"],
    affectedFields: ["recoupDeclarations[*].deductionOrder"],
    readings: ["Inside the expense cap", "Outside the expense cap"],
  },
  {
    id: "after_expenses_cap_behavior",
    summary: '"After expenses" — is the cap a ceiling or a flat venue buyout?',
    matchHints: ["after expenses", "net after expenses"],
    affectedFields: ["expenseCap"],
    readings: [
      "Cap is a ceiling on total deductions (artist-favorable)",
      "Cap is a flat venue buyout — recoup stacks on top (venue-favorable)",
    ],
  },
  {
    id: "sellout_bonus_comps",
    summary: "Sellout bonus — does \"tickets sold\" count comps?",
    matchHints: ["tickets sold", "sellout bonus", "paid attendance"],
    affectedFields: ["bonuses[*].compsCountTowardSellout"],
    readings: ["Paid tickets only", "Includes comps"],
  },
  {
    id: "gross_face_vs_net_fees",
    summary: '"% of gross" — face value or net of ticketing fees?',
    matchHints: ["% of gross", "percent of gross"],
    affectedFields: ["percentageBasis"],
    readings: [
      "Gross of face value (pre-fees)",
      "Net of ticketing fees",
    ],
  },
] as const;
