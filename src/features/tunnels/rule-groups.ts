import type { Host, RemoteService, Rule } from "@/types";

export interface RuleGroup {
  id: string;
  host?: Host;
  rules: Rule[];
}

// Identity is the saved profile, including its user, port and jump route.
export function groupRulesByHost(rules: Rule[], hosts: Host[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  const byId = new Map(hosts.map((host) => [host.id, host]));
  for (const rule of rules) {
    let group = groups.get(rule.hostId);
    if (!group) {
      group = {
        id: `host:${rule.hostId}`,
        host: byId.get(rule.hostId),
        rules: [],
      };
      groups.set(rule.hostId, group);
    }
    group.rules.push(rule);
  }
  return [...groups.values()];
}

export function canvasHostGroups(rules: Rule[], hosts: Host[]): RuleGroup[] {
  const groups = groupRulesByHost(rules, hosts);
  const grouped = new Set(groups.map(group => group.id));
  for (const host of hosts) {
    const id = `host:${host.id}`;
    if (grouped.has(id)) continue;
    groups.push({ id, host, rules: [] });
    grouped.add(id);
  }
  return groups;
}

type Point = { x: number; y: number };
export function groupPositions(
  groups: RuleGroup[],
  saved: Record<string, Point>,
  services: RemoteService[] = [],
) {
  const local = saved.local || { x: 0, y: 0 };
  const serviceRows = new Map<string, number>();
  for (const service of services) {
    for (const hostId of service.hostIds ?? []) {
      serviceRows.set(hostId, (serviceRows.get(hostId) ?? 0) + 1);
    }
  }
  const bottom = { left: local.y, right: local.y };
  return Object.fromEntries(
    groups.map((group) => {
      const side =
        group.rules.length && group.rules.every((rule) => rule.kind === "R")
          ? "left"
          : "right";
      const position = saved[group.id] || {
        x: local.x + (side === "left" ? -540 : 340),
        y: bottom[side],
      };
      bottom[side] = Math.max(
        bottom[side],
        position.y +
          168 +
          group.rules.length * 120 +
          (serviceRows.get(group.host?.id ?? "") ?? 0) * 150,
      );
      return [group.id, position];
    }),
  );
}
