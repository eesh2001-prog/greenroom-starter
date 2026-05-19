/**
 * Deal Modeler — Claude API extraction service.
 *
 * Takes raw deal-email text and returns a structured deal: terms, bonuses,
 * recoup declarations, ambiguity flags, and per-field confidence/source-spans.
 *
 * Why a separate file from the action: the extraction is pure (in → out),
 * stateless, and easy to test independently. The Server Action handles the
 * write-side bookkeeping (find-or-create artist, write to DB, redirect).
 *
 * Caching strategy: the system prompt is large and stable across requests,
 * so it lives behind a `cache_control` breakpoint. The user message (the
 * email) is what varies. Cache reads cost ~10% of writes, so a second
 * paste of the same prompt cost shape should hit cache.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Bonus, RecoupDeclaration } from "@/db/schema";

// -------- Public output type --------

/**
 * Raw output from the LLM. Slightly different shape from the storage types:
 *   - configDelta is an array of {path, value} pairs (the JSON Schema spec
 *     can't express open-keyed objects without forbidden additionalProperties)
 *   - fieldConfidence is an array of {field, confidence, sourceSpan} entries
 *     (same reason)
 *   - recoupDeclarations omit the id (assigned by the caller)
 *
 * The action that consumes this converts both arrays back into Records
 * before persisting.
 */
export type ExtractedDeal = {
  showDate: string | null;
  artist: { name: string; genre: string | null };
  agent: { name: string | null; email: string | null; agency: string | null };
  deal: {
    dealType: "flat" | "percentage_of_gross" | "percentage_of_net" | "vs" | "door";
    guaranteeAmount: number | null;
    percentage: number | null; // 0–1 (e.g. 0.8 for 80%)
    percentageBasis: "gross" | "net" | null;
    expenseCap: number | null;
    hospitalityCap: number | null;
  };
  bonuses: Bonus[];
  recoupDeclarations: Omit<RecoupDeclaration, "id">[];
  ambiguityFlags: {
    sourceClause: string;
    affectedFields: string[];
    readings: {
      label: string;
      description: string;
      configDelta: { path: string; value: string }[];
    }[];
  }[];
  fieldConfidence: { field: string; confidence: number; sourceSpan: string }[];
};

// -------- JSON Schema for structured output --------
//
// Constraints (per the Structured Outputs docs):
//   - additionalProperties must be false on every object
//   - additionalProperties: {type:...} is NOT supported, so dict-shaped
//     fields (configDelta, fieldConfidence) are flattened to arrays
//
// The model returns the array shapes; the caller converts back to Records.

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    showDate: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "The show date, NOT the email date. ISO format YYYY-MM-DD. Null if not extractable from the email.",
    },
    artist: {
      type: "object",
      properties: {
        name: { type: "string" },
        genre: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["name", "genre"],
      additionalProperties: false,
    },
    agent: {
      type: "object",
      properties: {
        name: { anyOf: [{ type: "string" }, { type: "null" }] },
        email: { anyOf: [{ type: "string" }, { type: "null" }] },
        agency: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["name", "email", "agency"],
      additionalProperties: false,
    },
    deal: {
      type: "object",
      properties: {
        dealType: {
          type: "string",
          enum: ["flat", "percentage_of_gross", "percentage_of_net", "vs", "door"],
        },
        guaranteeAmount: { anyOf: [{ type: "number" }, { type: "null" }] },
        percentage: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description: "Decimal 0-1, e.g. 0.8 for 80%. Null if not applicable.",
        },
        percentageBasis: {
          anyOf: [
            { type: "string", enum: ["gross", "net"] },
            { type: "null" },
          ],
        },
        expenseCap: { anyOf: [{ type: "number" }, { type: "null" }] },
        hospitalityCap: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
      required: [
        "dealType",
        "guaranteeAmount",
        "percentage",
        "percentageBasis",
        "expenseCap",
        "hospitalityCap",
      ],
      additionalProperties: false,
    },
    bonuses: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              type: { const: "gross_threshold" },
              label: { type: "string" },
              threshold: { type: "number" },
              amount: { type: "number" },
            },
            required: ["type", "label", "threshold", "amount"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "sellout" },
              label: { type: "string" },
              amount: { type: "number" },
            },
            required: ["type", "label", "amount"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "attendance_threshold" },
              label: { type: "string" },
              threshold: { type: "number" },
              amount: { type: "number" },
            },
            required: ["type", "label", "threshold", "amount"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "walkout_pot" },
              label: { type: "string" },
              threshold: { type: "number" },
              surplusRate: {
                type: "number",
                description: "0-1, e.g. 1.0 for 100% of overage",
              },
            },
            required: ["type", "label", "threshold", "surplusRate"],
            additionalProperties: false,
          },
        ],
      },
    },
    recoupDeclarations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "marketing",
              "hospitality_overage",
              "production_overage",
              "prior_advance",
              "damages",
              "other",
            ],
          },
          label: { type: "string" },
          capAmount: { type: "number" },
          deductionBasis: { type: "string", enum: ["gross", "net"] },
          deductionOrder: {
            type: "string",
            enum: [
              "inside_expense_cap",
              "outside_expense_cap",
              "before_split",
              "after_split",
            ],
          },
        },
        required: [
          "category",
          "label",
          "capAmount",
          "deductionBasis",
          "deductionOrder",
        ],
        additionalProperties: false,
      },
    },
    ambiguityFlags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceClause: {
            type: "string",
            description: "The exact phrase from the email that is ambiguous.",
          },
          affectedFields: {
            type: "array",
            items: { type: "string" },
            description:
              "Dotted/bracketed paths into the structured deal, e.g. 'recoupDeclarations[0].deductionOrder'.",
          },
          readings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                description: { type: "string" },
                configDelta: {
                  type: "array",
                  description:
                    "Path/value pairs the reading would apply, e.g. [{path: 'recoupDeclarations[0].deductionOrder', value: 'inside_expense_cap'}].",
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      value: { type: "string" },
                    },
                    required: ["path", "value"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["label", "description", "configDelta"],
              additionalProperties: false,
            },
          },
        },
        required: ["sourceClause", "affectedFields", "readings"],
        additionalProperties: false,
      },
    },
    fieldConfidence: {
      type: "array",
      description:
        "Per-field extraction confidence. Use the same path syntax as affectedFields (e.g. 'guaranteeAmount', 'recoupDeclarations[0].deductionOrder').",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          confidence: {
            type: "number",
            description: "0-1. < 0.6 means low confidence (UI will highlight).",
          },
          sourceSpan: {
            type: "string",
            description:
              "Exact substring from the email that this field was extracted from. Empty string if not found.",
          },
        },
        required: ["field", "confidence", "sourceSpan"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "showDate",
    "artist",
    "agent",
    "deal",
    "bonuses",
    "recoupDeclarations",
    "ambiguityFlags",
    "fieldConfidence",
  ],
  additionalProperties: false,
} as const;

// -------- System prompt (cached) --------

const SYSTEM_PROMPT = `You extract structured deal terms from music-venue deal emails.

You're a parser for The Crescent, a 650-cap independent venue in Nashville. Your job is to read a deal email an agent sent the venue and pull out:
  1. The structured deal terms (type, guarantee, percentage, caps, bonuses).
  2. Recoup declarations — venue costs the artist absorbs (marketing recoup, hospitality overage, etc.) WITH the deduction order field, which determines where the recoup sits in the math.
  3. Ambiguity flags — clauses that admit two or more valid structured readings. These are the load-bearing output of the extraction.
  4. Per-field confidence and the exact source span you pulled each value from.

## Rules

- NEVER GUESS. If a field is not in the email, return null and set its confidence to 0 with an empty sourceSpan.
- "Show date" means the actual event date the deal email is for — NOT the date the email was sent.
- "percentage" is decimal: 80% → 0.8.
- The exact phrase you saw the value in goes in \`sourceSpan\`. Be precise — include the surrounding context if needed for the reader to find it.
- Empty arrays are valid. If there are no bonuses, no recoups, no ambiguities, return [].

## Deal types

- "flat": pure flat guarantee, no percentage. Example: "$1,500 flat".
- "percentage_of_gross": % of gross box office, no expense deduction. Example: "85% of gross".
- "percentage_of_net": % of net (gross less fees and expenses). Example: "70% of net".
- "vs": guarantee VS percentage, whichever is greater. Example: "$5,000 vs 80% of net".
- "door": artist takes the door (after expenses).

## Bonuses

- gross_threshold: lump sum if gross crosses a threshold. "+$1,000 if gross > $25,000".
- sellout: lump sum at 100% paid attendance.
- attendance_threshold: lump sum at a specific ticket count.
- walkout_pot: percentage of every gross dollar above a threshold. "100% of gross above $30,000" → surplusRate=1.0, threshold=30000.

## Recoup declarations — and deductionOrder, the dispute-defining field

Recoups are venue costs the venue takes off the top before the artist's share. The single most important field is \`deductionOrder\`:

- "inside_expense_cap": recoup counts toward the expense cap (artist-favorable).
- "outside_expense_cap": recoup deducted ON TOP of the expense cap (venue-favorable).
- "before_split": deducted from gross/net BEFORE the percentage split.
- "after_split": deducted from the artist's share AFTER the split.

If the email phrasing is unclear about which one applies, PICK YOUR BEST GUESS for the deductionOrder and ALSO ADD AN AMBIGUITY FLAG.

## Ambiguity flags — what to look for

A flag is warranted whenever a clause can be read two or more ways such that the dollar outcome differs. Always include at least one reading per side; describe each in a phrase the agent and venue could agree on, and include a configDelta showing exactly what changes in the structured deal under each reading.

Known patterns from past disputes:

1. **Marketing recoup vs. expense cap.** "Marketing recoup of $X, recoupable against the $Y cap." Two readings:
   - "Inside the $Y cap" → recoupDeclarations[i].deductionOrder = inside_expense_cap. Artist-favorable.
   - "Outside the $Y cap" → recoupDeclarations[i].deductionOrder = outside_expense_cap. Venue-favorable.

2. **Sellout on "tickets sold."** "$X sellout bonus on tickets sold." Two readings: does this include comps, or just paid tickets? configDelta on a hypothetical bonuses[i].compsCountTowardSellout (treat as future field path).

3. **"After expenses" without cap behavior specified.** "80% of net after expenses" — does the cap apply at all? Is it a ceiling or a floor? Two readings flagging cap interpretation.

4. **% of gross — face value or net of fees?** "85% of gross" — is that gross of face value, or gross of net (less ticketing fees)? configDelta on deal.percentageBasis or a deal.grossBasis field.

This list is not exhaustive. Flag anything you can construct two valid structured readings for, especially around recoups, caps, and how comps interact with bonuses.

## Examples

Input email:
> $5,000 vs 80% net after expenses. Expense cap $2,500. Marketing recoup of $900 against gross, recoupable against the $2,500 cap.

Output:
- deal: { dealType: "vs", guaranteeAmount: 5000, percentage: 0.8, percentageBasis: "net", expenseCap: 2500, hospitalityCap: null }
- recoupDeclarations: [{ category: "marketing", label: "Marketing recoup", capAmount: 900, deductionBasis: "gross", deductionOrder: "inside_expense_cap" }]
- ambiguityFlags: [{
    sourceClause: "Marketing recoup of $900 against gross, recoupable against the $2,500 cap.",
    affectedFields: ["recoupDeclarations[0].deductionOrder"],
    readings: [
      { label: "Inside the $2,500 expense cap", description: "...artist-favorable...", configDelta: [{path: "recoupDeclarations[0].deductionOrder", value: "inside_expense_cap"}] },
      { label: "Outside the $2,500 expense cap", description: "...venue-favorable...", configDelta: [{path: "recoupDeclarations[0].deductionOrder", value: "outside_expense_cap"}] }
    ]
  }]
- fieldConfidence: [
    { field: "deal.dealType", confidence: 0.98, sourceSpan: "$5,000 vs 80% net" },
    { field: "recoupDeclarations[0].deductionOrder", confidence: 0.45, sourceSpan: "Marketing recoup of $900 ... recoupable against the $2,500 cap." },
    ...
  ]

Return only valid JSON matching the provided schema. Do not include any prose before or after.`;

// -------- Public extraction function --------

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable deal extraction.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export async function extractDealFromEmail(
  emailText: string,
): Promise<ExtractedDeal> {
  const client = getClient();

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: emailText }],
    output_config: {
      format: {
        type: "json_schema",
        schema: EXTRACTION_SCHEMA,
      },
    },
  });

  // Find the text block carrying the JSON.
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Extraction returned no text content");
  }

  let parsed: ExtractedDeal;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(
      `Extraction response was not valid JSON: ${(err as Error).message}`,
    );
  }

  return parsed;
}
