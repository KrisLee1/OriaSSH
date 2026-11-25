import type { ActivityRecord, Host, Rule, Snapshot } from "@/types";
import { runtimeStatus } from "./runtime-status";

export type ActivityGrouping = "none" | "forward" | "status";
export type ActivityRow = {
  record: ActivityRecord;
  hostId?: string;
  host?: Host;
  rule?: Rule;
  services: { id: string; name: string }[];
  hostTest: boolean;
  status: { label: string; tone: string };
};
export function activityRows(
  data: Pick<Snapshot, "hosts" | "rules" | "services" | "activity">,
): ActivityRow[] {
  const hosts = new Map(data.hosts.map((host) => [host.id, host]));
  const rules = new Map(data.rules.map((rule) => [rule.id, rule]));
  const services = new Map(data.services?.map(({ id, name }) => [id, name]));
  return data.activity
    .map((record) => {
      const hostTest = record.ruleId.startsWith("host-test:");
      const rule = hostTest ? undefined : rules.get(record.ruleId);
      const hostId =
        record.hostId ??
        (hostTest ? record.ruleId.slice("host-test:".length) : rule?.hostId);
      const status = record.event.startsWith("command-")
        ? {
            label: record.event,
            tone: record.level === "warning" ? "danger" : "success",
          }
        : record.event.startsWith("target-")
          ? {
              label: record.event,
              tone: record.event === "target-reachable" ? "success" : "danger",
            }
          : runtimeStatus({
              status: record.event,
              errorKind: record.errorKind,
              configurationChanged: false,
            });
      return {
        record,
        hostId,
        host: hostId ? hosts.get(hostId) : undefined,
        rule: rule?.hostId === hostId ? rule : undefined,
        services: Array.from(new Set(record.serviceIds), (id) => ({
          id,
          name: services.get(id) || id,
        })),
        hostTest,
        status,
      };
    })
    .reverse()
    .sort((a, b) => b.record.timestamp - a.record.timestamp);
}
export function filterActivity(
  rows: ActivityRow[],
  filter: {
    host: string;
    forward: string;
    status: string;
    query: string;
    warnings: boolean;
  },
  translate: (key: string) => string,
) {
  const query = filter.query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (filter.host === "all" ||
        (filter.host === "unknown"
          ? !row.hostId
          : `host:${row.hostId}` === filter.host)) &&
      (filter.forward === "all" ||
        (filter.forward === "host-tests"
          ? row.hostTest
          : !row.hostTest && `rule:${row.record.ruleId}` === filter.forward)) &&
      (filter.status === "all" || row.status.label === filter.status) &&
      (!filter.warnings || row.record.level === "warning") &&
      (!query ||
        [
          row.record.username,
          row.host?.name,
          row.host?.address,
          row.hostId,
          row.rule?.name,
          row.record.ruleId,
          row.record.runId,
          ...row.services.flatMap(({ id, name }) => [id, name]),
          translate(row.record.event),
          translate(row.status.label),
          row.record.errorKind && translate(`failure-${row.record.errorKind}`),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
  );
}
export function groupActivity(rows: ActivityRow[], grouping: ActivityGrouping) {
  const groups = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    const key =
      grouping === "forward"
        ? row.record.ruleId
        : grouping === "status"
          ? row.status.label
          : "";
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups].map(([id, rows]) => ({ id, rows }));
}
