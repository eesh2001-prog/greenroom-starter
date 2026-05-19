"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import type { Signoff } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type FinalizeResult = { ok: true } | { ok: false; error: string };

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function finalizeDeal(showId: string): Promise<FinalizeResult> {
  const rows = await db
    .select()
    .from(deals)
    .where(eq(deals.showId, showId))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: "Deal not found." };
  const deal = rows[0];

  if (deal.modelStatus === "confirmed") return { ok: true }; // idempotent

  const signoffs = parseJson<Signoff[]>(deal.signoffsJson, []);

  // Record Mariana's internal sign-off if not already present
  if (!signoffs.find((s) => s.role === "booker")) {
    signoffs.push({
      role: "booker",
      name: "Mariana Reyes",
      email: "mariana@thecrescentnashville.com",
      mandatory: true,
      signedAt: Date.now(),
    });
  }

  await db
    .update(deals)
    .set({
      modelStatus: "confirmed",
      venueConfirmedAt: new Date(),
      signoffsJson: JSON.stringify(signoffs),
    })
    .where(eq(deals.showId, showId));

  revalidatePath("/shows");
  revalidatePath(`/shows/${showId}`);
  revalidatePath(`/shows/${showId}/model`);
  return { ok: true };
}
