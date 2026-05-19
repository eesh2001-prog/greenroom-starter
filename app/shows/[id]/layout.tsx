import { getShowById } from "@/lib/queries";
import { ShowTabs } from "./show-tabs";

/**
 * Shared layout for /shows/[id]/* routes. Renders a tab bar above the
 * child page so the Overview / Settle / Model views feel like one show
 * surface. Each child page still owns its own header — the layout only
 * provides navigation.
 */
export default async function ShowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);

  const ambiguityFlags = data?.ambiguityFlags ?? [];
  const hasOpenFlags = ambiguityFlags.some((f) => f.status === "open");
  const modelerStatus = hasOpenFlags
    ? "open-questions"
    : (data?.deal?.modelStatus ?? undefined);

  return (
    <div>
      <div className="px-12 pt-5 sticky top-0 bg-canvas/90 backdrop-blur-sm z-20">
        <ShowTabs
          showId={id}
          modelerStatus={modelerStatus ?? undefined}
        />
      </div>
      {children}
    </div>
  );
}
