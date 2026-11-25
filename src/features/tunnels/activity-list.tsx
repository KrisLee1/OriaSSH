import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ActivityGrouping, ActivityRow } from "./activity-model";
import {
  ACTIVITY_PAGE_SIZE,
  activityItems,
  activityOffsets,
  activityRange,
} from "./activity-window";

export function ActivityList({
  rows,
  grouping,
  showHost = false,
  viewport,
}: {
  rows: ActivityRow[];
  grouping: ActivityGrouping;
  showHost?: boolean;
  viewport: HTMLDivElement | null;
}) {
  const { t, i18n } = useTranslation("tunnel");
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [view, setView] = useState({ top: 0, height: 800 });
  const items = useMemo(
    () => activityItems(rows, grouping, closed),
    [rows, grouping, closed],
  );
  const loaded = useMemo(() => items.slice(0, limit), [items, limit]);
  const offsets = useMemo(() => activityOffsets(loaded), [loaded]);
  const range = activityRange(offsets, view.top, view.height);
  const hasMore = loaded.length < items.length;
  const showMore = () =>
    setLimit((current) => Math.min(current + ACTIVITY_PAGE_SIZE, items.length));
  useLayoutEffect(() => {
    if (viewport) viewport.scrollTop = 0;
  }, [viewport]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!viewport || !list) return;
    const update = () => {
      const top =
        viewport.getBoundingClientRect().top - list.getBoundingClientRect().top;
      setView((previous) =>
        previous.top === top && previous.height === viewport.clientHeight
          ? previous
          : { top, height: viewport.clientHeight },
      );
      if (
        hasMore &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          viewport.clientHeight * 2
      )
        showMore();
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [viewport, offsets, hasMore, items.length]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!viewport || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      },
      { root: viewport, rootMargin: `0px 0px ${view.height * 2}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewport, hasMore, loaded.length, items.length, view.height]);
  const hostName = (row: ActivityRow) =>
    row.host?.name || row.hostId || t("unknownLogHost");
  function forwardLabel(row: ActivityRow) {
    if (row.hostTest) return t("testConnection");
    return row.rule?.name || row.record.ruleId;
  }
  function renderEntry(row: ActivityRow) {
    const { record, rule, services, status } = row;
    const serviceNames = services.map(({ name }) => name);
    const title =
      serviceNames.join(" · ") ||
      forwardLabel(row) ||
      t("services", { ns: "commands" });
    const forward =
      services.length && rule?.name && !serviceNames.includes(rule.name)
        ? rule.name
        : undefined;
    const context = [
      forward,
      showHost ? hostName(row) : undefined,
      record.username,
    ]
      .filter(Boolean)
      .join(" · ");
    const time = new Date(record.timestamp);
    const runLabel = record.runId
      .slice(record.runId.lastIndexOf(":") + 1)
      .slice(0, 8);
    const statusLabel = t(status.label);
    const eventLabel = t(record.event);

    return (
      <article className="activity-virtual-entry themed-surface">
        <div className="activity-entry-heading">
          <strong className="activity-entry-title" title={title}>
            {title}
          </strong>
          <time dateTime={time.toISOString()}>
            {time.toLocaleString(i18n.resolvedLanguage)}
          </time>
        </div>
        <div className="activity-entry-meta">
          <div className="activity-entry-event">
            <span className={`status tone-${status.tone}`}>
              <i aria-hidden="true" />
              <span
                className="activity-entry-status"
                title={
                  statusLabel === eventLabel
                    ? statusLabel
                    : `${statusLabel} · ${eventLabel}`
                }
              >
                {statusLabel}
              </span>
            </span>
            {context && (
              <span className="activity-entry-context" title={context}>
                {context}
              </span>
            )}
          </div>
          <div className="activity-entry-run">
            {record.retryCount > 0 && (
              <span>
                {t("retryCount")} {record.retryCount}
              </span>
            )}
            {runLabel && (
              <span title={`${t("runId")} ${record.runId}`}>{runLabel}</span>
            )}
          </div>
        </div>
      </article>
    );
  }
  return (
    <>
      <div
        ref={listRef}
        className="activity-virtual-list"
        role="list"
        aria-label={t("activity")}
      >
        <div style={{ height: range.before }} aria-hidden="true" />
        {loaded.slice(range.start, range.end).map((item) => (
          <div
            key={item.key}
            style={{ height: item.height }}
            className="activity-virtual-row"
            role="listitem"
          >
            {item.kind === "group" ? (
              <button
                type="button"
                className="activity-group-toggle"
                aria-expanded={!closed.has(item.groupId)}
                onClick={() =>
                  setClosed((current) => {
                    const next = new Set(current);
                    if (next.has(item.groupId)) next.delete(item.groupId);
                    else next.add(item.groupId);
                    return next;
                  })
                }
              >
                <ChevronRightIcon
                  size={14}
                  className={closed.has(item.groupId) ? "" : "rotate-90"}
                />
                <span>
                  {grouping === "forward"
                    ? forwardLabel(item.row) || t("noLogForward")
                    : t(item.groupId)}
                </span>
                <small>{item.count}</small>
              </button>
            ) : (
              renderEntry(item.row)
            )}
          </div>
        ))}
        <div style={{ height: range.after }} aria-hidden="true" />
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="activity-load-more">
          <Button size="sm" variant="ghost" onClick={showMore}>
            {t("loadMoreLogs")}
          </Button>
        </div>
      )}
    </>
  );
}
