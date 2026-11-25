import { hostAuthLabels } from "@/features/hosts/host-auth";
import { formatNativeMessage } from "@/lib/native-message";
import { useTranslation } from "react-i18next";
import type { Host, Rule, Runtime } from "@/types";
import { EndpointRoute } from "./endpoint-card";
import { displayedRoute } from "./rule-model";
import { bytes, duration, rate } from "./runtime-format";
import { runtimeStatus } from "./runtime-status";

export function RuntimeDetails({
  rule,
  runtime,
  hostName,
  savedLogin,
}: {
  rule: Rule;
  runtime?: Runtime;
  hostName: string;
  savedLogin?: Pick<Host, "user" | "authMethod">;
}) {
  const { t, i18n } = useTranslation("tunnel");
  const status = runtimeStatus(runtime);
  const listening = runtime?.status === "listening";
  const route = displayedRoute(rule, runtime);
  const activeHost = runtime?.desiredRunning ? runtime.hostSnapshot : undefined;
  const user = activeHost?.user || savedLogin?.user || runtime?.hostSnapshot?.user;
  const auth = runtime?.authMethodUsed ?? activeHost?.authMethod ?? savedLogin?.authMethod;
  const health = runtime?.targetHealth;
  const healthState = health?.state;
  const measured = healthState === "reachable" || healthState === "unreachable";
  const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString(i18n.resolvedLanguage);
  const evidence = measured && health?.checkedAt
    ? `${t(health.side === "local" ? "local" : "remoteSide")} · ${time(health.checkedAt)}`
    : undefined;
  const message = runtime?.message && (
    runtime.errorKind || ["failed", "needs-attention", "reconnecting"].includes(runtime.status)
  ) ? formatNativeMessage(runtime.message) : undefined;

  const traffic = (total: number, perSecond?: number) =>
    listening && perSecond !== undefined ? `${bytes(total)} · ${rate(perSecond)}` : bytes(total);
  const metrics = [
    { label: "sessionTime", value: duration(runtime?.uptimeSecs, [
      t("unitDays"), t("unitHours"), t("unitMinutes"), t("unitSeconds"),
    ]) },
    { label: "connections", value: runtime?.connections ?? "—" },
    { label: "sent", value: runtime ? traffic(runtime.sent, runtime.sentPerSecond) : "—" },
    { label: "received", value: runtime ? traffic(runtime.received, runtime.receivedPerSecond) : "—" },
  ];

  const history = runtime?.history ?? [];
  const hasSamples = history.length > 1;
  const hasTraffic = history.some(
    (sample) => sample.sentPerSecond > 0 || sample.receivedPerSecond > 0,
  );
  const max = Math.max(1, ...history.flatMap((p) => [p.sentPerSecond, p.receivedPerSecond]));
  const points = (field: "sentPerSecond" | "receivedPerSecond") =>
    history.map((p, i) => `${(i * 300) / (history.length - 1)},${70 - (p[field] / max) * 65}`).join(" ");

  return (
    <div className="runtime-details">
      <div className="runtime-overview">
        <span>{t(`type${route.kind}`)}</span>
        <span className={`status tone-${status.tone}`}>
          <i aria-hidden="true" />{t(status.label)}
        </span>
      </div>
      <EndpointRoute route={route} hostName={activeHost?.name || hostName} />
      {message && message !== t(status.label) && (
        <p className={status.tone === "danger" ? "inline-error" : "muted"}>{message}</p>
      )}
      {runtime?.configurationChanged && (
        <section className="runtime-next-route">
          <p className="muted">{t("serviceReconnect")}</p>
          {runtime.desiredRunning && <>
            <h3>{t("nextStart")}</h3>
            <EndpointRoute route={rule} hostName={hostName} />
            {savedLogin?.user && savedLogin.user !== user && (
              <p className="muted">{t("user")} · {savedLogin.user}</p>
            )}
          </>}
        </section>
      )}
      <section className="runtime-section">
        <h3>{t("connectionInfo")}</h3>
        <dl className="runtime-grid">
          <div><dt>{t("user")}</dt><dd>{user || "—"}</dd></div>
          <div>
            <dt>{t(runtime?.authMethodUsed ? "authMethod" : "configuredAuthMethod")}</dt>
            <dd>{auth ? t(hostAuthLabels[auth]) : "—"}</dd>
          </div>
          <div><dt>{t("targetHealth")}</dt><dd>{t(measured ? healthState : "unknown")}</dd></div>
        </dl>
      </section>
      <section className="runtime-section runtime-metrics">
        <h3>{t("forwardMetrics")}</h3>
        <dl className="runtime-grid">
          {metrics.map(({ label, value }) => (
            <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </section>
      <section className="runtime-section runtime-traffic">
        <div className="runtime-traffic-heading">
          <h3>{t("trafficWindow")}</h3>
          {!hasSamples && <small>{t("unmeasured")}</small>}
          {hasSamples && !hasTraffic && <small>{t("noRecentTraffic")}</small>}
        </div>
        {hasSamples ? (
          <svg
            className="traffic-chart"
            viewBox="0 0 300 75"
            role="img"
            aria-label={t("trafficWindow")}
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke="var(--oria-color-accent)"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              points={points("sentPerSecond")}
            >
              <title>{t("sent")}</title>
            </polyline>
            <polyline
              fill="none"
              stroke="var(--oria-color-muted-fg)"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              points={points("receivedPerSecond")}
            >
              <title>{t("received")}</title>
            </polyline>
          </svg>
        ) : <div className="traffic-chart" aria-hidden="true" />}
      </section>
      <details className="runtime-diagnostics">
        <summary>{t("forwardDiagnostics")}</summary>
        <dl className="runtime-grid">
          <div><dt>{t("desiredState")}</dt><dd>{t(runtime?.desiredRunning ? "active" : "stopped")}</dd></div>
          {runtime && <div><dt>{t("retryCount")}</dt><dd>{runtime.retryCount}</dd></div>}
          {runtime?.retryAt && <div><dt>{t("nextRetry")}</dt><dd>{time(runtime.retryAt)}</dd></div>}
          {evidence && <div><dt>{t("evidence")}</dt><dd>{evidence}</dd></div>}
          {runtime?.runId && <div><dt>{t("runId")}</dt><dd><code>{runtime.runId}</code></dd></div>}
        </dl>
        {measured && <p className="muted">{t(route.kind === "D" ? "socksHealthHint" : "targetHealthHint")}</p>}
      </details>
    </div>
  );
}
