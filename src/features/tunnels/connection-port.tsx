import { Handle } from "@xyflow/react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { wireTravelMs } from "./wire-power";

// The .05 and .95 crossings on typical routes are the centers of
// the two 140ms rim transitions. Preserve pending arrivals on fast toggles.
export function ConnectionPort({
  listening,
  ...props
}: ComponentProps<typeof Handle> & { listening: boolean }) {
  const target = props.type === "target";
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [arrived, setArrived] = useState(false);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, [reduced, target]);
  useEffect(() => {
    if (!target || reduced) {
      setArrived(listening);
      return;
    }
    if (!listening && !timers.current.size && !arrived) return;
    const id = window.setTimeout(
      () => {
        timers.current.delete(id);
        setArrived(listening);
      },
      wireTravelMs * 0.95 - 70,
    );
    timers.current.add(id);
    // Queue each emission once. Delivery updates only the receiving rim.
  }, [target, reduced, listening]);
  return (
    <Handle
      {...props}
      data-listening={(target && !reduced ? arrived : listening) || undefined}
    />
  );
}
