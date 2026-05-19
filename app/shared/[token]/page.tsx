import { notFound } from "next/navigation";
import { CheckCircle2, Sparkles } from "lucide-react";
import { getDealByShareToken } from "@/lib/queries";
import { FinalSummary } from "@/components/modeler/final-summary";
import { Simulator } from "@/components/modeler/simulator";
import { SignOffSection } from "./sign-off-section";
import { decodeDeal } from "@/lib/dealSimulation";
import { formatShowDateFull } from "@/lib/format";

export default async function SharedDealPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getDealByShareToken(token);
  if (!data) notFound();

  const { deal, show, artist, agent, venue, recoupDeclarations, ambiguityFlags, bonuses, signoffs } = data;

  const dealRecord = decodeDeal(deal, { recoupDeclarations, ambiguityFlags });

  const allMandatorySigned =
    signoffs.some((s) => s.role === "booker") &&
    signoffs.some((s) => s.role === "agent");

  const artistName = artist?.name ?? "Artist";
  const venueName = venue?.name ?? "The Crescent";

  return (
    <div className="min-h-screen bg-canvas">
      {/* Top bar */}
      <div className="border-b border-ink-200/80 bg-white px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-700" />
          <span className="text-[13px] font-semibold text-ink-900">
            Greenroom · Deal Model
          </span>
        </div>
        <span className="text-[12px] text-ink-500">
          Read-only · {venueName}
        </span>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-10 space-y-6">
        {/* Banner */}
        <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-5 py-4">
          <p className="text-[13px] text-sky-900 font-medium">
            You&apos;re viewing the deal model The Crescent has built for{" "}
            <strong>{artistName}</strong> ({formatShowDateFull(show?.date ?? "")}).
          </p>
          <p className="text-[12px] text-sky-700 mt-1">
            Review the extracted terms and sign off at the bottom when you&apos;re
            satisfied. Any open questions have already been resolved by the venue.
          </p>
        </div>

        {/* Confirmed banner */}
        {allMandatorySigned && (
          <div className="rounded-lg border border-brand-300 bg-brand-50 px-5 py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-brand-700 shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-brand-900">
                Deal confirmed
              </p>
              <p className="text-[12px] text-brand-700 mt-0.5">
                All mandatory parties have signed off on this deal.
              </p>
            </div>
          </div>
        )}

        {/* Final summary */}
        <FinalSummary
          artistName={artistName}
          showDate={show?.date ?? ""}
          venueName={venueName}
          deal={deal}
          recoupDeclarations={recoupDeclarations}
          bonuses={bonuses}
          ambiguityFlags={ambiguityFlags}
          signoffs={signoffs}
        />

        {/* Collapsible simulator */}
        <SimulatorSection dealRecord={dealRecord} venue={venue} />

        {/* Sign-off */}
        <SignOffSection
          shareToken={token}
          signoffs={signoffs}
          agentName={agent?.name ?? null}
          agentEmail={agent?.email ?? null}
          isConfirmed={allMandatorySigned}
        />
      </div>
    </div>
  );
}

// Thin server wrapper so we can pass the venue capacity without making
// the whole page client-side.
function SimulatorSection({
  dealRecord,
  venue,
}: {
  dealRecord: ReturnType<typeof decodeDeal>;
  venue: { capacity: number } | null;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-600 hover:text-ink-900 select-none">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          Run hypothetical scenarios (simulator)
        </div>
      </summary>
      <div className="mt-4">
        <Simulator
          deal={dealRecord}
          defaults={{ gross: 15000, expenses: 1500, capacity: venue?.capacity }}
        />
      </div>
    </details>
  );
}
