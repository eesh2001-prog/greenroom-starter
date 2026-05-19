"use client";

/**
 * Deal Modeler — Simulator panel.
 *
 * Client component. Re-runs the pure simulation engine on every input
 * change. Renders three regions:
 *
 *   1. Hypothetical inputs (gross, expenses, sellout, tickets).
 *   2. Hero number — total to artist under the deal's current readings,
 *      with a collapsible step-by-step formula breakdown.
 *   3. Dual-reading cards for each ambiguity flag — open flags show A vs B
 *      side-by-side with the dollar delta; resolved flags show which
 *      reading was chosen and what it cost.
 *
 * Embedded in the Modeler tab (Phase 1) and the public shared view
 * (Phase 5). All inputs are controlled local state — no Server Actions
 * fired from this component.
 */

import { useMemo, useState } from "react";
import { ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  simulate,
  simulateBothReadings,
  type DealRecord,
  type SimResult,
  type SimStep,
} from "@/lib/dealSimulation";

export type SimulatorProps = {
  deal: DealRecord;
  // Optional starting values for the hypothetical inputs. Common pattern:
  // pass the actual ticket sales from the show if it's a past show, or
  // default to a sensible "let's see what happens at $X gross".
  defaults?: {
    gross?: number;
    expenses?: number;
    ticketsSold?: number;
    sellout?: boolean;
    capacity?: number;
  };
};

export function Simulator({ deal, defaults }: SimulatorProps) {
  const [gross, setGross] = useState<number>(defaults?.gross ?? 15000);
  const [expenses, setExpenses] = useState<number>(defaults?.expenses ?? 1500);
  const [ticketsSold, setTicketsSold] = useState<number>(
    defaults?.ticketsSold ?? 400,
  );
  const [sellout, setSellout] = useState<boolean>(defaults?.sellout ?? false);
  const [showSteps, setShowSteps] = useState<boolean>(false);

  const hypothetical = useMemo(
    () => ({
      gross,
      expenses,
      ticketsSold,
      sellout,
      capacity: defaults?.capacity,
    }),
    [gross, expenses, ticketsSold, sellout, defaults?.capacity],
  );

  const result = useMemo(
    () => simulate({ deal, hypothetical }),
    [deal, hypothetical],
  );

  const dualReadings = useMemo(() => {
    return deal.ambiguityFlags
      .map((flag) => simulateBothReadings(deal, flag.id, hypothetical))
      .filter((d): d is NonNullable<typeof d> => d != null);
  }, [deal, hypothetical]);

  const openFlagCount = deal.ambiguityFlags.filter(
    (f) => f.status === "open",
  ).length;

  return (
    <Card accent={openFlagCount > 0 ? "amber" : "brand"}>
      <CardHeader>
        <div>
          <CardTitle>Simulator</CardTitle>
          <p className="text-[12px] text-ink-500 mt-0.5">
            What-if calculator. Numbers are hypothetical — not connected to live
            ticket sales.
          </p>
        </div>
        {openFlagCount > 0 && (
          <PlainBadge variant="amber">
            {openFlagCount} open {openFlagCount === 1 ? "question" : "questions"}
          </PlainBadge>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberField
            label="Hypothetical gross"
            value={gross}
            onChange={setGross}
            step={500}
            min={0}
          />
          <NumberField
            label="Other expenses"
            value={expenses}
            onChange={setExpenses}
            step={100}
            min={0}
          />
          <NumberField
            label="Tickets sold"
            value={ticketsSold}
            onChange={setTicketsSold}
            step={25}
            min={0}
          />
        </div>

        <label className="inline-flex items-center gap-2 text-[12px] text-ink-700 cursor-pointer">
          <input
            type="checkbox"
            checked={sellout}
            onChange={(e) => setSellout(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-300 text-brand-700 focus:ring-brand-500"
          />
          Treat as a sellout (triggers sellout bonuses)
        </label>

        {/* Hero result */}
        <div className="border-t border-ink-100 pt-5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1">
            Total to artist
          </div>
          <div className="font-mono tabular text-[40px] text-ink-900 leading-none font-semibold">
            {formatMoney(result.totalToArtist)}
          </div>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 text-[12px] text-ink-600 hover:text-ink-900"
            onClick={() => setShowSteps((v) => !v)}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showSteps && "rotate-180",
              )}
            />
            {showSteps ? "Hide" : "Show"} step-by-step
          </button>
          {showSteps && <StepsList steps={result.steps} />}
        </div>

        {/* Dual-reading cards for every flag */}
        {dualReadings.length > 0 && (
          <div className="border-t border-ink-100 pt-5 space-y-3">
            <div className="eyebrow text-[10px] text-ink-500">
              Reading-dependent clauses ({dualReadings.length})
            </div>
            {dualReadings.map((dual) => {
              const flag = deal.ambiguityFlags.find(
                (f) => f.id === dual.flagId,
              )!;
              return (
                <DualReadingCard
                  key={dual.flagId}
                  status={flag.status}
                  resolvedReading={flag.resolvedReading}
                  sourceClause={dual.sourceClause}
                  readingA={dual.readingA}
                  readingB={dual.readingB}
                  delta={dual.delta}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -------- Sub-components --------

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="eyebrow text-[10px] text-ink-500 block mb-1">
        {label}
      </span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-400 font-mono">
          $
        </span>
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={min}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? 0 : Number(v));
          }}
          className={cn(
            "w-full h-9 pl-7 pr-3 rounded-md border border-ink-200 bg-white",
            "text-[13.5px] font-mono tabular text-ink-900",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500",
          )}
        />
      </div>
    </label>
  );
}

function StepsList({ steps }: { steps: SimStep[] }) {
  return (
    <ol className="mt-3 space-y-1 border-l-2 border-ink-100 pl-4">
      {steps.map((step, i) => (
        <li key={i} className="grid grid-cols-[1fr_auto] gap-4 items-baseline">
          <div>
            <span
              className={cn(
                "text-[12px]",
                step.kind === "total"
                  ? "text-ink-900 font-semibold"
                  : step.kind === "subtotal"
                    ? "text-ink-700 font-medium"
                    : "text-ink-600",
              )}
            >
              {step.label}
            </span>
            {step.note && (
              <div className="text-[11px] text-ink-400 mt-0.5">{step.note}</div>
            )}
          </div>
          <span
            className={cn(
              "font-mono tabular text-[12px]",
              step.kind === "deduction" && "text-rose-700",
              step.kind === "bonus" && "text-brand-700",
              step.kind === "total" && "text-ink-900 font-semibold text-[13px]",
              step.kind === "subtotal" && "text-ink-800 font-medium",
              step.kind === "input" && "text-ink-700",
              step.kind === "split" && "text-ink-700",
            )}
          >
            {step.kind === "deduction" ? "−" : ""}
            {formatMoney(step.value)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DualReadingCard({
  status,
  resolvedReading,
  sourceClause,
  readingA,
  readingB,
  delta,
}: {
  status: "open" | "resolved";
  resolvedReading: string | null;
  sourceClause: string;
  readingA: { label: string; result: SimResult };
  readingB: { label: string; result: SimResult };
  delta: number;
}) {
  // Highlight the delta in rose when the swing is meaningful — matches the
  // plan's >$500 threshold.
  const deltaSignificant = delta > 500;
  const isResolved = status === "resolved";

  return (
    <div
      className={cn(
        "rounded-md border p-4",
        isResolved
          ? "border-ink-200 bg-ink-50/50"
          : "border-amber-300/80 bg-amber-50/40",
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          {isResolved ? (
            <CheckCircle2 className="h-4 w-4 text-brand-700 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
          )}
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-600">
            {isResolved ? "Resolved" : "Open question"}
          </span>
        </div>
        <span
          className={cn(
            "font-mono tabular text-[13px] font-semibold",
            deltaSignificant ? "text-rose-700" : "text-ink-600",
          )}
        >
          ±{formatMoney(delta)} swing
        </span>
      </div>

      <blockquote className="text-[12.5px] text-ink-700 italic border-l-2 border-ink-200 pl-3 py-0.5 mb-3">
        “{sourceClause}”
      </blockquote>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ReadingPanel
          label={readingA.label}
          result={readingA.result}
          chosen={isResolved && resolvedReading === readingA.label}
        />
        <ReadingPanel
          label={readingB.label}
          result={readingB.result}
          chosen={isResolved && resolvedReading === readingB.label}
        />
      </div>
    </div>
  );
}

function ReadingPanel({
  label,
  result,
  chosen,
}: {
  label: string;
  result: SimResult;
  chosen: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded border p-3 bg-white",
        chosen ? "border-brand-400 ring-1 ring-brand-200" : "border-ink-200",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[11.5px] font-medium text-ink-700">{label}</span>
        {chosen && (
          <span className="text-[10px] uppercase tracking-wider text-brand-700 font-medium">
            Chosen
          </span>
        )}
      </div>
      <div className="font-mono tabular text-[20px] font-semibold text-ink-900">
        {formatMoney(result.totalToArtist)}
      </div>
    </div>
  );
}
