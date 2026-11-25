import { Position, type Node } from "@xyflow/react";
import type { PortPlacement } from "./port-placement";

// React Flow measures the outside face of a handle. On a lit wire the
// optical junction sits at its centre, exactly on the card rim.
export const canvasPortSize = 12;
const portInset = canvasPortSize / 2;
export const canvasPortCenterOffset = {
  [Position.Left]: { x: portInset, y: 0 },
  [Position.Right]: { x: -portInset, y: 0 },
  [Position.Top]: { x: 0, y: portInset },
  [Position.Bottom]: { x: 0, y: -portInset },
};

type LocalPort = { side: Position; custom?: PortPlacement };
const horizontalPortGap = 64;
const verticalPortGap = 30;
const cornerInset = 38;

function verticalPortInsets(ports: readonly LocalPort[]) {
  return {
    start: ports.some((port) => port.side === Position.Top) ? cornerInset : 15,
    end: ports.some((port) => port.side === Position.Bottom) ? cornerInset : 15,
  };
}

export function localPortSide(
  local: { x: number; y: number },
  host: { x: number; y: number },
) {
  const dx = host.x - local.x;
  const dy = host.y - local.y;
  return Math.abs(dy) > Math.abs(dx)
    ? dy < 0
      ? Position.Top
      : Position.Bottom
    : dx < 0
      ? Position.Left
      : Position.Right;
}

export function localCardSize(ports: readonly LocalPort[]) {
  const count = (side: Position) =>
    ports.filter((port) => port.side === side).length;
  const columns = Math.max(count(Position.Top), count(Position.Bottom));
  const rows = Math.max(count(Position.Left), count(Position.Right));
  const { start, end } = verticalPortInsets(ports);
  return {
    width: Math.max(200, (columns + 1) * horizontalPortGap),
    height: Math.max(
      164,
      (rows + 1) * verticalPortGap,
      start + end + Math.max(0, rows - 1) * verticalPortGap,
    ),
  };
}

export function localPortOffsets(
  ports: readonly LocalPort[],
  size: ReturnType<typeof localCardSize>,
) {
  const offsets = new Array<number>(ports.length);
  const vertical = verticalPortInsets(ports);
  for (const side of Object.values(Position)) {
    const group = ports.flatMap((port, index) =>
      port.side === side ? [{ port, index }] : [],
    );
    if (!group.length) continue;
    const horizontal = side === Position.Top || side === Position.Bottom;
    const dimension = horizontal ? size.width : size.height;
    const gap = horizontal ? horizontalPortGap : verticalPortGap;
    const { start, end } = horizontal
      ? { start: gap / 2, end: gap / 2 }
      : vertical;
    const ordered = group
      .map(({ port, index }, order) => ({
        index,
        desired: port.custom?.offset ?? (order + 1) / (group.length + 1),
      }))
      .sort((a, b) => a.desired - b.desired);
    let previous = start - gap;
    ordered.forEach(({ index, desired }, order) => {
      // Leave room for each following label, including near a reserved corner.
      const lastAvailable =
        dimension - end - (ordered.length - order - 1) * gap;
      previous = Math.max(
        previous + gap,
        Math.min(desired * dimension, lastAvailable),
      );
      offsets[index] = previous / dimension;
    });
  }
  return offsets;
}

// Runtime snapshots replace domain data, while React Flow owns measured geometry
// and interaction state. Dropping measured dimensions hides a node until remeasured.
export function reconcileCanvasNodes<T extends Node>(
  current: T[],
  incoming: T[],
): T[] {
  const previous = new Map(current.map((node) => [node.id, node]));
  const next = incoming.map((node) => {
    const old = previous.get(node.id);
    if (!old) return node;
    const keys = Object.keys(node.data);
    const data =
      keys.length === Object.keys(old.data).length &&
      keys.every((key) => {
        const before = old.data[key],
          after = node.data[key];
        return (
          before === after ||
          (Array.isArray(before) &&
            Array.isArray(after) &&
            before.length === after.length &&
            before.every((value, index) => value === after[index]))
        );
      })
        ? old.data
        : node.data;
    const merged = {
      ...old,
      ...node,
      data,
      position: old.dragging ? old.position : node.position,
      measured: old.measured,
      selected: old.selected,
      dragging: old.dragging,
      resizing: old.resizing,
    };
    return Object.keys(merged).every((key) =>
      key === "position"
        ? old.position.x === merged.position.x &&
          old.position.y === merged.position.y
        : old[key as keyof T] === merged[key as keyof T],
    )
      ? old
      : merged;
  });
  return next.length === current.length &&
    next.every((node, index) => node === current[index])
    ? current
    : next;
}

// Moving a handle to the other side must not change its identity: the existing
// measured endpoint stays valid while React Flow updates its new coordinates.
export function canvasPortId(ruleId: string, type: "source" | "target") {
  return `${ruleId}-${type}`;
}

export function readCanvasLayout(value: string | null): Record<string, { x: number; y: number }> {
  try {
    const saved = JSON.parse(value ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(
      (entry): entry is [string, { x: number; y: number }] => {
        const point = entry[1];
        return !!point && typeof point === "object" &&
          "x" in point && Number.isFinite(point.x) && "y" in point && Number.isFinite(point.y);
      },
    ));
  } catch {
    return {};
  }
}

export function canvasLayout(
  nodes: Node[],
  saved: Record<string, { x: number; y: number }>,
) {
  return {
    ...saved,
    ...Object.fromEntries(nodes.map((node) => [node.id, node.position])),
  };
}
