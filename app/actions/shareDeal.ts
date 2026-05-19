"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import type { Signoff } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type ShareResult =
  | { ok: true; shareToken: string }
  | { ok: false; error: string };

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function shareDeal(
  showId: string,
  bookerName: string,
  bookerEmail: string,
): Promise<ShareResult> {
  if (!bookerName.trim()) return { ok: false, error: "Name is required." };

  const rows = await db
    .select()
    .from(deals)
    .where(eq(deals.showId, showId))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: "Deal not found." };
  const deal = rows[0];

  const token =
    deal.shareToken ??
    globalThis.crypto.randomUUID().replace(/-/g, "");

  const signoffs = parseJson<Signoff[]>(deal.signoffsJson, []);

  // Record booker sign-off (idempotent — skip if already present)
  if (!signoffs.find((s) => s.role === "booker")) {
    signoffs.push({
      role: "booker",
      name: bookerName.trim(),
      email: bookerEmail.trim(),
      mandatory: true,
      signedAt: Date.now(),
    });
  }

  await db
    .update(deals)
    .set({
      shareToken: token,
      modelStatus: "shared",
      venueConfirmedAt: new Date(),
      signoffsJson: JSON.stringify(signoffs),
    })
    .where(eq(deals.showId, showId));

  revalidatePath(`/shows/${showId}`);
  revalidatePath(`/shows/${showId}/model`);
  return { ok: true, shareToken: token };
}
