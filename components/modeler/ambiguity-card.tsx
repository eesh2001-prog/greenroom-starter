"use client";

import { useState, useMemo, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlainBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  simulateBothReadings,
  type DealRecord,
} from "@/lib/dealSimulation";
import { resolveAmbiguity } from "@/app/actions/resolveAmbiguity";
import type { AmbiguityFlag } from "@/db/schema";

type Props = {
  showId: string;
  flag: AmbiguityFlag;
  deal: DealRecord;
  defaultGross: number;
};

export function AmbiguityCard({ showId, flag, deal, defaultGross }: Props) {
  const isResolved = flag.status === "resolved";

  const dual = useMemo(
    () =>
      simulateBothReadings(deal, flag.id, {
        gross: defaultGross,
        expenses: 1500,
      }),
    [deal, flag.id, defaultGross],
  );

  const [choosing, setChoosing] = useState<string | null>(null);
  const [resolvedBy, setResolvedBy] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChoose(readingLabel: string) {
    setChoosing(readingLabel);
    setError(null);
  }

  function handleConfirm() {
    if (!choosing) return;
    startTransition(async () => {
      const result = await resolveAmbiguity(
        showId,
        flag.id,
        choosing,
        resolvedBy,
        resolutionNote,
      );
      if (!result.ok) setError(result.error);
    });
  }

  const deltaSignificant = dual && dual.delta > 500;

  return (
    <Card accent={isResolved ? undefined : "amber"}>
      <CardHeader>
        <div className="flex items-center gap-2">
          {isResolved ? (
            <CheckCircle2 className="h-4 w-4 text-brand-700 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
          )}
          <CardTitle>{isResolved ? "Resolved" : "Open question"}</CardTitle>
          {!isResolved && dual && (
            <PlainBadge variant={deltaSignificant ? "rose" : "amber"}>
              ±{formatMoney(dual.delta)} swing
            </PlainBadge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <blockquote className="text-[12.5px] text-ink-700 italic border-l-2 border-amber-300 pl-3 py-0.5">
          &ldquo;{flag.sourceClause}&rdquo;
        </blockquote>

        {dual && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[dual.readingA, dual.readingB].map((reading) => {
              const isChosen =
                isResolved && flag.resolvedReading === reading.label;
              const isBeingChosen = choosing === reading.label;
              const flagReading = flag.readings.find(
                (r) => r.label === reading.label,
              );

              return (
                <div
                  key={reading.label}
                  className={cn(
                    "rounded-lg border p-4",
                    isChosen
                      ? "border-brand-400 bg-brand-50/60"
                      : isBeingChosen
                        ? "border-amber-400 bg-amber-50/60"
                        : "border-ink-200 bg-white",
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[12px] font-semibold text-ink-800">
                      {reading.label}
                    </span>
                    {isChosen && (
                      <span className="text-[10px] uppercase tracking-wider text-brand-700 font-medium">
                        Chosen
                      </span>
                    )}
                  </div>
                  <div className="font-mono tabular text-[22px] font-semibold text-ink-900 mb-2">
                    {formatMoney(reading.result.totalToArtist)}
                  </div>
                  {flagReading?.description && (
                    <p className="text-[11.5px] text-ink-500 leading-relaxed mb-3">
                      {flagReading.description}
                    </p>
                  )}
                  {!isResolved && !choosing && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleChoose(reading.label)}
                    >
                      Choose this reading
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isResolved && choosing && (
          <div className="border border-amber-200 rounded-lg p-4 bg-amber-50/30 space-y-3">
            <p className="text-[12.5px] text-ink-700 font-medium">
              Confirm:{" "}
              <span className="text-amber-800">&ldquo;{choosing}&rdquo;</span>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="eyebrow text-[10px] text-ink-500 block mb-1">
                  Your name (optional)
                </span>
                <input
                  type="text"
                  value={resolvedBy}
                  onChange={(e) => setResolvedBy(e.target.value)}
                  placeholder="Mariana Reyes"
                  className="w-full h-8 px-3 rounded-md border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                />
              </label>
              <label className="block">
                <span className="eyebrow text-[10px] text-ink-500 block mb-1">
                  Note (optional)
                </span>
                <input
                  type="text"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Confirmed with agent via email"
                  className="w-full h-8 px-3 rounded-md border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                />
              </label>
            </div>
            {error && (
              <p className="text-[12px] text-rose-700">{error}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="brand"
                size="sm"
                onClick={handleConfirm}
                disabled={isPending}
              >
                {isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Confirm resolution
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setChoosing(null);
                  setError(null);
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isResolved && (
          <div className="text-[12px] text-ink-500 space-y-0.5 border-t border-ink-100 pt-3">
            {flag.resolvedBy && (
              <p>
                Resolved by{" "}
                <span className="font-medium text-ink-700">
                  {flag.resolvedBy}
                </span>
              </p>
            )}
            {flag.resolutionNote && (
              <p className="italic">&ldquo;{flag.resolutionNote}&rdquo;</p>
            )}
            {flag.resolvedAt && (
              <p className="text-[11px] text-ink-400">
                {new Date(flag.resolvedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
