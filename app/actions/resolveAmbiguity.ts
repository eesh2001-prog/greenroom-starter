"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import type { AmbiguityFlag, RecoupDeclaration } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type ResolveResult = { ok: true } | { ok: false; error: string };

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current == null || typeof current !== "object") return;
  (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
}

export async function resolveAmbiguity(
  showId: string,
  flagId: string,
  readingLabel: string,
  resolvedBy: string,
  resolutionNote: string,
): Promise<ResolveResult> {
  const rows = await db
    .select()
    .from(deals)
    .where(eq(deals.showId, showId))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: "Deal not found." };
  const deal = rows[0];

  const flags = parseJson<AmbiguityFlag[]>(deal.ambiguityFlagsJson, []);
  const flag = flags.find((f) => f.id === flagId);
  if (!flag) return { ok: false, error: "Flag not found." };

  const reading = flag.readings.find((r) => r.label === readingLabel);
  if (!reading) return { ok: false, error: "Reading not found." };

  // Build a mutable object mirroring the DealRecord shape so configDelta
  // paths (e.g. "recoupDeclarations[0].deductionOrder") resolve correctly.
  const mutableState: Record<string, unknown> = {
    dealType: deal.dealType,
    guaranteeAmount: deal.guaranteeAmount,
    percentage: deal.percentage,
    percentageBasis: deal.percentageBasis,
    expenseCap: deal.expenseCap,
    hospitalityCap: deal.hospitalityCap,
    recoupDeclarations: parseJson<RecoupDeclaration[]>(
      deal.recoupDeclarationsJson,
      [],
    ),
  };

  for (const [path, value] of Object.entries(reading.configDelta)) {
    setByPath(mutableState, path, value);
  }

  flag.status = "resolved";
  flag.resolvedReading = readingLabel;
  flag.resolvedBy = resolvedBy || null;
  flag.resolutionNote = resolutionNote || null;
  flag.resolvedAt = Date.now();

  await db
    .update(deals)
    .set({
      ambiguityFlagsJson: JSON.stringify(flags),
      recoupDeclarationsJson: JSON.stringify(mutableState.recoupDeclarations),
      dealType: mutableState.dealType as typeof deal.dealType,
      guaranteeAmount: mutableState.guaranteeAmount as number | null,
      percentage: mutableState.percentage as number | null,
      percentageBasis: mutableState.percentageBasis as typeof deal.percentageBasis,
      expenseCap: mutableState.expenseCap as number | null,
      hospitalityCap: mutableState.hospitalityCap as number | null,
    })
    .where(eq(deals.showId, showId));

  revalidatePath(`/shows/${showId}`);
  revalidatePath(`/shows/${showId}/model`);
  return { ok: true };
}
