import { PageEmptyState } from "@/components/page-empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ScrollText, SearchX } from "lucide-react";
import {
  activityRows,
  filterActivity,
  type ActivityGrouping,
  type ActivityRow,
} from "./activity-model";
import type { Snapshot } from "@/types";
import { ActivityList } from "./activity-list";
export function ActivityView({
  data,
  scope,
}: {
  data: Snapshot;
  scope?: string | null;
}) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState("");
  const [warnings, setWarnings] = useState(false);
  const [host, setHost] = useState("all");
  const [forward, setForward] = useState("all");
  const [login, setLogin] = useState("all");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [grouping, setGrouping] = useState<ActivityGrouping>("none");
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const hostScoped = typeof scope === "string";
  const rows = activityRows(data).filter(
    (r) =>
      scope === undefined || (scope === null ? !r.host : r.hostId === scope),
  );
  const records = filterActivity(
    rows.filter(
      (r) =>
        (login === "all" || login === r.record.loginIdentityId) &&
        (service === "all" || r.record.serviceIds?.includes(service)),
    ),
    { host, forward, status, query, warnings },
    (key) => t(key),
  );
  const hostName = (row: ActivityRow) =>
    row.host?.name || row.hostId || t("unknownLogHost");
  const hosts = [
    ...new Map(
      rows.map((row) => [
        row.hostId || "",
        {
          value: row.hostId ? `host:${row.hostId}` : "unknown",
          label: hostName(row),
        },
      ]),
    ).values(),
  ];
  const forwards = [
    ...new Map(
      rows
        .filter((row) => !row.hostTest && row.record.ruleId)
        .map((row) => [
          row.record.ruleId,
          {
            value: `rule:${row.record.ruleId}`,
            label: row.rule?.name || row.record.ruleId,
          },
        ]),
    ).values(),
  ];
  const statuses = [...new Set(rows.map((row) => row.status.label))].map(
    (label) => ({ value: label, label: t(label) }),
  );
  const groups = [
    { value: "none", label: t("groupNoneLogs") },
    { value: "forward", label: t("groupForward") },
    { value: "status", label: t("groupStatus") },
  ];
  function picker(
    label: string,
    value: string,
    options: { value: string; label: string }[],
    change: (value: string) => void,
  ) {
    const items = options.some((item) => item.value === value)
      ? options
      : [...options, { value, label: value.replace(/^(host|rule):/, "") }];
    return (
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next) change(next);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={label}
          title={
            label === t("filterLogHost") ? t("logHostAssociationHint") : label
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <ScrollArea
      className="page-scroll-area"
      viewportClassName={
        scope === undefined
          ? "page activity-page scroll-fade"
          : "activity-page activity-timeline"
      }
      viewportRef={setViewport}
    >
      <header className="activity-page-heading">
        <h1>{t("activity")}</h1>
        <span aria-live="polite">
          {t("logCount", { count: records.length })}
        </span>
      </header>
      <div className="host-toolbar activity-toolbar">
        <SearchInput
          containerClassName="host-search"
          type="search"
          aria-label={t("searchLogs")}
          placeholder={t("searchLogs")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="host-toolbar-controls">
          {!hostScoped &&
            picker(
              t("filterLogHost"),
              host,
              [{ value: "all", label: t("allLogHosts") }, ...hosts],
              setHost,
            )}
          {picker(
            t("logins"),
            login,
            [
              { value: "all", label: t("allLogins") },
              ...Array.from(
                new Map(
                  rows
                    .filter((r) => r.record.loginIdentityId)
                    .map((r) => [
                      r.record.loginIdentityId!,
                      {
                        value: r.record.loginIdentityId!,
                        label: r.record.username || r.record.loginIdentityId!,
                      },
                    ]),
                ).values(),
              ),
            ],
            setLogin,
          )}
          {picker(
            t("services", { ns: "commands" }),
            service,
            [
              { value: "all", label: t("allServiceLogs") },
              ...new Map(
                rows.flatMap((row) =>
                  row.services.map(({ id, name }) => [
                    id,
                    { value: id, label: name },
                  ]),
                ),
              ).values(),
            ],
            setService,
          )}
          {picker(
            t("filterLogForward"),
            forward,
            [
              { value: "all", label: t("allLogForwards") },
              ...(rows.some((row) => row.hostTest)
                ? [{ value: "host-tests", label: t("hostTestLogs") }]
                : []),
              ...forwards,
            ],
            setForward,
          )}
          {picker(
            t("filterHostStatus"),
            status,
            [{ value: "all", label: t("allLogStatuses") }, ...statuses],
            setStatus,
          )}
          <Button
            size="sm"
            variant={warnings ? "secondary" : "ghost"}
            aria-pressed={warnings}
            onClick={() => setWarnings(!warnings)}
          >
            {t("warningsOnly")}
          </Button>
          {picker(t("groupLogs"), grouping, groups, (next) => {
            if (next === "none" || next === "forward" || next === "status")
              setGrouping(next);
          })}
        </div>
      </div>
      {!records.length ? (
        <PageEmptyState
          className="min-h-70"
          icon={rows.length ? <SearchX /> : <ScrollText />}
          title={t(rows.length ? "noActivity" : "noActivityYet")}
          action={
            rows.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setWarnings(false);
                  setHost("all");
                  setLogin("all");
                  setService("all");
                  setForward("all");
                  setStatus("all");
                }}
              >
                {t("clearFilters")}
              </Button>
            )
          }
        />
      ) : (
        <ActivityList
          key={JSON.stringify([
            query,
            warnings,
            host,
            forward,
            status,
            grouping,
            login,
            service,
          ])}
          rows={records}
          grouping={grouping}
          showHost={!hostScoped}
          viewport={viewport}
        />
      )}
    </ScrollArea>
  );
}
