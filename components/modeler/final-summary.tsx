"use client";

import { CheckCircle2, Clock, Download, Mail } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { formatMoney, formatShowDateFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { generateDealCsv } from "@/lib/exports/dealSpreadsheet";
import type { Deal, RecoupDeclaration, AmbiguityFlag, Bonus, Signoff } from "@/db/schema";

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
  artistName: string;
  showDate: string;
  venueName: string;
  deal: DealFields;
  recoupDeclarations: RecoupDeclaration[];
  bonuses: Bonus[];
  ambiguityFlags: AmbiguityFlag[];
  signoffs: Signoff[];
};

// ---- Formatting helpers ----

function dealSummaryLine(deal: DealFields): string {
  const pct = deal.percentage != null
    ? `${Math.round(deal.percentage * 10000) / 100}%`
    : null;
  const basis = deal.percentageBasis ?? "net";

  switch (deal.dealType) {
    case "flat":
      return `Flat guarantee: ${formatMoney(deal.guaranteeAmount)}`;
    case "percentage_of_gross":
      return `${pct} of gross box office`;
    case "percentage_of_net":
      return `${pct} of net (after expenses)`;
    case "vs":
      return `${formatMoney(deal.guaranteeAmount)} vs ${pct} of ${basis} after expenses, whichever is greater`;
    case "door":
      return `Door deal — artist takes the door after expenses`;
    default:
      return deal.dealType;
  }
}

function bonusLine(b: Bonus): string {
  switch (b.type) {
    case "gross_threshold":
      return `+${formatMoney(b.amount)} if gross exceeds ${formatMoney(b.threshold)}`;
    case "sellout":
      return `+${formatMoney(b.amount)} at sellout`;
    case "attendance_threshold":
      return `+${formatMoney(b.amount)} at ${b.threshold.toLocaleString()} tickets`;
    case "walkout_pot":
      return `${b.surplusRate * 100}% of every gross dollar above ${formatMoney(b.threshold)}`;
    case "tier_ratchet":
      return `Tiered deal (${b.tiers.length} tiers)`;
  }
}

const DEDUCTION_ORDER_LABELS: Record<RecoupDeclaration["deductionOrder"], string> = {
  inside_expense_cap: "Inside expense cap",
  outside_expense_cap: "Outside expense cap",
  before_split: "Before split",
  after_split: "After split",
};

// ---- Sign-off roster (fixed order) ----

const SIGNOFF_ROSTER: { role: Signoff["role"]; label: string; mandatory: boolean }[] = [
  { role: "booker", label: "Mariana (Booker / Venue)", mandatory: true },
  { role: "agent", label: "Agent", mandatory: true },
  { role: "tour_manager", label: "Tour Manager", mandatory: false },
  { role: "gm", label: "Marcus (GM)", mandatory: false },
];

// ---- Component ----

export function FinalSummary({
  artistName,
  showDate,
  venueName,
  deal,
  recoupDeclarations,
  bonuses,
  ambiguityFlags,
  signoffs,
}: Props) {
  const signedRoles = new Set(signoffs.map((s) => s.role));
  const allMandatorySigned = SIGNOFF_ROSTER.filter((r) => r.mandatory).every(
    (r) => signedRoles.has(r.role),
  );
  const resolvedFlags = ambiguityFlags.filter((f) => f.status === "resolved");

  function downloadCsv() {
    const csv = generateDealCsv({
      artistName,
      showDate,
      venueName,
      deal,
      recoupDeclarations,
      bonuses,
      ambiguityFlags,
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deal-${artistName.toLowerCase().replace(/\s+/g, "-")}-${showDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card accent={allMandatorySigned ? "brand" : "sky"}>
      <CardHeader>
        <div>
          <CardTitle>Final deal summary</CardTitle>
          <p className="text-[12px] text-ink-500 mt-0.5">
            {artistName} · {formatShowDateFull(showDate)} · {venueName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {allMandatorySigned ? (
            <PlainBadge variant="brand">Confirmed</PlainBadge>
          ) : (
            <PlainBadge variant="sky">Awaiting sign-off</PlainBadge>
          )}
          <button
            onClick={downloadCsv}
            className="inline-flex items-center gap-1 text-[11.5px] text-ink-500 hover:text-ink-900 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download CSV
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Deal terms */}
        <Section title="Deal terms">
          <p className="text-[13.5px] text-ink-900 font-medium">
            {dealSummaryLine(deal)}
          </p>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-3">
            {deal.expenseCap != null && (
              <Field label="Expense cap" value={formatMoney(deal.expenseCap)} />
            )}
            {deal.hospitalityCap != null && (
              <Field label="Hospitality cap" value={formatMoney(deal.hospitalityCap)} />
            )}
          </div>
        </Section>

        {/* Recoups */}
        {recoupDeclarations.length > 0 && (
          <Section title="Recoup declarations">
            <div className="space-y-1.5">
              {recoupDeclarations.map((r) => (
                <div
                  key={r.id}
                  className="flex items-baseline justify-between gap-4 text-[12.5px]"
                >
                  <span className="text-ink-700">{r.label}</span>
                  <span className="flex items-center gap-2 text-ink-500 shrink-0">
                    <span className="font-mono tabular">{formatMoney(r.capAmount)}</span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium px-1.5 py-0.5 rounded",
                        r.deductionOrder === "inside_expense_cap"
                          ? "bg-brand-50 text-brand-700"
                          : r.deductionOrder === "outside_expense_cap"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-ink-100 text-ink-600",
                      )}
                    >
                      {DEDUCTION_ORDER_LABELS[r.deductionOrder]}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Bonuses */}
        {bonuses.length > 0 && (
          <Section title="Bonuses">
            <ul className="space-y-1">
              {bonuses.map((b, i) => (
                <li key={i} className="text-[12.5px] text-ink-700">
                  {bonusLine(b)}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Resolved decisions */}
        {resolvedFlags.length > 0 && (
          <Section title="Resolved questions">
            <div className="space-y-3">
              {resolvedFlags.map((f) => (
                <div key={f.id} className="border-l-2 border-brand-200 pl-3">
                  <p className="text-[11.5px] text-ink-500 italic mb-0.5">
                    &ldquo;{f.sourceClause}&rdquo;
                  </p>
                  <p className="text-[12.5px] text-ink-800 font-medium">
                    → {f.resolvedReading}
                  </p>
                  {f.resolvedBy && (
                    <p className="text-[11px] text-ink-400 mt-0.5">
                      Confirmed by {f.resolvedBy}
                      {f.resolutionNote ? ` — "${f.resolutionNote}"` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Sign-off status */}
        <Section title="Sign-off status">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SIGNOFF_ROSTER.map(({ role, label, mandatory }) => {
              const s = signoffs.find((x) => x.role === role);
              return (
                <div
                  key={role}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3",
                    s ? "border-brand-200 bg-brand-50/50" : "border-ink-200 bg-white",
                  )}
                >
                  {s ? (
                    <CheckCircle2 className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
                  ) : (
                    <Clock className="h-4 w-4 text-ink-300 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-ink-800">
                        {s ? s.name : label}
                      </span>
                      {mandatory ? (
                        <PlainBadge variant="rose" className="text-[9px]">
                          required
                        </PlainBadge>
                      ) : (
                        <PlainBadge variant="default" className="text-[9px]">
                          optional
                        </PlainBadge>
                      )}
                    </div>
                    {s ? (
                      <p className="text-[11px] text-ink-500 mt-0.5">
                        Signed · {new Date(s.signedAt).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="text-[11px] text-ink-400 mt-0.5">
                        Not yet signed
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </CardContent>
    </Card>
  );
}

// ---- Small helpers ----

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="eyebrow text-[10px] text-ink-400 uppercase tracking-wider font-medium mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow text-[10px] text-ink-400 mb-0.5">{label}</div>
      <div className="text-[13px] text-ink-800 font-mono tabular">{value}</div>
    </div>
  );
}

// Silence unused import warning — Mail icon is used in share-panel
void Mail;
