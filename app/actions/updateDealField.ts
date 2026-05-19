"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import type { RecoupDeclaration } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type DealFieldUpdate =
  | { field: "dealType"; value: "flat" | "percentage_of_gross" | "percentage_of_net" | "vs" | "door" }
  | { field: "guaranteeAmount"; value: number | null }
  | { field: "percentage"; value: number | null }
  | { field: "percentageBasis"; value: "gross" | "net" | null }
  | { field: "expenseCap"; value: number | null }
  | { field: "hospitalityCap"; value: number | null }
  | { field: "recoupDeclarations"; value: RecoupDeclaration[] };

export type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateDealField(
  showId: string,
  update: DealFieldUpdate,
): Promise<UpdateResult> {
  try {
    const { field, value } = update;
    let patch: Partial<typeof deals.$inferInsert>;

    switch (field) {
      case "dealType":
        patch = { dealType: value };
        break;
      case "guaranteeAmount":
        patch = { guaranteeAmount: value };
        break;
      case "percentage":
        patch = { percentage: value };
        break;
      case "percentageBasis":
        patch = { percentageBasis: value };
        break;
      case "expenseCap":
        patch = { expenseCap: value };
        break;
      case "hospitalityCap":
        patch = { hospitalityCap: value };
        break;
      case "recoupDeclarations":
        patch = { recoupDeclarationsJson: JSON.stringify(value) };
        break;
    }

    await db.update(deals).set(patch).where(eq(deals.showId, showId));
    revalidatePath(`/shows/${showId}`);
    revalidatePath(`/shows/${showId}/model`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return { ok: false, error: message };
  }
}
