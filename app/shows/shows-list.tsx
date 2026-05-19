"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Search, Calendar, Trash2 } from "lucide-react";
import { DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import { deleteShow } from "@/app/actions/deleteShow";

type Status = "booked" | "advanced" | "day_of" | "settled" | "closed";

export type ShowRow = {
  show: { id: string; status: Status };
  artist: { name: string } | null;
  deal: { dealType: string; guaranteeFormatted: string | null } | null;
  settlement: { totalFormatted: string | null; status: string } | null;
  dateFormatted: string;
  dateRelative: string;
  month: string;
};

const lifecycleStatusVariants: Record<
  string,
  { variant: "default" | "amber" | "brand" | "rose" | "sky"; label: string }
> = {
  draft: { variant: "default", label: "Draft" },
  submitted: { variant: "sky", label: "Submitted" },
  in_review: { variant: "sky", label: "In review" },
  signed: { variant: "brand", label: "Signed" },
  disputed: { variant: "rose", label: "Disputed" },
  revised: { variant: "amber", label: "Revised" },
  finalized: { variant: "brand", label: "Finalized" },
  paid: { variant: "brand", label: "Paid" },
  voided: { variant: "default", label: "Voided" },
};

function getAccentColor(row: ShowRow): string {
  if (row.settlement) {
    const s = row.settlement.status;
    if (s === "paid" || s === "finalized" || s === "signed") return "bg-brand-500";
    if (s === "disputed") return "bg-rose-500";
    if (s === "revised") return "bg-amber-500";
    if (s === "submitted" || s === "in_review") return "bg-sky-400";
    return "bg-ink-300";
  }
  return "bg-ink-200";
}

function groupByMonth(rows: ShowRow[]): { month: string; rows: ShowRow[] }[] {
  const groups: Map<string, ShowRow[]> = new Map();
  for (const row of rows) {
    if (!groups.has(row.month)) groups.set(row.month, []);
    groups.get(row.month)!.push(row);
  }
  return Array.from(groups.entries()).map(([month, rows]) => ({ month, rows }));
}

export function ShowsList({ rows: initialRows }: { rows: ShowRow[] }) {
  const [query, setQuery] = useState("");
  const [localRows, setLocalRows] = useState(initialRows);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleConfirmDelete(showId: string) {
    setLoadingId(showId);
    setDeleteError(null);
    const result = await deleteShow(showId);
    if (result.ok) {
      setLocalRows((prev) => prev.filter((r) => r.show.id !== showId));
      setConfirmingId(null);
    } else {
      setDeleteError(result.error);
    }
    setLoadingId(null);
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return localRows;
    const q = query.toLowerCase();
    return localRows.filter(
      (r) =>
        r.artist?.name.toLowerCase().includes(q) ||
        r.deal?.dealType.toLowerCase().includes(q) ||
        r.dateFormatted.toLowerCase().includes(q),
    );
  }, [localRows, query]);

  const months = useMemo(() => groupByMonth(filtered), [filtered]);

  return (
    <div>
      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search artists, deals…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 pl-9 pr-3 py-2 text-[13px] bg-white border border-ink-200/60 rounded-lg text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-700/20 focus:border-brand-300 transition-all"
          />
        </div>
      </div>

      {deleteError && (
        <div className="mb-4 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {deleteError}
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Calendar className="h-8 w-8 text-ink-200 mx-auto mb-3" />
          <div className="text-[14px] text-ink-500">
            {query ? `No shows matching "${query}"` : "No shows yet."}
          </div>
          {query && (
            <button
              onClick={() => setQuery("")}
              className="mt-2 text-[12px] text-brand-700 hover:text-brand-800 font-medium"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {months.map(({ month, rows }) => (
            <section key={month}>
              <div className="flex items-baseline justify-between mb-1 px-1 sticky top-0 bg-canvas/95 backdrop-blur-sm z-10 py-2 -my-1">
                <h3 className="text-[13px] font-semibold text-ink-900">
                  {month}
                </h3>
                <span className="text-[11px] font-mono tabular text-ink-400">
                  {rows.length} {rows.length === 1 ? "show" : "shows"}
                </span>
              </div>
              <div className="border-t border-ink-200/50">
                <ul>
                  {rows.map((row) => (
                    <ShowListRow
                      key={row.show.id}
                      row={row}
                      isConfirming={confirmingId === row.show.id}
                      isLoading={loadingId === row.show.id}
                      onDeleteClick={() => {
                        setConfirmingId(row.show.id);
                        setDeleteError(null);
                      }}
                      onConfirmDelete={() => handleConfirmDelete(row.show.id)}
                      onCancelDelete={() => setConfirmingId(null)}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      {query && filtered.length > 0 && (
        <div className="mt-4 text-center">
          <span className="text-[12px] text-ink-400">
            {filtered.length} of {localRows.length} shows
          </span>
        </div>
      )}
    </div>
  );
}

function ShowListRow({
  row,
  isConfirming,
  isLoading,
  onDeleteClick,
  onConfirmDelete,
  onCancelDelete,
}: {
  row: ShowRow;
  isConfirming: boolean;
  isLoading: boolean;
  onDeleteClick: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { show, artist, deal, settlement } = row;
  const accent = getAccentColor(row);

  if (isConfirming) {
    return (
      <li className="relative list-none">
        <div
          className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-rose-400`}
        />
        <div className="flex items-center justify-between pl-5 pr-3 py-3 bg-rose-50/60 rounded-lg border border-rose-200/60">
          <div>
            <span className="text-[13px] font-medium text-rose-900">
              Delete {artist?.name ?? "this show"}?
            </span>
            <span className="text-[12px] text-rose-600 ml-2">
              This removes the show, deal, and all associated data.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              onClick={onCancelDelete}
              disabled={isLoading}
              className="text-[12.5px] text-ink-600 hover:text-ink-900 px-3 py-1.5 rounded-md hover:bg-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Delete
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="relative group list-none">
      <div
        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-all duration-150 group-hover:top-1 group-hover:bottom-1 ${accent}`}
      />
      <Link
        href={`/shows/${show.id}`}
        className="grid grid-cols-[84px_1fr_120px_auto_24px] items-center gap-4 pl-5 pr-2 py-3 rounded-lg hover:bg-white/80 hover:shadow-[0_1px_4px_rgba(26,24,20,0.04)] transition-all duration-150"
      >
        <div>
          <div className="text-[12.5px] font-medium text-ink-800 tabular">
            {row.dateFormatted}
          </div>
          <div className="text-[10px] text-ink-400 mt-px">{row.dateRelative}</div>
        </div>

        <div className="min-w-0">
          <div className="text-[14.5px] font-medium text-ink-900 truncate group-hover:text-brand-800 transition-colors">
            {artist?.name ?? "—"}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {deal && <DealTypeBadge type={deal.dealType} />}
            {deal?.guaranteeFormatted && (
              <span className="font-mono tabular text-[11px] text-ink-500">
                {deal.guaranteeFormatted}
                {deal.dealType === "vs" ? " min" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="text-right">
          {settlement?.totalFormatted ? (
            <>
              <div className="font-mono tabular text-[14px] font-semibold text-ink-900">
                {settlement.totalFormatted}
              </div>
              <div className="text-[9px] text-ink-400 uppercase tracking-[0.08em] mt-px">
                to artist
              </div>
            </>
          ) : null}
        </div>

        <div className="flex justify-end">
          {settlement ? <SettlementPill status={settlement.status} /> : null}
        </div>

        <ArrowUpRight className="h-3.5 w-3.5 text-ink-200 group-hover:text-ink-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150" />
      </Link>

      {/* Trash button — outside the Link, shown on row hover */}
      <button
        onClick={onDeleteClick}
        title="Delete show"
        className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-ink-300 hover:text-rose-600 hover:bg-rose-50 transition-all duration-150 z-10"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function SettlementPill({ status }: { status: string }) {
  const v = lifecycleStatusVariants[status] ?? {
    variant: "default" as const,
    label: status,
  };
  return <PlainBadge variant={v.variant}>{v.label}</PlainBadge>;
}
