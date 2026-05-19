"use client";

import { useState, useTransition } from "react";
import { Info, Loader2, Save } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateDealField } from "@/app/actions/updateDealField";
import type { RecoupDeclaration } from "@/db/schema";

const DEDUCTION_ORDER_OPTIONS: {
  value: RecoupDeclaration["deductionOrder"];
  label: string;
  description: string;
}[] = [
  {
    value: "inside_expense_cap",
    label: "Inside cap",
    description:
      "Counts toward the expense cap ceiling. Cap absorbs the recoup — artist-favorable.",
  },
  {
    value: "outside_expense_cap",
    label: "Outside cap",
    description:
      "Stacked on top of the expense cap buyout. Venue deducts both — venue-favorable.",
  },
  {
    value: "before_split",
    label: "Before split",
    description:
      "Deducted from gross/net before the percentage split is applied.",
  },
  {
    value: "after_split",
    label: "After split",
    description: "Deducted from the artist's share after the split.",
  },
];

const CATEGORY_LABELS: Record<RecoupDeclaration["category"], string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

const TOOLTIP = DEDUCTION_ORDER_OPTIONS.map(
  (o) => `${o.label}: ${o.description}`,
).join("\n");

type Props = {
  showId: string;
  recoupDeclarations: RecoupDeclaration[];
};

export function RecoupEditor({ showId, recoupDeclarations }: Props) {
  const [localRecoups, setLocalRecoups] = useState(recoupDeclarations);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateRecoup<K extends keyof RecoupDeclaration>(
    id: string,
    field: K,
    value: RecoupDeclaration[K],
  ) {
    setLocalRecoups((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
    setIsDirty(true);
  }

  function handleSave() {
    setSaveError(null);
    startTransition(async () => {
      const result = await updateDealField(showId, {
        field: "recoupDeclarations",
        value: localRecoups,
      });
      if (!result.ok) {
        setSaveError(result.error);
      } else {
        setIsDirty(false);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recoup declarations</CardTitle>
          <CardDescription>
            Venue costs declared at deal time. <strong>Deduction order</strong>{" "}
            determines where each recoup sits in the math — the
            dispute-defining field.
          </CardDescription>
        </div>
        {isDirty && (
          <Button
            variant="brand"
            size="sm"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {saveError && (
          <p className="text-[12px] text-rose-700 mb-3">{saveError}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-ink-100">
                {["Label", "Category", "Cap amount", "Basis"].map((h) => (
                  <th
                    key={h}
                    className="text-left text-[10px] uppercase tracking-wider text-ink-400 font-medium pb-2 pr-4"
                  >
                    {h}
                  </th>
                ))}
                <th className="text-left pb-2 pr-4">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-400 font-medium">
                    Deduction order
                    <span title={TOOLTIP} className="cursor-help">
                      <Info className="h-3 w-3 text-ink-300" />
                    </span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {localRecoups.map((recoup) => (
                <tr
                  key={recoup.id}
                  className="hover:bg-ink-50/50 transition-colors"
                >
                  <td className="py-2.5 pr-4">
                    <input
                      type="text"
                      value={recoup.label}
                      onChange={(e) =>
                        updateRecoup(recoup.id, "label", e.target.value)
                      }
                      className="w-full h-7 px-2 rounded border border-transparent hover:border-ink-200 focus:border-ink-300 bg-transparent focus:bg-white text-ink-800 focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-colors"
                    />
                  </td>
                  <td className="py-2.5 pr-4 text-ink-500">
                    {CATEGORY_LABELS[recoup.category]}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 text-[12px] font-mono pointer-events-none">
                        $
                      </span>
                      <input
                        type="number"
                        value={recoup.capAmount}
                        onChange={(e) =>
                          updateRecoup(
                            recoup.id,
                            "capAmount",
                            Number(e.target.value),
                          )
                        }
                        className="w-24 h-7 pl-5 pr-2 rounded border border-transparent hover:border-ink-200 focus:border-ink-300 bg-transparent focus:bg-white font-mono text-ink-800 focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-colors"
                      />
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <select
                      value={recoup.deductionBasis}
                      onChange={(e) =>
                        updateRecoup(
                          recoup.id,
                          "deductionBasis",
                          e.target.value as "gross" | "net",
                        )
                      }
                      className="h-7 px-2 rounded border border-transparent hover:border-ink-200 focus:border-ink-300 bg-transparent focus:bg-white text-ink-600 focus:outline-none transition-colors capitalize"
                    >
                      <option value="gross">Gross</option>
                      <option value="net">Net</option>
                    </select>
                  </td>
                  <td className="py-2.5 pr-4">
                    <select
                      value={recoup.deductionOrder}
                      onChange={(e) =>
                        updateRecoup(
                          recoup.id,
                          "deductionOrder",
                          e.target.value as RecoupDeclaration["deductionOrder"],
                        )
                      }
                      title={
                        DEDUCTION_ORDER_OPTIONS.find(
                          (o) => o.value === recoup.deductionOrder,
                        )?.description
                      }
                      className={cn(
                        "h-7 px-2 rounded border focus:outline-none focus:ring-1 focus:ring-brand-500/40 transition-colors text-[11.5px] font-medium",
                        recoup.deductionOrder === "inside_expense_cap"
                          ? "border-brand-200 bg-brand-50/60 text-brand-800 hover:border-brand-300"
                          : recoup.deductionOrder === "outside_expense_cap"
                            ? "border-rose-200 bg-rose-50/60 text-rose-800 hover:border-rose-300"
                            : "border-ink-200 bg-ink-50/50 text-ink-700 hover:border-ink-300",
                      )}
                    >
                      {DEDUCTION_ORDER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
