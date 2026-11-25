import { useId, useMemo, useRef, useState } from "react";
import { BoxesIcon, CableIcon, SearchIcon, ServerIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { SearchPopoverContent } from "@/components/ui/search-popover";
import { Button } from "@/components/ui/button";
import { endpoint } from "./rule-model";
import { addedHosts } from "../hosts/host-collection";
import { serviceHostIds } from "../commands/service-target";
import type { Snapshot } from "@/types";

export type CanvasMatch = {
  hostId: string;
  serviceId?: string;
  ruleId?: string;
  label: string;
};
type SearchData = Pick<Snapshot, "hosts" | "addedHostIds" | "services" | "rules" | "runtimes">;

export function canvasRows(data: SearchData): CanvasMatch[] {
  const byHost = new Map<string, CanvasMatch[]>();
  for (const host of addedHosts(data)) {
    byHost.set(host.id, [{ hostId: host.id, label: `${host.name} · ${endpoint(host.address, host.port)}` }]);
  }
  const hostNames = new Map(data.hosts.map(host => [host.id, host.name]));
  for (const service of data.services ?? []) {
    for (const hostId of new Set(serviceHostIds(service, data))) {
      byHost.get(hostId)?.push({
        hostId,
        serviceId: service.id,
        label: [hostNames.get(hostId), service.name, service.port].filter(Boolean).join(" · "),
      });
    }
  }
  const listening = new Map(data.runtimes
    .filter(runtime => runtime.status === "listening")
    .map(runtime => [runtime.ruleId, runtime.boundPort]));
  for (const rule of data.rules) {
    byHost.get(rule.hostId)?.push({
      hostId: rule.hostId,
      ruleId: rule.id,
      label: [hostNames.get(rule.hostId), rule.name, rule.kind, rule.bindPort,
        listening.get(rule.id), rule.targetHost, rule.targetPort].filter(Boolean).join(" · "),
    });
  }
  return Array.from(byHost.values()).flat();
}

export function canvasMatches(rows: CanvasMatch[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  return term ? rows.filter(row => row.label.toLocaleLowerCase().includes(term)) : [];
}
export function CanvasFind({
  data,
  locate,
}: {
  data: Snapshot;
  locate: (match: CanvasMatch) => void;
}) {
  const { t } = useTranslation("tunnel");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hasQuery = !!query.trim();
  const { hosts, addedHostIds, services, rules, runtimes } = data;
  const entries = useMemo(
    () => open && hasQuery ? canvasRows({ hosts, addedHostIds, services, rules, runtimes }) : [],
    [open, hasQuery, hosts, addedHostIds, services, rules, runtimes],
  );
  const rows = useMemo(() => canvasMatches(entries, query), [entries, query]);
  const hasMatches = rows.length > 0;
  const active = Math.min(index, rows.length - 1);
  const choose = (row: CanvasMatch) => {
    locate({ ...row });
    setOpen(false);
  };
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setIndex(0);
        }
      }}
    >
      <PopoverTrigger
        render={<Button size="icon-sm" variant="ghost" title={t("canvasFind")} aria-label={t("canvasFind")} />}
      >
        <SearchIcon />
      </PopoverTrigger>
      <SearchPopoverContent
        align="start"
        initialFocus={input}
        className="canvas-find-panel"
        aria-label={t("canvasFind")}
        inputProps={{
          ref: input,
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": hasMatches,
          "aria-controls": hasMatches ? listId : undefined,
          "aria-activedescendant": hasMatches ? `${listId}-${active}` : undefined,
          "aria-label": t("canvasFind"),
          placeholder: t("canvasFind"),
          value: query,
          onChange: (e) => {
            setQuery(e.target.value);
            setIndex(0);
          },
          onKeyDown: (e) => {
            if (e.nativeEvent.isComposing || !hasMatches) return;
            if (e.key === "Enter") {
              e.preventDefault();
              choose(rows[active]);
              return;
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const next = (active + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
            setIndex(next);
            document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
          },
        }}
      >
        {hasMatches && (
          <ul role="listbox" id={listId} aria-label={t("canvasFind")}>
            {rows.map((row, i) => (
              <li
                key={JSON.stringify([row.hostId, row.serviceId, row.ruleId])}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active === i}
                title={row.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(row)}
              >
                {row.serviceId ? <BoxesIcon /> : row.ruleId ? <CableIcon /> : <ServerIcon />}
                <span>{row.label}</span>
              </li>
            ))}
          </ul>
        )}
        {open && hasQuery && !hasMatches && (
          <p className="muted" role="status">{t("noCanvasMatches")}</p>
        )}
      </SearchPopoverContent>
    </Popover>
  );
}
