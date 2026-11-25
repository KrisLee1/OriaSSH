import type { BaseEdgeProps } from "@xyflow/react";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { connectionSweep, type WireFeatherPatch } from "./connection-sweep";

export const wireTravelMs = 940;
// The final dots of a completed file route briefly remain after its light arrives.
export const fileRouteExitMs = wireTravelMs + 220;

type Front = { powered: boolean; arrivedAt: number; id: number };
type Signal = {
  source: boolean;
  settled: boolean;
  serial: number;
  fronts: Front[];
};
type Sweep = NonNullable<ReturnType<typeof connectionSweep>>;

type PatchPaint = (patch: WireFeatherPatch | null, hue?: string) => void;

// The feather shares the underlying curve and dash origin. Only a small
// filled ribbon and a clipped dashed stroke are painted per travelling front.
function WireFeather({
  id,
  track,
  sequence,
  painters,
}: {
  id: string;
  track: ReactElement<BaseEdgeProps>;
  sequence: number;
  painters: Map<number, PatchPaint>;
}) {
  const group = useRef<SVGGElement>(null);
  const ribbon = useRef<SVGPathElement>(null),
    dots = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const node = group.current!;
    const gradients = [...node.querySelectorAll("linearGradient")];
    painters.set(sequence, (patch, hue) => {
      node.style.display = patch ? "" : "none";
      if (!patch) return;
      if (hue) node.setAttribute("color", hue);
      ribbon.current!.setAttribute("d", patch.core);
      dots.current!.setAttribute("d", patch.dots);
      for (const gradient of gradients)
        gradient.setAttribute("gradientTransform", patch.transform);
    });
    return () => {
      painters.delete(sequence);
    };
  }, [sequence, painters]);
  return (
    <g
      className="wire-front"
      ref={group}
      pointerEvents="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={id + "-clip"}>
          <path ref={dots} />
        </clipPath>
        <linearGradient
          id={id + "-glow"}
          gradientUnits="userSpaceOnUse"
          x2="1"
          y2="0"
        >
          <stop stopColor="currentColor" stopOpacity="0" />
          <stop offset=".26" stopColor="currentColor" stopOpacity=".40" />
          <stop
            offset=".48"
            stopColor="color-mix(in oklab, currentColor 64%, white)"
            stopOpacity=".80"
          />
          <stop offset=".73" stopColor="currentColor" stopOpacity=".46" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={id + "-dash"}
          gradientUnits="userSpaceOnUse"
          x2="1"
          y2="0"
          color={track.props.style?.stroke}
        >
          <stop stopColor="currentColor" stopOpacity="0" />
          <stop offset=".30" stopColor="currentColor" stopOpacity=".03" />
          <stop offset=".70" stopColor="currentColor" stopOpacity=".64" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <path
        d={track.props.path}
        clipPath={`url(#${id}-clip)`}
        fill="none"
        className="wire-track"
        stroke={`url(#${id}-dash)`}
        strokeWidth={track.props.style?.strokeWidth}
      />
      <path
        ref={ribbon}
        fill={`url(#${id}-glow)`}
        stroke={`url(#${id}-glow)`}
        strokeWidth="3.2"
        strokeOpacity=".16"
        strokeLinejoin="round"
      />
    </g>
  );
}

// Each new source state follows the previous one down the wire. A quick
// start/stop therefore emits a short lit interval with two independent ends.
export function WirePower({
  path,
  powered,
  track,
  color,
  targetColor = color,
  children,
}: {
  path: string;
  powered: boolean;
  track: ReactElement<BaseEdgeProps>;
  color?: string;
  targetColor?: string;
  children: (wire: Sweep, reduced: boolean) => ReactNode;
}) {
  const id = useId();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [signal, setSignal] = useState<Signal>({
    source: false,
    settled: false,
    serial: 0,
    fronts: [],
  });
  if (reduced && (signal.settled !== powered || signal.fronts.length > 0)) {
    setSignal({ ...signal, source: powered, settled: powered, fronts: [] });
  } else if (signal.source !== powered) {
    const serial = signal.serial + 1;
    const front = {
      powered,
      id: serial,
      arrivedAt: performance.now() + wireTravelMs,
    };
    setSignal({
      ...signal,
      source: powered,
      serial,
      fronts: [...signal.fronts, front],
    });
  }
  const crossing = signal.fronts.length > 0 && !reduced;
  const lit = powered || crossing;
  const wire = useMemo(() => (lit ? connectionSweep(path) : null), [lit, path]);
  const sections = useMemo(
    () => (crossing ? wire?.powerSections() : null),
    [crossing, wire],
  );
  const dots = useRef<SVGPathElement>(null);
  const light = useRef<SVGPathElement>(null);
  const painters = useRef(new Map<number, PatchPaint>());
  useLayoutEffect(() => {
    if (!wire || !sections) return;
    let frame = 0;
    function draw(now: number) {
      if (!wire || !sections) return;
      let litPath = "",
        dotsPath = "",
        from = 0;
      let lastArrived: Front | undefined;
      // The newest change is nearest the source. Adjacent fronts bound
      // independent intervals, so reversing the switch never reverses a wave.
      const positions = signal.fronts.map((front) =>
        sections.center(
          Math.min(1, Math.max(0, 1 + (now - front.arrivedAt) / wireTravelMs)),
        ),
      );
      for (let i = signal.fronts.length - 1; i >= 0; i--) {
        const front = signal.fronts[i];
        const position = positions[i];
        const previous =
          i + 1 < positions.length
            ? (positions[i + 1] + position) / 2
            : -Infinity;
        const next = i > 0 ? (positions[i - 1] + position) / 2 : Infinity;
        const band = sections.feather(position, front.powered, previous, next);
        const part = sections.strip(from, band.from);
        if (front.powered) litPath += part;
        else dotsPath += part;
        if (band.patch) litPath += band.patch.aperture;
        const hue =
          targetColor !== color && targetColor && color
            ? `color-mix(in srgb, ${targetColor} ${Math.min(100, Math.max(0, Math.round(position * 100)))}%, ${color})`
            : color;
        painters.current.get(front.id)?.(band.patch, hue);
        from = band.to;
        if (now >= front.arrivedAt && !lastArrived) lastArrived = front;
      }
      if (signal.settled) litPath += sections.strip(from, 1);
      else dotsPath += sections.strip(from, 1);
      light.current?.setAttribute("d", litPath);
      dots.current?.setAttribute("d", dotsPath);
      if (lastArrived) {
        const delivered = lastArrived;
        setSignal((current) => ({
          ...current,
          settled: delivered.powered,
          fronts: current.fronts.filter((front) => front.id > delivered.id),
        }));
      } else {
        frame = requestAnimationFrame(draw);
      }
    }
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [wire, sections, signal, color, targetColor]);
  return (
    <>
      {crossing && (
        <defs>
          <clipPath id={id + "-lit"}>
            <path ref={light} />
          </clipPath>
          <clipPath id={id + "-dots"}>
            <path ref={dots} />
          </clipPath>
        </defs>
      )}
      <g
        className="wire-dots"
        opacity={lit && !crossing ? 0 : 1}
        clipPath={crossing ? `url(#${id}-dots)` : undefined}
      >
        {track}
      </g>
      <g
        className="wire-power"
        clipPath={crossing ? `url(#${id}-lit)` : undefined}
      >
        {wire && children(wire, reduced)}
      </g>
      {crossing &&
        signal.fronts.map((front) => (
          <WireFeather
            key={front.id}
            id={id + "-front-" + front.id}
            track={track}
            sequence={front.id}
            painters={painters.current}
          />
        ))}
    </>
  );
}
