import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { endpoint as formatEndpoint } from "./rule-model";
import type { ForwardRoute } from "@/types";
import { Popover, PopoverContent } from "@/components/ui/popover";

type Point = { x: number; y: number };
type Trigger =
  | { id: string; element: HTMLElement; path?: undefined }
  | { id: string; element: SVGElement; path: SVGPathElement };
type Selection = {
  trigger: Trigger;
  anchor: HTMLElement | { contextElement: SVGElement; getBoundingClientRect: () => DOMRect };
  point?: Point;
  open: boolean;
  pinned: boolean;
};
type PendingHover = {
  trigger: Trigger;
  origin: Point;
  point: Point;
  timer: ReturnType<typeof setTimeout>;
};
const edgeHoverDelay = 250;
const closeDelay = 180;
const hoverSlop = 8;

function moved(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y) >= hoverSlop;
}

function forwardTrigger(target: EventTarget | null): Trigger | null {
  if (!(target instanceof Element)) return null;
  const endpoint = target.closest<HTMLElement>("[data-rule-endpoint]");
  if (endpoint?.dataset.ruleEndpoint)
    return { id: endpoint.dataset.ruleEndpoint, element: endpoint };
  const edge = target.closest<SVGElement>(".react-flow__edge");
  const path = edge?.querySelector<SVGPathElement>("[data-forward-edge]");
  const id = path?.dataset.forwardEdge;
  return edge && path && id ? { id, element: edge, path } : null;
}

function forwardAnchor(trigger: Trigger, point?: Point): Selection["anchor"] {
  const path = trigger.path;
  if (!path) return trigger.element;
  const matrix = path.getScreenCTM();
  // Keep the selected point on the canvas when zooming or panning.
  const anchor = point && matrix
    ? new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse())
    : path.getPointAtLength(path.getTotalLength() / 2);
  return {
    contextElement: path,
    getBoundingClientRect: () => {
      const transform = path.getScreenCTM();
      const screen = transform ? anchor.matrixTransform(transform) : point ?? anchor;
      return new DOMRect(screen.x, screen.y, 0, 0);
    },
  };
}

export function EndpointRoute({ route, hostName, editPort }: {
  route: ForwardRoute;
  hostName?: string;
  editPort?: (side: "local" | "host") => void;
}) {
  const { t } = useTranslation("tunnel");
  const remote = route.kind === "R";
  const remoteName = hostName || t("sourceMissing");
  const sourceName = remote ? remoteName : t("local");
  const targetName = remote ? t("local") : remoteName;
  const bindPort = route.bindPort || (remote ? "…" : t("autoPort"));

  function address(name: string, port: number | string, side: "host" | "local", label: string) {
    const addressHost = name.includes(":") ? `[${name}]` : name;
    return <code className="endpoint-route-address" title={formatEndpoint(name, port)}>
      <span className="endpoint-route-host">{addressHost}</span>
      <span>:</span>
      {editPort ? <button type="button" className="endpoint-port-button"
        title={label} aria-label={`${t("edit")} · ${label} ${port}`}
        onClick={() => editPort(side)}>{port}</button> : <span>{port}</span>}
    </code>;
  }
  return (
    <div className="endpoint-route">
      <div>
        <span title={sourceName}>{sourceName}</span>
        {address(route.bindAddress, bindPort, remote ? "host" : "local", t(remote ? "remoteBindPort" : "bindPort"))}
      </div>
      <ArrowRightIcon size={12} aria-hidden="true" />
      <div>
        <span title={targetName}>{targetName}</span>
        {route.kind === "D" ? <code>{t("socksExit")}</code> :
          address(route.targetHost, route.targetPort || "…", remote ? "local" : "host", t("targetPort"))}
      </div>
    </div>
  );
}

export function EndpointCards({
  children,
  disabled,
  render,
  onEdit,
}: {
  children: ReactNode;
  disabled: boolean;
  render: (id: string, close: () => void) => ReactNode;
  onEdit: (id: string, side: "local" | "host") => void;
}) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const pendingHover = useRef<PendingHover | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const popup = useRef<HTMLDivElement>(null);
  const restored = useRef<Trigger["element"] | null>(null);
  const cancelHover = useCallback(() => {
    clearTimeout(pendingHover.current?.timer);
    pendingHover.current = null;
  }, []);
  const cancelTimers = useCallback(() => {
    cancelHover();
    clearTimeout(closeTimer.current);
  }, [cancelHover]);
  const close = useCallback(() => {
    cancelTimers();
    setSelected((current) =>
      current?.open ? { ...current, open: false } : current,
    );
  }, [cancelTimers]);
  useEffect(() => cancelTimers, [cancelTimers]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (popup.current?.contains(document.activeElement)) return;
      setSelected((current) =>
        current?.open && !current.pinned
          ? { ...current, open: false }
          : current,
      );
    }, closeDelay);
  };
  const show = (trigger: Trigger, pin: boolean, point?: Point) => {
    if (disabled) return;
    cancelTimers();
    setSelected((old) => {
      if (!pin && old?.open && old.pinned) return old;
      if (
        old?.open &&
        old.trigger.element === trigger.element &&
        old.trigger.id === trigger.id &&
        old.pinned === pin &&
        (!point || (old.point && !moved(point, old.point)))
      )
        return old;
      return {
        trigger,
        anchor: forwardAnchor(trigger, point),
        point,
        open: true,
        pinned: pin,
      };
    });
  };
  const scheduleEdgeHover = (trigger: Trigger, point: Point) => {
    cancelHover();
    const timer = setTimeout(() => {
      const hover = pendingHover.current;
      pendingHover.current = null;
      if (hover?.trigger.element.isConnected)
        show(hover.trigger, false, hover.point);
    }, edgeHoverDelay);
    pendingHover.current = { trigger, origin: point, point, timer };
  };
  const triggerId = selected?.trigger.id;
  const triggerElement = selected?.trigger.element;
  const body = triggerId && render(triggerId, close);
  const open = !!(body && selected?.open && !disabled);
  const focusFirstAction = () => {
    if (!popup.current?.hasAttribute("data-open")) return;
    popup.current.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  };
  useEffect(() => {
    if (!open || !triggerId || !triggerElement) return;
    const id = CSS.escape(triggerId);
    const elements = triggerElement
      .closest(".canvas")
      ?.querySelectorAll(
        `[data-rule-endpoint="${id}"], .react-flow__edge[data-id="${id}"]`,
      );
    elements?.forEach((item) => item.classList.add("endpoint-highlight"));
    return () =>
      elements?.forEach((item) => item.classList.remove("endpoint-highlight"));
  }, [open, triggerId, triggerElement]);
  return (
    <Popover
      open={open}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen)
          setSelected((current) =>
            current?.open && !disabled && body ? current : null,
          );
      }}
      onOpenChange={(open, details) => {
        if (open) return;
        if (
          details.reason === "outside-press" &&
          triggerElement &&
          forwardTrigger(details.event.target)?.element === triggerElement
        ) {
          details.cancel();
          return;
        }
        if (details.reason === "escape-key" && triggerElement?.isConnected) {
          restored.current = triggerElement;
          triggerElement.focus({ preventScroll: true });
        }
        close();
      }}
    >
      <div
        className="endpoint-card-scope"
        onPointerOver={(e) => {
          if (
            disabled ||
            e.pointerType === "touch" ||
            e.buttons ||
            (open && selected?.pinned)
          )
            return;
          const hit = forwardTrigger(e.target);
          if (!hit || hit.element === forwardTrigger(e.relatedTarget)?.element)
            return;
          const point = { x: e.clientX, y: e.clientY };
          if (hit.path && hit.element !== triggerElement)
            scheduleEdgeHover(hit, point);
          else show(hit, false, hit.path ? point : undefined);
        }}
        onPointerMove={(e) => {
          if (
            disabled ||
            e.pointerType === "touch" ||
            e.buttons ||
            (open && selected?.pinned)
          )
            return;
          const pending = pendingHover.current;
          if (!pending && (!open || !selected?.point)) return;
          const hit = forwardTrigger(e.target);
          if (!hit?.path) return;
          const point = { x: e.clientX, y: e.clientY };
          if (pending?.trigger.element === hit.element) {
            if (moved(point, pending.origin)) scheduleEdgeHover(hit, point);
            else pending.point = point;
          } else if (hit.element === triggerElement) show(hit, false, point);
        }}
        onPointerOut={(e) => {
          const hit = forwardTrigger(e.target);
          if (!hit || hit.element === forwardTrigger(e.relatedTarget)?.element)
            return;
          if (pendingHover.current?.trigger.element === hit.element)
            cancelHover();
          if (hit.element === triggerElement) leave();
        }}
        onPointerDownCapture={cancelHover}
        onFocus={(e) => {
          const hit = forwardTrigger(e.target);
          // A mouse press can focus a line before its click is delivered.
          if (
            hit?.element.matches(":focus-visible") &&
            restored.current !== hit.element
          )
            show(hit, false);
          restored.current = null;
        }}
        onBlur={(e) => {
          if (
            forwardTrigger(e.target) &&
            !popup.current?.contains(e.relatedTarget)
          )
            leave();
        }}
        onClick={(e) => {
          if (disabled) return;
          const target = e.target instanceof Element ? e.target : null;
          const edit = target?.closest<HTMLElement>("[data-edit-port]");
          if (edit) {
            close();
            onEdit(
              edit.dataset.editPort!,
              edit.dataset.portSide === "host" ? "host" : "local",
            );
            return;
          }
          const hit = forwardTrigger(target);
          if (hit)
            show(
              hit,
              true,
              hit.path && e.detail ? { x: e.clientX, y: e.clientY } : undefined,
            );
        }}
        onKeyDownCapture={(e) => {
          if (disabled) return;
          const hit = forwardTrigger(e.target);
          if (!hit) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            show(hit, true);
            requestAnimationFrame(focusFirstAction);
          } else if (
            e.key === "Tab" &&
            !e.shiftKey &&
            open &&
            selected?.pinned &&
            selected.trigger.element === hit.element &&
            popup.current
          ) {
            e.preventDefault();
            focusFirstAction();
          }
        }}
      >
        {children}
      </div>
      {body && selected && (
        <PopoverContent
          anchor={selected.anchor}
          ref={popup}
          initialFocus={false}
          finalFocus={false}
          side="top"
          sideOffset={5}
          collisionAvoidance={{ side: "flip", align: "shift" }}
          aria-label={
            selected.trigger.element.getAttribute("aria-label") ||
            selected.trigger.id
          }
          className="endpoint-operation-card"
          onPointerEnter={cancelTimers}
          onPointerLeave={leave}
          onFocus={cancelTimers}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) leave();
          }}
          onPointerDown={() => {
            cancelTimers();
            setSelected((current) =>
              current?.open && !current.pinned
                ? { ...current, pinned: true }
                : current,
            );
          }}
        >
          {body}
        </PopoverContent>
      )}
    </Popover>
  );
}
