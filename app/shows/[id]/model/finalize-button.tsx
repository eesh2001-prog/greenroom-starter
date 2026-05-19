"use client";

import { useTransition } from "react";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { finalizeDeal } from "@/app/actions/finalizeDeal";

type Props = {
  showId: string;
  modelStatus: "draft" | "shared" | "confirmed";
  openFlagCount: number;
};

export function FinalizeButton({ showId, modelStatus, openFlagCount }: Props) {
  const [isPending, startTransition] = useTransition();
  const isFinalized = modelStatus === "confirmed";

  function handleFinalize() {
    startTransition(async () => {
      await finalizeDeal(showId);
    });
  }

  if (isFinalized) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Deal finalized
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {openFlagCount > 0 && (
        <span className="text-[11px] text-amber-700">
          {openFlagCount} open {openFlagCount === 1 ? "question" : "questions"}
        </span>
      )}
      <Button
        variant="brand"
        size="sm"
        onClick={handleFinalize}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Lock className="h-3.5 w-3.5" />
        )}
        Finalize deal
      </Button>
    </div>
  );
}
