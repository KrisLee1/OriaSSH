import { Position } from "@xyflow/react";
import type { Host, RemoteService, Rule } from "@/types";
import { emptyRule } from "./rule-model";
import { directProtocol } from "@/features/commands/direct-protocol";

export type CanvasPoint = { x: number; y: number };

export function serviceLocalForward(hostId: string, service: RemoteService, rules: Rule[]): Rule | undefined {
  const { port } = service;
  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) return;
  const targets = new Set(rules.filter(rule =>
    rule.hostId === hostId && rule.kind === "L" && service.ruleIds.includes(rule.id),
  ).map(rule => rule.targetHost));
  const protocol = directProtocol(service, rules, hostId);
  const defaults = emptyRule(hostId);
  return {
    ...defaults,
    name: service.name,
    color: service.color ?? null,
    icon: service.icon ?? null,
    targetPort: port,
    targetHost: targets.size === 1 ? [...targets][0] : defaults.targetHost,
    serviceProtocol: protocol === "http" || protocol === "https" || protocol === "vnc" ? protocol : null,
  };
}

export function hostForwardDraft(hostId: string, kind: "R" | "D"): Rule {
  return { ...emptyRule(hostId), kind, targetPort: 0, name: kind === "D" ? "SOCKS5" : "" };
}

export function localForwardServiceIds(host: Host, rules: Rule[], services: RemoteService[]) {
  const linked = new Map(services.flatMap(service => service.ruleIds.map(id => [id, service.id] as const)));
  const localAddresses = new Set([host.address.toLowerCase(), "localhost", "127.0.0.1", "::1"]);
  const matches = new Map<string, string>();
  for (const rule of rules) {
    if (rule.kind !== "L") continue;
    const explicit = linked.get(rule.id);
    if (explicit) {
      matches.set(rule.id, explicit);
    } else if (localAddresses.has(rule.targetHost.toLowerCase())) {
      const candidates = services.filter(service => service.port === rule.targetPort);
      if (candidates.length === 1) matches.set(rule.id, candidates[0].id);
    }
  }
  return matches;
}

export function oppositeSide(side: Position) {
  return {
    top: Position.Bottom,
    bottom: Position.Top,
    left: Position.Right,
    right: Position.Left,
  }[side];
}

export function serviceEndpointSide(localX: number, hostX: number) {
  return localX <= hostX ? Position.Left : Position.Right;
}

type Size = { width: number; height: number };
export type HostPlacement = { ids: string[]; origin: CanvasPoint | null };
type Bounds = CanvasPoint & Size;

// Try the requested spot, then the nearest free space beside a measured card.
export function availableHostPosition(
  origin: CanvasPoint,
  size: Size,
  occupied: Bounds[],
) {
  const gap = 32;
  const overlaps = (point: CanvasPoint, rect: Bounds) =>
    point.x < rect.x + rect.width + gap &&
    rect.x < point.x + size.width + gap &&
    point.y < rect.y + rect.height + gap &&
    rect.y < point.y + size.height + gap;
  if (!occupied.some((rect) => overlaps(origin, rect))) return origin;
  const candidates = occupied.flatMap((rect) => [
    { x: rect.x + rect.width + gap, y: origin.y },
    { x: rect.x - size.width - gap, y: origin.y },
    { x: origin.x, y: rect.y + rect.height + gap },
    { x: origin.x, y: rect.y - size.height - gap },
  ]);
  const distance = (point: CanvasPoint) =>
    Math.hypot(point.x - origin.x, point.y - origin.y);
  return candidates
    .sort((a, b) => distance(a) - distance(b))
    .find((point) => !occupied.some((rect) => overlaps(point, rect)))!;
}
