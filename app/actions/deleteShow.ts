"use server";

import { db } from "@/db";
import { shows, deals, ticketSales, comps, expenses, settlements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteShow(showId: string): Promise<DeleteResult> {
  try {
    // Delete child records in FK order before the show itself
    await db.delete(ticketSales).where(eq(ticketSales.showId, showId));
    await db.delete(comps).where(eq(comps.showId, showId));
    await db.delete(expenses).where(eq(expenses.showId, showId));
    await db.delete(settlements).where(eq(settlements.showId, showId));
    await db.delete(deals).where(eq(deals.showId, showId));
    await db.delete(shows).where(eq(shows.id, showId));

    revalidatePath("/shows");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}
