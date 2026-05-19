import type { Deal, RecoupDeclaration, AmbiguityFlag, Bonus } from "@/db/schema";

function cell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function row(...cols: (string | number | null | undefined)[]): string {
  return cols.map(cell).join(",");
}

function formatBonus(b: Bonus): string {
  switch (b.type) {
    case "gross_threshold":
      return `+$${b.amount.toLocaleString()} if gross exceeds $${b.threshold.toLocaleString()}`;
    case "sellout":
      return `+$${b.amount.toLocaleString()} at sellout`;
    case "attendance_threshold":
      return `+$${b.amount.toLocaleString()} at ${b.threshold.toLocaleString()} tickets`;
    case "walkout_pot":
      return `${b.surplusRate * 100}% of every gross dollar above $${b.threshold.toLocaleString()}`;
    case "tier_ratchet":
      return `Tiered deal (${b.tiers.length} tiers)`;
  }
}

export function generateDealCsv({
  artistName,
  showDate,
  venueName,
  deal,
  recoupDeclarations,
  bonuses,
  ambiguityFlags,
}: {
  artistName: string;
  showDate: string;
  venueName: string;
  deal: Pick<
    Deal,
    | "dealType"
    | "guaranteeAmount"
    | "percentage"
    | "percentageBasis"
    | "expenseCap"
    | "hospitalityCap"
  >;
  recoupDeclarations: RecoupDeclaration[];
  bonuses: Bonus[];
  ambiguityFlags: AmbiguityFlag[];
}): string {
  const lines: string[] = [];

  lines.push(row("Greenroom Deal Export"));
  lines.push(row("Artist", artistName));
  lines.push(row("Show Date", showDate));
  lines.push(row("Venue", venueName));
  lines.push("");

  lines.push(row("DEAL TERMS"));
  lines.push(row("Deal Type", deal.dealType));
  lines.push(row("Guarantee", deal.guaranteeAmount));
  lines.push(
    row(
      "Percentage",
      deal.percentage != null
        ? `${Math.round(deal.percentage * 10000) / 100}%`
        : "",
    ),
  );
  lines.push(row("Percentage Basis", deal.percentageBasis));
  lines.push(row("Expense Cap", deal.expenseCap));
  lines.push(row("Hospitality Cap", deal.hospitalityCap));
  lines.push("");

  if (recoupDeclarations.length > 0) {
    lines.push(row("RECOUP DECLARATIONS"));
    lines.push(
      row("Label", "Category", "Cap Amount", "Basis", "Deduction Order"),
    );
    for (const r of recoupDeclarations) {
      lines.push(
        row(r.label, r.category, r.capAmount, r.deductionBasis, r.deductionOrder),
      );
    }
    lines.push("");
  }

  if (bonuses.length > 0) {
    lines.push(row("BONUSES"));
    lines.push(row("Description"));
    for (const b of bonuses) {
      lines.push(row(formatBonus(b)));
    }
    lines.push("");
  }

  const resolved = ambiguityFlags.filter((f) => f.status === "resolved");
  if (resolved.length > 0) {
    lines.push(row("RESOLVED QUESTIONS"));
    lines.push(
      row("Source Clause", "Chosen Reading", "Resolved By", "Note", "Date"),
    );
    for (const f of resolved) {
      lines.push(
        row(
          f.sourceClause,
          f.resolvedReading,
          f.resolvedBy,
          f.resolutionNote,
          f.resolvedAt
            ? new Date(f.resolvedAt).toLocaleDateString()
            : "",
        ),
      );
    }
    lines.push("");
  }

  const open = ambiguityFlags.filter((f) => f.status === "open");
  if (open.length > 0) {
    lines.push(row("OPEN QUESTIONS (unresolved)"));
    lines.push(row("Source Clause", "Reading A", "Reading B"));
    for (const f of open) {
      lines.push(
        row(f.sourceClause, f.readings[0]?.label, f.readings[1]?.label),
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
