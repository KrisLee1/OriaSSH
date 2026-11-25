import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BaseEdge,
  getBezierPath,
  Position,
  useReactFlow,
  ViewportPortal,
} from "@xyflow/react";
import { oppositeSide, serviceEndpointSide } from "./canvas-creation";
import { useTranslation } from "react-i18next";
import { projectPort, type PortPlacement } from "./port-placement";

type Point = { x: number; y: number };
type LinkSource =
  | { type: "local" }
  | { type: "service"; hostId: string; serviceId: string; name: string; color?: string | null }
  | { type: "forward"; hostId: string; ruleId: string; name: string };

type CanvasLink =
  | { type: "service"; hostId: string; serviceId: string; placement?: PortPlacement }
  | { type: "forward"; hostId: string; ruleId: string };

type Connect = (link: CanvasLink) => void;
const Links = createContext<Connect | null>(null);

export function CanvasLinks({
  children,
  onConnect,
}: {
  children: ReactNode;
  onConnect: Connect;
}) {
  return <Links.Provider value={onConnect}>{children}</Links.Provider>;
}

// Project the pointer onto the same rounded rectangle used for hit testing.
function edgeAnchor(edge: HTMLElement, pointer: Point, corner = 14) {
  const rect = edge.getBoundingClientRect();
  const zoom = rect.width / edge.offsetWidth;
  const width = edge.offsetWidth,
    height = edge.offsetHeight;
  const x = (pointer.x - rect.left) / zoom,
    y = (pointer.y - rect.top) / zoom;
  const placement = projectPort(x, y, width, height);
  const radius = Math.min(corner, width / 2, height / 2);
  const cx = Math.max(radius, Math.min(width - radius, x));
  const cy = Math.max(radius, Math.min(height - radius, y));
  const distance = Math.hypot(x - cx, y - cy);
  let local = { x, y };
  if (distance) {
    local = {
      x: cx + (radius * (x - cx)) / distance,
      y: cy + (radius * (y - cy)) / distance,
    };
  } else {
    switch (placement.side) {
      case Position.Left:
        local.x = 0;
        break;
      case Position.Right:
        local.x = width;
        break;
      case Position.Top:
        local.y = 0;
        break;
      case Position.Bottom:
        local.y = height;
        break;
    }
  }
  return {
    local,
    placement,
    radius: Math.max(5, 3.5 / zoom),
    screen: { x: rect.left + local.x * zoom, y: rect.top + local.y * zoom },
  };
}
type Anchor = ReturnType<typeof edgeAnchor>;

type Wire = {
  origin: Point;
  anchor: Anchor;
  end: Point;
  target: HTMLElement | null;
  targetSide?: Position;
  pointerId?: number;
};

function DraftWire({ wire, color }: { wire: Wire; color?: string | null }) {
  const flow = useReactFlow();
  const markerId = useId();
  const end = flow.screenToFlowPosition(wire.end);
  const [path] = getBezierPath({
    sourceX: wire.origin.x,
    sourceY: wire.origin.y,
    sourcePosition: wire.anchor.placement.side,
    targetX: end.x,
    targetY: end.y,
    targetPosition: wire.targetSide ?? oppositeSide(wire.anchor.placement.side),
  });
  return (
    <ViewportPortal>
      <svg className="canvas-draft-wire connection-stopped" style={{ color: color || undefined }} aria-hidden="true">
        <defs>
          <marker
            id={markerId}
            markerWidth="12.5"
            markerHeight="12.5"
            viewBox="-10 -10 20 20"
            orient="auto"
          >
            <path
              d="M -5 -4 L 0 0 L -5 4 Z"
              fill="currentColor"
              stroke="currentColor"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <BaseEdge
          path={path}
          interactionWidth={0}
          markerEnd={`url(#${markerId})`}
          style={{ stroke: "currentColor", strokeWidth: 1.5 }}
        />
        {wire.target && <circle className="canvas-wire-endpoint" cx={end.x} cy={end.y} r={4} />}
      </svg>
    </ViewportPortal>
  );
}

export function CardEdge({ source, disabled }: { source: LinkSource; disabled?: boolean }) {
  const connect = useContext(Links);
  if (!connect) return null;
  return <WireHandle source={source} disabled={disabled} connect={connect} />;
}

function WireHandle({ source, disabled, connect }: {
  source: LinkSource;
  disabled?: boolean;
  connect: Connect;
}) {
  const { t } = useTranslation("tunnel");
  const flow = useReactFlow();
  const [hover, setHover] = useState<Anchor | null>(null);
  const edge = useRef<HTMLButtonElement>(null);
  const [wire, setWire] = useState<Wire | null>(null);
  const selector = source.type === "local" ? "[data-link-service]"
    : source.type === "service" ? ".local-card" : "[data-link-host][data-link-target]";
  const radius = source.type === "local" ? 14 : 6;
  const target = disabled ? null : wire?.target;
  const dot = !disabled && (wire?.anchor ?? hover);
  const cancelPointer = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => {
    cancelPointer.current?.();
    setHover(null);
    setWire(null);
  }, []);
  useEffect(() => () => cancelPointer.current?.(), []);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  const drawing = !!wire && !disabled;
  useEffect(() => {
    if (!drawing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [drawing, cancel]);

  const eligible = (element: HTMLElement) =>
    source.type !== "forward" || element.dataset.linkHost !== source.hostId;
  const destination = (point: Point) => {
    const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(selector);
    return hit && eligible(hit) ? hit : null;
  };
  const finish = (current: Wire, hit: HTMLElement | null, point?: Point) => {
    setWire(null);
    if (edge.current?.getAttribute("aria-disabled") === "true" || !hit?.isConnected || !hit.matches(selector) || !eligible(hit)) return;
    if (source.type === "forward") {
      const hostId = hit.dataset.linkHost;
      if (hostId) connect({ type: "forward", hostId, ruleId: source.ruleId });
      return;
    }
    const serviceId = source.type === "service" ? source.serviceId : hit.dataset.linkService;
    const hostId = source.type === "service" ? source.hostId
      : hit.closest<HTMLElement>("[data-link-host]")?.dataset.linkHost;
    if (!hostId || !serviceId) return;
    const localEdge = source.type === "service" ? hit.querySelector<HTMLElement>(".canvas-card-edge") : null;
    const placement = point && (source.type === "local" ? current.anchor.placement
      : edgeAnchor(localEdge ?? hit, point).placement);
    connect({ type: "service", hostId, serviceId, placement });
  };
  const snapToTarget = (hit: HTMLElement, origin: Point, pointer?: Point) => {
    const bounds = hit.getBoundingClientRect();
    if (source.type === "local") {
      const localX = edge.current?.getBoundingClientRect().left ?? origin.x;
      const targetSide = serviceEndpointSide(localX, bounds.left);
      return {
        end: {
          x: targetSide === Position.Left ? bounds.left : bounds.right,
          y: bounds.top + bounds.height / 2,
        },
        targetSide,
      };
    }
    const anchor = edgeAnchor(hit, pointer ?? origin);
    return { end: anchor.screen, targetSide: anchor.placement.side };
  };
  const choose = (current: Wire, step: number) => {
    const targets = Array.from(edge.current?.closest(".canvas")?.querySelectorAll<HTMLElement>(selector) ?? [])
      .filter(eligible);
    if (!targets.length) return null;
    const index = current.target && targets.includes(current.target)
      ? targets.indexOf(current.target) : step > 0 ? -1 : 0;
    const next = targets[(index + step + targets.length) % targets.length];
    return {
      ...current,
      target: next,
      ...snapToTarget(next, current.anchor.screen),
    };
  };
  const label = t(source.type === "forward" ? "linkForwardHost" : "dragForward");
  const color = source.type === "service" ? source.color : target?.dataset.linkColor;
  return (
    <>
      <button
        type="button"
        ref={edge}
        className="canvas-card-edge nodrag nopan nokey"
        aria-label={source.type === "local" ? label : `${label} · ${source.name}`}
        aria-keyshortcuts="Enter Space ArrowLeft ArrowRight ArrowUp ArrowDown Escape"
        aria-disabled={disabled || undefined}
        onBlur={cancel}
        onPointerEnter={(event) => {
          if (!disabled && !wire && event.pointerType !== "touch" && !event.buttons)
            setHover(edgeAnchor(event.currentTarget, { x: event.clientX, y: event.clientY }, radius));
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          // Native activation covers Enter, Space and assistive technology.
          if (disabled || event.detail !== 0) return;
          if (wire && wire.pointerId === undefined) {
            finish(wire, wire.target);
          } else {
            const rect = event.currentTarget.getBoundingClientRect();
            const origin = { x: rect.right, y: rect.top + rect.height / 2 };
            const anchor = edgeAnchor(event.currentTarget, origin, radius);
            setWire(choose({
              anchor,
              origin: flow.screenToFlowPosition(anchor.screen),
              end: origin,
              target: null,
            }, 1));
          }
        }}
        onKeyDown={(event) => {
          if (!wire || disabled) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          } else if (wire.pointerId === undefined &&
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            setWire(choose(wire, event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1));
          }
        }}
        onPointerDown={(event) => {
          if (disabled || !event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const handle = event.currentTarget;
          handle.focus({ preventScroll: true });
          const origin = { x: event.clientX, y: event.clientY };
          const anchor = edgeAnchor(handle, origin, radius);
          const pointerId = event.pointerId;
          const start = {
            anchor,
            origin: flow.screenToFlowPosition(anchor.screen),
            end: origin,
            target: null,
            pointerId,
          };
          cancelPointer.current?.();
          setHover(null);
          setWire(start);
          handle.setPointerCapture(pointerId);
          // React Flow can release capture while crossing nodes. Keep one set of
          // document listeners so the original handle still receives the drop.
          const owner = handle.ownerDocument;
          const move = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;
            const point = { x: event.clientX, y: event.clientY };
            const target = destination(point);
            setWire({ ...start, target, ...(target ? snapToTarget(target, anchor.screen, point) : { end: point }) });
          };
          const drop = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;
            cleanup();
            const point = { x: event.clientX, y: event.clientY };
            const distance = Math.hypot(point.x - anchor.screen.x, point.y - anchor.screen.y);
            finish(start, distance >= 5 ? destination(point) : null, point);
          };
          const abort = (event: PointerEvent) => {
            if (event.pointerId === pointerId) cancel();
          };
          const cleanup = () => {
            owner.removeEventListener("pointermove", move, true);
            owner.removeEventListener("pointerup", drop, true);
            owner.removeEventListener("pointercancel", abort, true);
            cancelPointer.current = null;
          };
          cancelPointer.current = cleanup;
          owner.addEventListener("pointermove", move, true);
          owner.addEventListener("pointerup", drop, true);
          owner.addEventListener("pointercancel", abort, true);
        }}
        onPointerMove={(event) => {
          if (!disabled && !wire && event.pointerType !== "touch" && !event.buttons)
            setHover(edgeAnchor(event.currentTarget, { x: event.clientX, y: event.clientY }, radius));
        }}
      >
        <svg aria-hidden="true" width="100%" height="100%" overflow="visible">
          <rect width="100%" height="100%" rx={radius} />
          {dot
            ? <circle className="canvas-edge-dot" cx={dot.local.x} cy={dot.local.y} r={dot.radius} />
            : <circle className="canvas-edge-dot canvas-focus-dot" cx="100%" cy="50%" r={5} />}

        </svg>
      </button>
      {wire && drawing && <DraftWire wire={wire} color={color} />}
      {target && wire?.pointerId === undefined && (
        <span className="sr-only" role="status">{target.getAttribute("aria-label")}</span>
      )}
    </>
  );
}
