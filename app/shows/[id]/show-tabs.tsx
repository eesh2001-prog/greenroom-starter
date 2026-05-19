"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ShowTabs({
  showId,
  modelerStatus,
}: {
  showId: string;
  // Optional pill rendered on the Model tab — undefined means "no badge".
  modelerStatus?: "draft" | "shared" | "confirmed" | "open-questions";
}) {
  const pathname = usePathname();

  const tabs: { href: string; label: string; isActive: boolean }[] = [
    {
      href: `/shows/${showId}`,
      label: "Overview",
      isActive: pathname === `/shows/${showId}`,
    },
    {
      href: `/shows/${showId}/settle`,
      label: "Settle",
      isActive: pathname === `/shows/${showId}/settle`,
    },
    {
      href: `/shows/${showId}/model`,
      label: "Model",
      isActive: pathname === `/shows/${showId}/model`,
    },
  ];

  return (
    <div className="flex items-end gap-6 border-b border-ink-200/60 -mb-px">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "py-2.5 text-[12.5px] font-medium border-b-2 transition-colors inline-flex items-center gap-2",
            tab.isActive
              ? "text-ink-900 border-brand-700"
              : "text-ink-500 border-transparent hover:text-ink-800",
          )}
        >
          {tab.label}
          {tab.label === "Model" && modelerStatus && (
            <ModelerStatusPill status={modelerStatus} />
          )}
        </Link>
      ))}
    </div>
  );
}

function ModelerStatusPill({
  status,
}: {
  status: NonNullable<React.ComponentProps<typeof ShowTabs>["modelerStatus"]>;
}) {
  const variants = {
    draft: "bg-ink-100 text-ink-600 ring-ink-200/80",
    shared: "bg-sky-50 text-sky-800 ring-sky-200/80",
    confirmed: "bg-brand-50 text-brand-800 ring-brand-200/80",
    "open-questions": "bg-amber-50 text-amber-800 ring-amber-300/80",
  };
  const labels = {
    draft: "draft",
    shared: "shared",
    confirmed: "confirmed",
    "open-questions": "questions",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium ring-1 ring-inset",
        variants[status],
      )}
    >
      {labels[status]}
    </span>
  );
}
