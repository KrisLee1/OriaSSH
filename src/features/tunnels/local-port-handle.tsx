import { useEffect, useRef } from "react";
import { Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { ConnectionPort } from "./connection-port";
import { canvasPortId } from "./canvas-state";
import { projectPort, type PortPlacement } from "./port-placement";

export function LocalPortHandle({
  port,
  listening,
  offset,
  onChange,
  onDragChange,
}: {
  port: {
    ruleId: string;
    side: Position;
    type: "source" | "target";
    label: string;
    name: string;
    color: string;
    custom?: PortPlacement;
  };
  listening: boolean;
  offset: number;
  onChange: (id: string, value: PortPlacement | null, commit: boolean) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const { t } = useTranslation("tunnel");
  const cancelDrag = useRef<(() => void) | null>(null);
  const moved = useRef(false);
  useEffect(() => () => cancelDrag.current?.(), []);
  const horizontal =
    port.side === Position.Top || port.side === Position.Bottom;
  const placement: CSSProperties = horizontal
    ? { left: `${offset * 100}%` }
    : { top: `${offset * 100}%` };
  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary || cancelDrag.current) return;
    const handle = event.currentTarget;
    const card = handle.closest<HTMLElement>(".local-card");
    if (!card) return;

    event.preventDefault();
    event.stopPropagation();
    moved.current = false;
    const { pointerId, clientX, clientY } = event;
    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };

    const placementAt = (pointer: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      return projectPort(
        ((pointer.clientX - rect.left) * width) / rect.width,
        ((pointer.clientY - rect.top) * height) / rect.height,
        width,
        height,
      );
    };
    function finish(pointer?: PointerEvent) {
      controller.abort();
      cancelDrag.current = null;
      if (moved.current) {
        onChange(
          port.ruleId,
          pointer ? placementAt(pointer) : (port.custom ?? null),
          !!pointer,
        );
        onDragChange(false);
      }
      if (!pointer && handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    }
    cancelDrag.current = finish;

    // Follow the drag even if pointer capture is lost while crossing the canvas.
    const doc = handle.ownerDocument;
    doc.addEventListener(
      "pointermove",
      (pointer) => {
        if (pointer.pointerId !== pointerId) return;
        if (!moved.current) {
          if (
            Math.hypot(pointer.clientX - clientX, pointer.clientY - clientY) <=
            4
          )
            return;
          moved.current = true;
          onDragChange(true);
        }
        pointer.stopPropagation();
        onChange(port.ruleId, placementAt(pointer), false);
      },
      options,
    );
    doc.addEventListener(
      "pointerup",
      (pointer) => {
        if (pointer.pointerId !== pointerId) return;
        if (moved.current) pointer.stopPropagation();
        finish(pointer);
      },
      options,
    );
    doc.addEventListener(
      "pointercancel",
      (pointer) => {
        if (pointer.pointerId === pointerId) finish();
      },
      options,
    );
    doc.addEventListener(
      "keydown",
      (key) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        finish();
      },
      options,
    );
    doc.defaultView?.addEventListener("blur", () => finish(), {
      signal: controller.signal,
    });

    handle.setPointerCapture(pointerId);
    handle.focus({ preventScroll: true });
  }

  function suppressDragClick(event: MouseEvent<HTMLElement>) {
    if (event.detail && moved.current) event.stopPropagation();
  }
  return (
    <>
      <ConnectionPort
        id={canvasPortId(port.ruleId, port.type)}
        type={port.type}
        position={port.side}
        className="connection-port local-port-handle nodrag nopan"
        isConnectable={false}
        isConnectableStart={false}
        isConnectableEnd={false}
        listening={listening}
        data-rule-endpoint={port.ruleId}
        aria-haspopup="dialog"
        onClick={suppressDragClick}
        role="button"
        tabIndex={0}
        aria-label={`${port.name} · ${port.label} · ${t("movePortHint")}`}
        title={`${port.name} · ${port.label} · ${t("movePortHint")}`}
        style={
          {
            ...placement,
            "--connection-color": port.color,
          } as CSSProperties
        }
        onPointerDown={startDrag}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onChange(port.ruleId, null, true);
        }}
        onKeyDown={(event) => {
          if (cancelDrag.current) return;
          if (["Delete", "Backspace"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onChange(port.ruleId, null, true);
            return;
          }
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          event.stopPropagation();
          const side = event.shiftKey
            ? (
                {
                  ArrowUp: Position.Top,
                  ArrowDown: Position.Bottom,
                  ArrowLeft: Position.Left,
                  ArrowRight: Position.Right,
                } as Record<string, Position>
              )[event.key]
            : port.side;
          onChange(
            port.ruleId,
            {
              side,
              offset: Math.max(
                0.1,
                Math.min(
                  0.9,
                  offset +
                    (event.key === "ArrowUp" || event.key === "ArrowLeft"
                      ? -0.05
                      : 0.05),
                ),
              ),
            },
            true,
          );
        }}
      />
      <span
        className={`port-label-anchor react-flow__handle-${port.side}`}
        style={
          { ...placement, "--connection-color": port.color } as CSSProperties
        }
      >
        <button
          type="button"
          className="connection-port-label nodrag nopan nokey"
          data-edit-port={port.ruleId}
          aria-label={`${t("edit")} ${port.name} · ${port.label}`}
          title={port.label}
          onPointerDown={startDrag}
          onClick={suppressDragClick}
        >
          {port.label}
        </button>
      </span>
    </>
  );
}
