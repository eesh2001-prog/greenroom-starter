"use client";

import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { generateClarificationEmail } from "@/lib/exports/clarificationEmail";
import type { DealRecord } from "@/lib/dealSimulation";
import type { AmbiguityFlag } from "@/db/schema";

type Props = {
  artistName: string;
  showDate: string;
  deal: DealRecord;
  flags: AmbiguityFlag[];
  defaultGross: number;
};

export function ClarificationEmailButton({
  artistName,
  showDate,
  deal,
  flags,
  defaultGross,
}: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const body = generateClarificationEmail({
      artistName,
      showDate,
      deal,
      flags,
      defaultGross,
    });
    if (!body) return;
    navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-500 hover:text-ink-900 transition-colors"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-brand-600" />
      ) : (
        <Mail className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied to clipboard" : "Copy clarification email"}
    </button>
  );
}
