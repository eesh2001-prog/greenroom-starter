"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import type { Signoff } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type SignOffResult = { ok: true } | { ok: false; error: string };

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const MANDATORY_ROLES: Signoff["role"][] = ["booker", "agent"];

export async function signOff(
  shareToken: string,
  role: "agent" | "tour_manager" | "gm",
  name: string,
  email: string,
): Promise<SignOffResult> {
  if (!name.trim()) return { ok: false, error: "Name is required." };

  const rows = await db
    .select()
    .from(deals)
    .where(eq(deals.shareToken, shareToken))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: "Link not found." };
  const deal = rows[0];

  const signoffs = parseJson<Signoff[]>(deal.signoffsJson, []);

  if (signoffs.find((s) => s.role === role)) {
    return { ok: false, error: "This role has already signed off on this deal." };
  }

  signoffs.push({
    role,
    name: name.trim(),
    email: email.trim(),
    mandatory: role === "agent",
    signedAt: Date.now(),
  });

  // Confirm if all mandatory sign-offs are now present
  const signedRoles = new Set(signoffs.map((s) => s.role));
  const allMandatorySigned = MANDATORY_ROLES.every((r) => signedRoles.has(r));

  const patch: Partial<typeof deals.$inferInsert> = {
    signoffsJson: JSON.stringify(signoffs),
  };
  if (allMandatorySigned) {
    patch.modelStatus = "confirmed";
    if (role === "agent") patch.agentConfirmedAt = new Date();
  }

  await db
    .update(deals)
    .set(patch)
    .where(eq(deals.shareToken, shareToken));

  revalidatePath(`/shared/${shareToken}`);
  return { ok: true };
}
