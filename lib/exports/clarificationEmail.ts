import { simulateBothReadings, type DealRecord } from "@/lib/dealSimulation";
import { formatMoney } from "@/lib/format";
import type { AmbiguityFlag } from "@/db/schema";

export function generateClarificationEmail({
  artistName,
  showDate,
  deal,
  flags,
  defaultGross = 15000,
}: {
  artistName: string;
  showDate: string;
  deal: DealRecord;
  flags: AmbiguityFlag[];
  defaultGross?: number;
}): string {
  const open = flags.filter((f) => f.status === "open");
  if (open.length === 0) return "";

  const clauses = open.map((flag, i) => {
    const [a, b] = flag.readings;
    const dual = simulateBothReadings(deal, flag.id, {
      gross: defaultGross,
      expenses: 1500,
    });
    const deltaNote = dual
      ? ` At a hypothetical ${formatMoney(defaultGross)} gross, the difference between these readings is ${formatMoney(dual.delta)}.`
      : "";
    return `${i + 1}. The email says: "${flag.sourceClause}"\n   Reading A: ${a.label}\n   Reading B: ${b.label}${deltaNote}\n   → Which applies?`;
  });

  return [
    "Hi,",
    "",
    `We're finalising the deal model for ${artistName} (${showDate}) and have ${open.length === 1 ? "one clause" : `${open.length} clauses`} that need a quick confirmation:`,
    "",
    ...clauses,
    "",
    "Please reply confirming the correct reading for each point so we can lock the deal model before show week.",
    "",
    "Thanks,",
    "The Crescent",
  ].join("\n");
}
