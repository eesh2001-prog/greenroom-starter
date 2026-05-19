/**
 * One-time migration: adds signoffs_json column to the deals table.
 *
 * Run once:
 *   npx tsx scripts/add-signoffs-column.ts
 *
 * Safe to re-run — IF NOT EXISTS guards against duplicate columns.
 */

import { client } from "@/db";

async function migrate() {
  try {
    await client.execute("ALTER TABLE deals ADD COLUMN signoffs_json TEXT");
    console.log("✓ signoffs_json column added.");
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("duplicate column")) {
      console.log("✓ signoffs_json column already exists — nothing to do.");
    } else {
      throw e;
    }
  }
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
