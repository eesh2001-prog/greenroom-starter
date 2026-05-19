"use client";

import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateDealField, type DealFieldUpdate } from "@/app/actions/updateDealField";
import type { Deal, ExtractionMeta } from "@/db/schema";

type DealFields = Pick<
  Deal,
  | "dealType"
  | "guaranteeAmount"
  | "percentage"
  | "percentageBasis"
  | "expenseCap"
  | "hospitalityCap"
>;

type Props = {
  showId: string;
  sourceEmailText: string;
  extractionMeta: ExtractionMeta;
  deal: DealFields;
};

// Maps local field names → extractionMeta keys (which use the LLM's path syntax)
const FIELDS: {
  key: keyof DealFields;
  label: string;
  metaKey: string;
  type: "text" | "number" | "percent" | "select-deal-type" | "select-basis";
}[] = [
  { key: "dealType", label: "Deal type", metaKey: "deal.dealType", type: "select-deal-type" },
  { key: "guaranteeAmount", label: "Guarantee", metaKey: "deal.guaranteeAmount", type: "number" },
  { key: "percentage", label: "Percentage", metaKey: "deal.percentage", type: "percent" },
  { key: "percentageBasis", label: "Percentage basis", metaKey: "deal.percentageBasis", type: "select-basis" },
  { key: "expenseCap", label: "Expense cap", metaKey: "deal.expenseCap", type: "number" },
  { key: "hospitalityCap", label: "Hospitality cap", metaKey: "deal.hospitalityCap", type: "number" },
];

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.9
      ? "bg-brand-500"
      : confidence >= 0.6
        ? "bg-amber-400"
        : "bg-rose-500";
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full shrink-0", color)}
      title={`Confidence: ${Math.round(confidence * 100)}%`}
    />
  );
}

function highlightSegments(
  text: string,
  span: string | null,
): { chunk: string; highlighted: boolean }[] {
  if (!span) return [{ chunk: text, highlighted: false }];
  const idx = text.indexOf(span);
  if (idx === -1) return [{ chunk: text, highlighted: false }];
  return [
    { chunk: text.slice(0, idx), highlighted: false },
    { chunk: span, highlighted: true },
    { chunk: text.slice(idx + span.length), highlighted: false },
  ];
}

export function ExtractionReview({
  showId,
  sourceEmailText,
  extractionMeta,
  deal,
}: Props) {
  const [focusedMetaKey, setFocusedMetaKey] = useState<string | null>(null);
  const [localDeal, setLocalDeal] = useState<DealFields>(deal);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeSpan = focusedMetaKey
    ? (extractionMeta[focusedMetaKey]?.sourceSpan ?? null)
    : null;
  const segments = highlightSegments(sourceEmailText, activeSpan);

  function handleChange(key: keyof DealFields, raw: string) {
    let value: unknown = raw;
    if (
      key === "guaranteeAmount" ||
      key === "expenseCap" ||
      key === "hospitalityCap"
    ) {
      value = raw === "" ? null : Number(raw);
    } else if (key === "percentage") {
      // Display as 0–100, store as 0–1
      value = raw === "" ? null : Number(raw) / 100;
    } else if (key === "percentageBasis") {
      value = raw === "" ? null : raw;
    }
    setLocalDeal((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  function handleSave() {
    setSaveError(null);
    startTransition(async () => {
      const updates: DealFieldUpdate[] = [
        { field: "dealType", value: localDeal.dealType },
        { field: "guaranteeAmount", value: localDeal.guaranteeAmount },
        { field: "percentage", value: localDeal.percentage },
        { field: "percentageBasis", value: localDeal.percentageBasis },
        { field: "expenseCap", value: localDeal.expenseCap },
        { field: "hospitalityCap", value: localDeal.hospitalityCap },
      ];
      for (const update of updates) {
        const result = await updateDealField(showId, update);
        if (!result.ok) {
          setSaveError(result.error);
          return;
        }
      }
      setIsDirty(false);
    });
  }

  function displayValue(key: keyof DealFields): string {
    const v = localDeal[key];
    if (v == null) return "";
    if (key === "percentage")
      return String(Math.round((v as number) * 10000) / 100);
    return String(v);
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Extraction review</CardTitle>
          <CardDescription>
            Click a field to highlight its source phrase in the email.
            Confidence: <span className="text-brand-700 font-medium">●</span> ≥ 90%&ensp;
            <span className="text-amber-500 font-medium">●</span> ≥ 60%&ensp;
            <span className="text-rose-600 font-medium">●</span> &lt; 60%
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
            Save changes
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {saveError && (
          <p className="text-[12px] text-rose-700 mb-4">{saveError}</p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: email with active span highlighted */}
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Source email
            </div>
            <div className="rounded-md border border-ink-200 bg-ink-50/40 px-4 py-3 max-h-[420px] overflow-y-auto">
              <pre className="text-[11.5px] text-ink-700 whitespace-pre-wrap font-mono leading-relaxed">
                {segments.map((seg, i) =>
                  seg.highlighted ? (
                    <mark
                      key={i}
                      className="bg-amber-200 text-ink-900 rounded px-0.5 not-italic"
                    >
                      {seg.chunk}
                    </mark>
                  ) : (
                    seg.chunk
                  ),
                )}
              </pre>
            </div>
          </div>

          {/* Right: editable extracted fields */}
          <div className="space-y-2">
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Extracted fields
            </div>
            {FIELDS.map(({ key, label, metaKey, type }) => {
              const meta = extractionMeta[metaKey];
              const confidence = meta?.confidence ?? null;
              const isFocused = focusedMetaKey === metaKey;

              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-md border p-3 cursor-pointer transition-colors",
                    isFocused
                      ? "border-amber-300 bg-amber-50/40"
                      : "border-ink-200 hover:border-ink-300 bg-white",
                  )}
                  onClick={() =>
                    setFocusedMetaKey(isFocused ? null : metaKey)
                  }
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {confidence != null && (
                      <ConfidenceDot confidence={confidence} />
                    )}
                    <span className="eyebrow text-[10px] text-ink-500">
                      {label}
                    </span>
                    {confidence != null && (
                      <span className="text-[10px] text-ink-400 ml-auto">
                        {Math.round(confidence * 100)}%
                      </span>
                    )}
                  </div>

                  {type === "select-deal-type" ? (
                    <select
                      value={localDeal.dealType ?? ""}
                      onChange={(e) => handleChange("dealType", e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full h-8 px-2 rounded border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                    >
                      <option value="flat">Flat</option>
                      <option value="vs">Vs deal</option>
                      <option value="percentage_of_gross">% of gross</option>
                      <option value="percentage_of_net">% of net</option>
                      <option value="door">Door deal</option>
                    </select>
                  ) : type === "select-basis" ? (
                    <select
                      value={localDeal.percentageBasis ?? ""}
                      onChange={(e) =>
                        handleChange("percentageBasis", e.target.value)
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="w-full h-8 px-2 rounded border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                    >
                      <option value="">—</option>
                      <option value="gross">Gross</option>
                      <option value="net">Net</option>
                    </select>
                  ) : (
                    <div className="relative">
                      {type === "number" && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-ink-400 font-mono pointer-events-none">
                          $
                        </span>
                      )}
                      {type === "percent" && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-ink-400 pointer-events-none">
                          %
                        </span>
                      )}
                      <input
                        type="number"
                        value={displayValue(key)}
                        onChange={(e) => handleChange(key, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="—"
                        className={cn(
                          "w-full h-8 rounded border border-ink-200 bg-white font-mono text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40",
                          type === "number" ? "pl-6 pr-2" : "pl-2 pr-6",
                        )}
                      />
                    </div>
                  )}

                  {isFocused && meta?.sourceSpan && (
                    <p className="text-[10.5px] text-amber-800 mt-1.5 italic">
                      &ldquo;{meta.sourceSpan}&rdquo;
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
