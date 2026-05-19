"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlainBadge } from "@/components/ui/badge";
import { shareDeal } from "@/app/actions/shareDeal";
import type { Signoff } from "@/db/schema";

type Props = {
  showId: string;
  openFlagCount: number;
  modelStatus: "draft" | "shared" | "confirmed";
  shareToken: string | null;
  signoffs: Signoff[];
};

export function SharePanel({
  showId,
  openFlagCount,
  modelStatus,
  shareToken: initialToken,
  signoffs: initialSignoffs,
}: Props) {
  const [bookerName, setBookerName] = useState("Mariana Reyes");
  const [bookerEmail, setBookerEmail] = useState("mariana@thecrescentnashville.com");
  const [token, setToken] = useState(initialToken);
  const [signoffs] = useState(initialSignoffs);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const shareUrl = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/shared/${token}`
    : null;

  const alreadyShared = modelStatus === "shared" || modelStatus === "confirmed";

  function handleShare() {
    setError(null);
    startTransition(async () => {
      const result = await shareDeal(showId, bookerName, bookerEmail);
      if (!result.ok) {
        setError(result.error);
      } else {
        setToken(result.shareToken);
      }
    });
  }

  function handleCopy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const bookerSigned = signoffs.find((s) => s.role === "booker");
  const agentSigned = signoffs.find((s) => s.role === "agent");

  return (
    <Card accent={modelStatus === "confirmed" ? "brand" : "sky"}>
      <CardHeader>
        <div>
          <CardTitle>Share for sign-off</CardTitle>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Send a read-only link to the agent, tour manager, and Marcus for
            their review and sign-off.
          </p>
        </div>
        <PlainBadge
          variant={
            modelStatus === "confirmed"
              ? "brand"
              : modelStatus === "shared"
                ? "sky"
                : "default"
          }
        >
          {modelStatus === "confirmed"
            ? "Confirmed"
            : modelStatus === "shared"
              ? "Awaiting sign-off"
              : "Draft"}
        </PlainBadge>
      </CardHeader>

      <CardContent className="space-y-4">
        {openFlagCount > 0 && !alreadyShared && (
          <div className="rounded-md border border-amber-200 bg-amber-50/40 px-4 py-3 text-[12.5px] text-amber-800">
            Resolve all {openFlagCount} open{" "}
            {openFlagCount === 1 ? "question" : "questions"} before sharing.
          </div>
        )}

        {/* Generate link form — shown when not yet shared */}
        {!alreadyShared && openFlagCount === 0 && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-600">
              Your sign-off will be recorded when you generate the link.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="eyebrow text-[10px] text-ink-500 block mb-1">
                  Your name
                </span>
                <input
                  type="text"
                  value={bookerName}
                  onChange={(e) => setBookerName(e.target.value)}
                  className="w-full h-8 px-3 rounded-md border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                />
              </label>
              <label className="block">
                <span className="eyebrow text-[10px] text-ink-500 block mb-1">
                  Your email (optional)
                </span>
                <input
                  type="email"
                  value={bookerEmail}
                  onChange={(e) => setBookerEmail(e.target.value)}
                  className="w-full h-8 px-3 rounded-md border border-ink-200 bg-white text-[12.5px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                />
              </label>
            </div>
            {error && (
              <p className="text-[12px] text-rose-700">{error}</p>
            )}
            <Button
              variant="brand"
              onClick={handleShare}
              disabled={isPending || !bookerName.trim()}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Generate sign-off link &amp; record my sign-off
            </Button>
          </div>
        )}

        {/* Share link — shown once generated */}
        {shareUrl && (
          <div className="space-y-3">
            <div>
              <div className="eyebrow text-[10px] text-ink-500 mb-1">
                Share link
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-[12px] font-mono bg-ink-50 border border-ink-200 rounded px-3 py-2 text-ink-700">
                  {shareUrl}
                </code>
                <Button variant="secondary" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-brand-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <p className="text-[11px] text-ink-400 mt-1.5">
                Send to: Agent · Tour Manager · Marcus (GM). Anyone with this
                link can view the deal and sign off.
              </p>
            </div>

            {/* Quick sign-off status */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Mariana", signed: !!bookerSigned, mandatory: true },
                { label: "Agent", signed: !!agentSigned, mandatory: true },
                {
                  label: "Tour Manager",
                  signed: !!signoffs.find((s) => s.role === "tour_manager"),
                  mandatory: false,
                },
                {
                  label: "Marcus (GM)",
                  signed: !!signoffs.find((s) => s.role === "gm"),
                  mandatory: false,
                },
              ].map(({ label, signed, mandatory }) => (
                <div
                  key={label}
                  className={`rounded-md border px-3 py-2 text-center ${
                    signed
                      ? "border-brand-200 bg-brand-50/60"
                      : "border-ink-200 bg-white"
                  }`}
                >
                  <div className="text-[11px] font-medium text-ink-700">
                    {label}
                  </div>
                  <div
                    className={`text-[10px] mt-0.5 ${signed ? "text-brand-700" : "text-ink-400"}`}
                  >
                    {signed ? "✓ Signed" : mandatory ? "Pending" : "Optional"}
                  </div>
                </div>
              ))}
            </div>

            {modelStatus === "confirmed" && (
              <div className="rounded-md border border-brand-300 bg-brand-50 px-4 py-3 text-[12.5px] text-brand-800 font-medium">
                ✓ All mandatory sign-offs received. Deal confirmed.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
