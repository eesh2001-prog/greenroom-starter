"use client";

/**
 * Deal Modeler — intake card at the top of /shows.
 *
 * Paste a deal email, hit "Extract", and the Server Action creates a new
 * show + deal and redirects to its Modeler tab. The textarea is the only
 * field; everything else (artist, date, terms, ambiguity flags) is pulled
 * out by the Claude API extraction step.
 */

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Mail, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createShowFromEmail,
  type CreateShowState,
} from "@/app/actions/createShowFromEmail";

// Initial state for useActionState. Lives here (not in the action file)
// because `"use server"` modules may only export async functions.
const initialState: CreateShowState = { status: "idle" };

const SAMPLE_EMAIL = `From: Sarah Kim <skim@wme.com>
To: Mariana Reyes <mariana@thecrescentnashville.com>
Subject: Holding — Pale Lake, late spring

Mariana,

Holding Pale Lake for The Crescent on 2026-06-12. Deal:

$6,500 vs 80% of net after expenses, whichever is greater.
Expense cap $3,000. Hospitality cap $600.
Marketing recoup of $1,200 against gross, recoupable against the $3,000 cap.
Bonus: 100% of every gross dollar above $35,000.

Let me know if anything looks off.

Sarah`;

export function IntakeCard() {
  const [state, formAction] = useActionState(
    createShowFromEmail,
    initialState,
  );
  const [emailText, setEmailText] = useState("");

  return (
    <Card accent="brand" className="mb-10">
      <CardHeader>
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-brand-700 mt-0.5" />
          <div>
            <CardTitle>New deal email</CardTitle>
            <p className="text-[12px] text-ink-500 mt-0.5 max-w-2xl leading-relaxed">
              Paste an agent&apos;s deal email — Claude extracts the structured
              terms, surfaces any ambiguous clauses, and drops you into the
              Modeler for the new show.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <div className="relative">
            <Mail className="absolute left-3 top-3 h-4 w-4 text-ink-300 pointer-events-none" />
            <textarea
              name="emailText"
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              rows={9}
              placeholder="Paste the deal email here…"
              className="w-full pl-10 pr-3 py-3 rounded-md border border-ink-200 bg-white text-[12.5px] font-mono leading-relaxed text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 resize-y"
            />
          </div>

          {state.status === "error" && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-rose-50 border border-rose-200/80 text-[12px] text-rose-800">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setEmailText(SAMPLE_EMAIL)}
              className="text-[11.5px] text-ink-500 hover:text-ink-800 underline-offset-2 hover:underline"
            >
              Load a sample email
            </button>
            <SubmitButton hasText={emailText.trim().length >= 50} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitButton({ hasText }: { hasText: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="brand"
      disabled={pending || !hasText}
      className="min-w-[140px]"
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Extracting…
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5" />
          Extract deal
        </>
      )}
    </Button>
  );
}
