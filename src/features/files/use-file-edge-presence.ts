import { useEffect, useMemo, useState } from "react";
import type { Edge } from "@xyflow/react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fileRouteExitMs } from "../tunnels/wire-power";

type Exit = { edge: Edge; until: number };

// Keep only the visual route during its exit. Queue state and hit targets
// follow the native snapshot immediately. A restart reuses the same edge ID.
export function useFileEdgePresence(live: Edge[]) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [snapshot, setSnapshot] = useState({ live, exits: [] as Exit[] });
  if (live !== snapshot.live || (reduced && snapshot.exits.length)) {
    const ids = new Set(live.map((edge) => edge.id));
    const exits = reduced
      ? []
      : snapshot.exits.filter(({ edge }) => !ids.has(edge.id));
    if (!reduced) {
      const until = performance.now() + fileRouteExitMs;
      for (const edge of snapshot.live) {
        if (!ids.has(edge.id)) {
          exits.push({
            edge: {
              ...edge,
              focusable: false,
              selectable: false,
              data: { ...edge.data, leaving: true },
            },
            until,
          });
        }
      }
    }
    setSnapshot({ live, exits });
  }
  const until = snapshot.exits[0]?.until;
  useEffect(() => {
    if (until === undefined) return;
    const timer = window.setTimeout(
      () => {
        const now = Math.max(until, performance.now());
        setSnapshot((current) => ({
          ...current,
          exits: current.exits.filter((entry) => entry.until > now),
        }));
      },
      Math.max(0, until - performance.now()),
    );
    return () => window.clearTimeout(timer);
  }, [until]);
  return useMemo(
    () =>
      snapshot.exits.length
        ? [...live, ...snapshot.exits.map(({ edge }) => edge)]
        : live,
    [live, snapshot.exits],
  );
}
