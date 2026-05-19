import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Sparkles } from "lucide-react";
import { getShowById } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { Simulator } from "@/components/modeler/simulator";
import { ExtractionReview } from "@/components/modeler/extraction-review";
import { RecoupEditor } from "@/components/modeler/recoup-editor";
import { AmbiguityCard } from "@/components/modeler/ambiguity-card";
import { FinalSummary } from "@/components/modeler/final-summary";
import { SharePanel } from "@/components/modeler/share-panel";
import { ClarificationEmailButton } from "./clarification-email-button";
import { FinalizeButton } from "./finalize-button";
import { decodeDeal } from "@/lib/dealSimulation";
import { formatShowDateFull } from "@/lib/format";

export default async function ModelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const {
    show,
    artist,
    deal,
    ticketSales,
    expenses,
    venue,
    ambiguityFlags,
    recoupDeclarations,
    extractionMeta,
    bonuses,
    signoffs,
  } = data;

  if (!deal) {
    return (
      <EmptyShell artistName={artist?.name ?? "—"} date={show.date}>
        <p className="text-[13px] text-ink-500">
          No deal entered for this show yet. Add one to start modeling.
        </p>
      </EmptyShell>
    );
  }

  if (!deal.sourceEmailText) {
    return (
      <EmptyShell artistName={artist?.name ?? "—"} date={show.date}>
        <Card>
          <CardHeader>
            <div className="flex items-start gap-2">
              <Mail className="h-4 w-4 text-ink-400 mt-0.5" />
              <div>
                <CardTitle>No deal email captured yet</CardTitle>
                <CardDescription>
                  Paste the deal email from the agent to extract structured
                  terms, surface any ambiguous clauses, and simulate payouts
                  before show week.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-[12.5px] text-ink-400 italic">
              Use the intake form on the Shows page to paste a deal email.
            </div>
          </CardContent>
        </Card>
      </EmptyShell>
    );
  }

  const dealRecord = decodeDeal(deal, { recoupDeclarations, ambiguityFlags });

  const actualGross = ticketSales.reduce((s, t) => s + t.gross, 0);
  const actualExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((s, e) => s + e.amount, 0);
  const actualTickets = ticketSales.reduce((s, t) => s + (t.qty ?? 0), 0);
  const capacity = venue?.capacity ?? undefined;

  const defaults = {
    gross: actualGross > 0 ? actualGross : 15000,
    expenses: actualExpenses > 0 ? actualExpenses : 1500,
    ticketsSold: actualTickets > 0 ? actualTickets : 400,
    capacity,
  };

  const openFlagCount = ambiguityFlags.filter((f) => f.status === "open").length;
  const resolvedFlagCount = ambiguityFlags.filter(
    (f) => f.status === "resolved",
  ).length;
  const allResolved = openFlagCount === 0;

  return (
    <div className="px-12 py-10 max-w-7xl space-y-6">
      <Link
        href={`/shows/${id}`}
        className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to {artist?.name ?? "show"}
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-3.5 w-3.5 text-brand-700" />
            <span className="eyebrow text-[10.5px] text-brand-700 font-medium">
              Deal Modeler
            </span>
            <span className="text-ink-300">·</span>
            <span className="text-[11px] text-ink-500">
              {formatShowDateFull(show.date)}
            </span>
            <span className="text-ink-300">·</span>
            {deal.modelStatus && (
              <PlainBadge
                variant={
                  deal.modelStatus === "confirmed"
                    ? "brand"
                    : deal.modelStatus === "shared"
                      ? "sky"
                      : "default"
                }
              >
                {deal.modelStatus}
              </PlainBadge>
            )}
            {openFlagCount > 0 && (
              <PlainBadge variant="amber">
                {openFlagCount} open{" "}
                {openFlagCount === 1 ? "question" : "questions"}
              </PlainBadge>
            )}
            {resolvedFlagCount > 0 && openFlagCount === 0 && (
              <PlainBadge variant="default">
                {resolvedFlagCount} resolved
              </PlainBadge>
            )}
          </div>
          <FinalizeButton
            showId={id}
            modelStatus={(deal.modelStatus ?? "draft") as "draft" | "shared" | "confirmed"}
            openFlagCount={openFlagCount}
          />
        </div>
        <h1
          className="font-display text-[36px] font-medium text-ink-900 leading-tight"
          style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
        >
          {artist?.name}
        </h1>
        <p className="text-[13px] text-ink-500 mt-2 max-w-2xl">
          Structured view of the deal email — what we extracted, how the math
          plays out, and which clauses need clarification before show night.
        </p>
      </div>

      {/* Simulator */}
      <Simulator deal={dealRecord} defaults={defaults} />

      {/* Extraction review */}
      <ExtractionReview
        showId={id}
        sourceEmailText={deal.sourceEmailText}
        extractionMeta={extractionMeta}
        deal={deal}
      />

      {/* Recoup editor */}
      {recoupDeclarations.length > 0 && (
        <RecoupEditor showId={id} recoupDeclarations={recoupDeclarations} />
      )}

      {/* Ambiguity cards */}
      {ambiguityFlags.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow text-[10.5px] text-ink-500 font-medium">
              Ambiguous clauses ({ambiguityFlags.length})
            </p>
            {openFlagCount > 0 && (
              <ClarificationEmailButton
                artistName={artist?.name ?? "Artist"}
                showDate={show.date}
                deal={dealRecord}
                flags={ambiguityFlags}
                defaultGross={defaults.gross}
              />
            )}
          </div>
          {ambiguityFlags.map((flag) => (
            <AmbiguityCard
              key={flag.id}
              showId={id}
              flag={flag}
              deal={dealRecord}
              defaultGross={defaults.gross}
            />
          ))}
        </div>
      )}

      {/* Final summary + share — only when all questions resolved */}
      {allResolved && (
        <>
          <FinalSummary
            artistName={artist?.name ?? "Artist"}
            showDate={show.date}
            venueName={venue?.name ?? "The Crescent"}
            deal={deal}
            recoupDeclarations={recoupDeclarations}
            bonuses={bonuses}
            ambiguityFlags={ambiguityFlags}
            signoffs={signoffs}
          />
          <SharePanel
            showId={id}
            openFlagCount={openFlagCount}
            modelStatus={(deal.modelStatus ?? "draft") as "draft" | "shared" | "confirmed"}
            shareToken={deal.shareToken ?? null}
            signoffs={signoffs}
          />
        </>
      )}
    </div>
  );
}

function EmptyShell({
  artistName,
  date,
  children,
}: {
  artistName: string;
  date: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-12 py-10 max-w-4xl">
      <div className="mb-6">
        <Sparkles className="h-3.5 w-3.5 text-ink-300 inline mr-2" />
        <span className="eyebrow text-[10.5px] text-ink-400 font-medium">
          Deal Modeler
        </span>
        <span className="text-ink-300 mx-2">·</span>
        <span className="text-[11px] text-ink-500">
          {formatShowDateFull(date)}
        </span>
        <h1
          className="font-display text-[32px] font-medium text-ink-900 leading-tight mt-2"
          style={{ letterSpacing: "-0.025em" }}
        >
          {artistName}
        </h1>
      </div>
      {children}
    </div>
  );
}
