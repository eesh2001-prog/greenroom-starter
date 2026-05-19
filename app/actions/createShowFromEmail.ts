"use server";

/**
 * Server Action: createShowFromEmail
 *
 * Takes the raw deal-email text from the intake form on /shows, extracts it
 * via the Claude API (lib/dealExtraction), finds-or-creates the artist and
 * agent records, writes a new show + deal with all Modeler artifacts
 * populated, and redirects to /shows/<id>/model.
 *
 * Returns an error state if extraction fails or the input is too short —
 * Next.js's `redirect()` throws on success, so the function only returns
 * via the error path.
 */

import { db } from "@/db";
import {
  shows,
  deals,
  artists,
  agents,
  type RecoupDeclaration,
  type AmbiguityFlag,
  type ExtractionMeta,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { extractDealFromEmail } from "@/lib/dealExtraction";

const VENUE_ID = "venue_crescent";
const MIN_EMAIL_LENGTH = 50;

export type CreateShowState =
  | { status: "idle" }
  | { status: "error"; error: string };

function shortId(): string {
  // Crypto.randomUUID returns 36 chars with hyphens; we slice 8 hex chars
  // off the front for compact, readable IDs alongside the existing
  // show_NNNN seed pattern.
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidIsoDate(s: string | null): s is string {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

export async function createShowFromEmail(
  _prevState: CreateShowState,
  formData: FormData,
): Promise<CreateShowState> {
  const emailText = formData.get("emailText");
  if (typeof emailText !== "string" || emailText.trim().length < MIN_EMAIL_LENGTH) {
    return {
      status: "error",
      error: `Please paste the full deal email (at least ${MIN_EMAIL_LENGTH} characters).`,
    };
  }

  let extracted;
  try {
    extracted = await extractDealFromEmail(emailText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return { status: "error", error: `Extraction failed: ${message}` };
  }

  // -------- Find or create artist --------
  const artistName = extracted.artist.name?.trim();
  if (!artistName) {
    return {
      status: "error",
      error: "Couldn't pull an artist name out of the email. Please verify the email includes the artist name.",
    };
  }

  let artistId: string;
  const existingArtist = await db
    .select({ id: artists.id })
    .from(artists)
    .where(sql`lower(${artists.name}) = lower(${artistName})`)
    .limit(1);

  if (existingArtist.length > 0) {
    artistId = existingArtist[0].id;
  } else {
    // Optionally find-or-create the agent record alongside the new artist.
    let agentId: string | null = null;
    const extractedAgentEmail = extracted.agent.email?.trim();
    if (extractedAgentEmail) {
      const existingAgent = await db
        .select({ id: agents.id })
        .from(agents)
        .where(sql`lower(${agents.email}) = lower(${extractedAgentEmail})`)
        .limit(1);
      if (existingAgent.length > 0) {
        agentId = existingAgent[0].id;
      } else if (extracted.agent.name) {
        agentId = `agent_user_${shortId()}`;
        await db.insert(agents).values({
          id: agentId,
          name: extracted.agent.name,
          email: extractedAgentEmail,
          agencyId: null,
          phone: null,
          preferencesNotes: null,
        });
      }
    }

    artistId = `art_user_${shortId()}`;
    await db.insert(artists).values({
      id: artistId,
      name: artistName,
      genre: extracted.artist.genre ?? null,
      agentId,
      managerEmail: null,
      priorShowCount: 0,
    });
  }

  // -------- Show date --------
  // Fall back to today + 30 days if the model couldn't extract a sensible
  // date. Keeps the demo coherent — every new show is "upcoming" so the
  // Modeler tab lands you on the catch-it-before-show-week story.
  const showDate = isValidIsoDate(extracted.showDate)
    ? extracted.showDate
    : todayPlusDays(30);

  // -------- Show + deal --------
  const showId = `show_user_${shortId()}`;
  const now = new Date();
  const isFuture = new Date(showDate) > new Date(todayPlusDays(0));

  await db.insert(shows).values({
    id: showId,
    venueId: VENUE_ID,
    artistId,
    date: showDate,
    status: isFuture ? "booked" : "settled",
    doorsTime: null,
    setTime: null,
    openerArtistId: null,
    roomConfig: "standing",
    internalNotes: null,
    createdAt: now,
  });

  // Convert extraction's array-shaped configDelta/fieldConfidence into the
  // record shapes the rest of the app expects.
  const recoupDeclarations: RecoupDeclaration[] = extracted.recoupDeclarations.map(
    (r, idx) => ({ id: `rec_${showId}_${idx}`, ...r }),
  );

  const ambiguityFlags: AmbiguityFlag[] = extracted.ambiguityFlags.map(
    (flag, idx) => ({
      id: `amb_${showId}_${idx}`,
      sourceClause: flag.sourceClause,
      affectedFields: flag.affectedFields,
      readings: flag.readings.map((reading) => ({
        label: reading.label,
        description: reading.description,
        configDelta: Object.fromEntries(
          reading.configDelta.map((kv) => [kv.path, kv.value]),
        ) as Record<string, unknown>,
      })),
      status: "open",
      resolvedReading: null,
      resolutionNote: null,
      resolvedBy: null,
      resolvedAt: null,
    }),
  );

  const extractionMeta: ExtractionMeta = Object.fromEntries(
    extracted.fieldConfidence.map((f) => [
      f.field,
      { confidence: f.confidence, sourceSpan: f.sourceSpan },
    ]),
  );

  await db.insert(deals).values({
    id: `deal_${showId}`,
    showId,
    dealType: extracted.deal.dealType,
    guaranteeAmount: extracted.deal.guaranteeAmount,
    percentage: extracted.deal.percentage,
    percentageBasis: extracted.deal.percentageBasis,
    expenseCap: extracted.deal.expenseCap,
    hospitalityCap: extracted.deal.hospitalityCap,
    bonusesJson: JSON.stringify(extracted.bonuses),
    dealNotesFreetext: null,
    sourceEmailText: emailText,
    modelStatus: "draft",
    shareToken: null,
    agentConfirmedAt: null,
    venueConfirmedAt: null,
    recoupDeclarationsJson: JSON.stringify(recoupDeclarations),
    ambiguityFlagsJson: JSON.stringify(ambiguityFlags),
    extractionMetaJson: JSON.stringify(extractionMeta),
    createdAt: now,
  });

  // Make the new show visible immediately on the next /shows fetch,
  // then send the user straight to its Modeler tab.
  revalidatePath("/shows");
  revalidatePath(`/shows/${showId}`);
  redirect(`/shows/${showId}/model`);
}
