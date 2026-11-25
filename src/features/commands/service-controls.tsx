import { resolvedLogin } from "../hosts/login-identities";
import { serviceLoginId } from "./service-target";
import { formatUiError } from "@/lib/ui-message";
import { equalJsonValue } from "@/lib/json-equal";
import { useEffect, useId, useState, useRef, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { jumpHosts } from "@/features/tunnels/rule-model";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ParameterField, ParameterSwitch } from "@/components/parameter-field";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  RemoteService,
  ServiceControl,
  ServiceObservation,
  ServiceOperation,
  Snapshot,
} from "@/types";
import * as bridge from "@/lib/bridge";
export const defaultControl = (): ServiceControl => ({
  statusProbe: null,
  healthProbe: null,
  startActionId: null,
  checkAfterActions: false,
  ttlSecs: 60,
});
export const parseCodes = (text: string) =>
  text.trim() ? text.split(",").map((v) => (v.trim() ? Number(v) : NaN)) : [];
// Probe expiry is computed by Rust; this clock only asks for an in-memory snapshot.
export function useServiceObservations(visible: boolean) {
  const [observations, setObservations] = useState<ServiceObservation[]>([]);
  useEffect(() => {
    if (!bridge.desktop || !visible) return;
    let live = true,
      reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const data = await bridge.serviceObservations();
        if (live)
          setObservations((before) =>
            equalJsonValue(before, data) ? before : data,
          );
      } finally {
        reading = false;
      }
    };
    const off = listen<ServiceObservation[]>("service://observations", () => {
      void refresh().catch(() => {});
    });
    void off.then(() => refresh()).catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 1000);
    return () => {
      live = false;
      clearInterval(timer);
      void off.then((fn) => fn()).catch(() => {});
    };
  }, [visible]);
  return observations;
}
export function ServiceState({
  observation,
}: {
  observation?: ServiceObservation;
}) {
  const { t, i18n } = useTranslation("commands");
  const facts = (["status", "health"] as const).flatMap((kind) => {
    const fact = observation?.[kind];
    return fact && fact.value !== "unknown" && fact.value !== "unverified"
      ? [{ kind, fact }]
      : [];
  });
  if (!facts.length) return null;
  return (
    <dl className="service-facts">
      {facts.map(({ kind, fact }) => (
        <div key={kind}>
          <dt>{t(`service.${kind}`)}</dt>
          <dd
            title={
              fact.checkedAt === null
                ? undefined
                : `${t("service.checkedAt")} ${new Date(fact.checkedAt).toLocaleString(i18n.resolvedLanguage)}`
            }
          >
            {t(`service.value.${fact.value}`)}
            {fact.expired && ` · ${t("service.expired")}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ServiceOperations({
  service,
  data,
  ruleId,
  disabled,
  onOperation,
}: {
  service: RemoteService;
  data: Snapshot;
  ruleId?: string;
  disabled: boolean;
  onOperation: (operation: ServiceOperation, ruleId?: string) => void;
}) {
  const { t } = useTranslation("commands");
  const rules = data.rules.filter((r) => service.ruleIds.includes(r.id));
  const [chosen, setChosen] = useState(
    ruleId || (rules.length === 1 ? rules[0].id : ""),
  );
  const target = ruleId || chosen;
  const control = service.control;
  return (
    <div className="service-operations">
      <div className="inline-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !target || !control?.statusProbe}
          onClick={() => onOperation("checkStatus", target)}
        >
          {t("service.checkStatus")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !target || !control?.healthProbe}
          onClick={() => onOperation("checkHealth", target)}
        >
          {t("service.checkHealth")}
        </Button>
      </div>
      {!!rules.length && !target.startsWith("host:") && (
        <div className="service-connect-row">
          {!ruleId && (
            <Select
              value={target}
              items={rules.map((r) => ({ value: r.id, label: r.name }))}
              onValueChange={(v) => v && setChosen(v)}
            >
              <SelectTrigger aria-label={t("service.connectForward")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            size="sm"
            variant="primary-soft"
            disabled={disabled || !target || !control?.startActionId}
            onClick={() => onOperation("connect", target)}
          >
            {t("service.connect")}
          </Button>
        </div>
      )}
    </div>
  );
}
function CodesField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange: (codes: number[]) => void;
}) {
  const [text, setText] = useState(value.join(","));
  useEffect(() => {
    const parsed = parseCodes(text);
    if (
      parsed.length !== value.length ||
      parsed.some((n, i) => !Object.is(n, value[i]))
    )
      setText(value.join(","));
  }, [value, text]);
  return (
    <label className="field">
      <span>{label}</span>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseCodes(e.target.value));
        }}
      />
    </label>
  );
}
function ControlDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details
      className="editor-disclosure service-advanced-disclosure"
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary>
        {label}
        <ChevronDownIcon size={14} aria-hidden="true" />
      </summary>
      <div className="service-advanced-disclosure-body">{children}</div>
    </details>
  );
}
export function ControlEditor({
  service,
  onChange,
}: {
  service: RemoteService;
  onChange: (control: ServiceControl) => void;
}) {
  const { t } = useTranslation("commands"),
    id = useId();
  const c = service.control || defaultControl();
  const { statusProbe, healthProbe } = c;
  const status = service.actions.filter(
    (a) => a.kind === "status" && a.mode !== "terminal",
  );
  const starts = service.actions.filter(
    (a) => a.kind === "start" && a.mode !== "terminal" && a.timeoutSecs > 0,
  );
  const patch = (value: Partial<ServiceControl>) =>
    onChange({ ...c, ...value });
  const select = (
    name: string,
    value: string,
    items: { value: string; label: string }[],
    change: (value: string) => void,
  ) => (
    <div className="field service-advanced-select">
      <span>{name}</span>
      <Select
        items={items}
        value={value}
        onValueChange={(v) => v !== null && change(v)}
      >
        <SelectTrigger aria-label={name}>
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
    </div>
  );
  const number = (
    key: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
  ) => (
    <label className="field service-advanced-number">
      <span>{t(`service.${key}`)}</span>
      <Input
        type="number"
        min={min}
        max={max}
        required
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
  const codes = (
    key: string,
    value: number[],
    change: (codes: number[]) => void,
  ) => (
    <CodesField
      key={key}
      label={t(`service.${key}`)}
      value={value}
      onChange={change}
    />
  );
  return (
    <>
      <fieldset className="service-advanced-group">
        <legend>{t("service.status")}</legend>
        {select(
          t("service.statusAction"),
          statusProbe?.actionId || "none",
          [
            { value: "none", label: t("service.disabled") },
            ...status.map((a) => ({ value: a.id, label: a.label })),
          ],
          (actionId) =>
            patch({
              statusProbe:
                actionId === "none"
                  ? null
                  : {
                      actionId,
                      mode: "output",
                      runningCodes: [0],
                      stoppedCodes: [3],
                      failedCodes: [],
                    },
            }),
        )}
        {statusProbe && (
          <>
            {service.actions.find((a) => a.id === statusProbe.actionId)
              ?.confirm && (
              <p className="inline-error">{t("service.statusConfirmHint")}</p>
            )}
            <ControlDisclosure label={t("service.statusRules")}>
              {select(
                t("service.mapping"),
                statusProbe.mode,
                ["output", "exitCode", "json", "vncSessions"].map((value) => ({
                  value,
                  label: t(`service.mappingMode.${value}`),
                })),
                (mode) =>
                  patch({
                    statusProbe: {
                      ...statusProbe,
                      mode: mode as typeof statusProbe.mode,
                    },
                  }),
              )}
              {statusProbe.mode === "exitCode" && (
                <div className="service-advanced-options">
                  {codes(
                    "runningCodes",
                    statusProbe.runningCodes,
                    (runningCodes) =>
                      patch({ statusProbe: { ...statusProbe, runningCodes } }),
                  )}
                  {codes(
                    "stoppedCodes",
                    statusProbe.stoppedCodes,
                    (stoppedCodes) =>
                      patch({ statusProbe: { ...statusProbe, stoppedCodes } }),
                  )}
                  {codes(
                    "failedCodes",
                    statusProbe.failedCodes,
                    (failedCodes) =>
                      patch({ statusProbe: { ...statusProbe, failedCodes } }),
                  )}
                </div>
              )}
              {statusProbe.mode === "json" && (
                <p className="muted service-advanced-hint">
                  {t("service.jsonHint")}
                </p>
              )}
            </ControlDisclosure>
          </>
        )}
      </fieldset>

      <section
        className="service-advanced-group"
        aria-labelledby={`${id}-health-heading`}
      >
        <div className="service-switch-field service-advanced-switch">
          <h3 id={`${id}-health-heading`}>
            <label htmlFor={`${id}-health`}>{t("service.health")}</label>
          </h3>
          <Switch
            id={`${id}-health`}
            aria-label={t("service.healthEnabled")}
            checked={!!healthProbe}
            onCheckedChange={(enabled) =>
              patch({
                healthProbe: enabled
                  ? {
                      command: "",
                      readyCodes: [0],
                      notReadyCodes: [1],
                      repeatable: false,
                      timeoutSecs: 5,
                      intervalSecs: 2,
                      budgetSecs: 60,
                    }
                  : null,
              })
            }
          />
        </div>
        {healthProbe && (
          <>
            <ParameterField
              label={t("service.healthCommand")}
              description={t("service.remoteProbe")}
            >
              <textarea
                className="preset-textarea"
                rows={2}
                required
                maxLength={65536}
                value={healthProbe.command}
                onChange={(e) =>
                  patch({
                    healthProbe: { ...healthProbe, command: e.target.value },
                  })
                }
              />
            </ParameterField>
            <ControlDisclosure label={t("service.healthRules")}>
              <div className="service-advanced-options">
                {codes("readyCodes", healthProbe.readyCodes, (readyCodes) =>
                  patch({ healthProbe: { ...healthProbe, readyCodes } }),
                )}
                {codes(
                  "notReadyCodes",
                  healthProbe.notReadyCodes,
                  (notReadyCodes) =>
                    patch({ healthProbe: { ...healthProbe, notReadyCodes } }),
                )}
              </div>
              {number(
                "probeTimeout",
                healthProbe.timeoutSecs,
                1,
                30,
                (timeoutSecs) =>
                  patch({ healthProbe: { ...healthProbe, timeoutSecs } }),
              )}
              <ParameterSwitch
                label={t("service.repeatable")}
                description={t("service.repeatHint")}
                checked={healthProbe.repeatable}
                onCheckedChange={(repeatable) =>
                  patch({ healthProbe: { ...healthProbe, repeatable } })
                }
              />
              {number(
                "interval",
                healthProbe.intervalSecs,
                1,
                60,
                (intervalSecs) =>
                  patch({ healthProbe: { ...healthProbe, intervalSecs } }),
              )}
              {number("budget", healthProbe.budgetSecs, 1, 600, (budgetSecs) =>
                patch({ healthProbe: { ...healthProbe, budgetSecs } }),
              )}
            </ControlDisclosure>
          </>
        )}
      </section>

      <ControlDisclosure label={t("service.settings")}>
        {select(
          t("service.startAction"),
          c.startActionId || "none",
          [
            { value: "none", label: t("service.disabled") },
            ...starts.map((a) => ({ value: a.id, label: a.label })),
          ],
          (startActionId) =>
            patch({
              startActionId: startActionId === "none" ? null : startActionId,
            }),
        )}
        {c.startActionId && (
          <p className="muted service-advanced-hint">
            {t("service.connectHint")}
          </p>
        )}
        <ParameterSwitch
          label={t("service.checkAfter")}
          description={t("service.probeHint")}
          checked={c.checkAfterActions}
          onCheckedChange={(checkAfterActions) => patch({ checkAfterActions })}
        />
        {number("ttl", c.ttlSecs, 1, 3600, (ttlSecs) => patch({ ttlSecs }))}
      </ControlDisclosure>
    </>
  );
}

// A credential retry is safe only before any exec in this operation was submitted.
export function CredentialRetry({
  data,
  run,
  onRun,
  onError,
  autoPrompt = false,
  onPrompt,
}: {
  data: Snapshot;
  run: import("@/types").CommandRun;
  onRun: (run: import("@/types").CommandRun) => void;
  onError: (error: string) => void;
  autoPrompt?: boolean;
  onPrompt?: () => void;
}) {
  const { t } = useTranslation("commands");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const prompted = useRef(new Set<string>());
  const service = data.services?.find(
    (s) => s.id === run.serviceId && s.revision === run.serviceRevision,
  );
  const profile = data.hosts.find((host) => host.id === run.hostId);
  const loginId = serviceLoginId(service, profile, run.loginId);
  const host = resolvedLogin(profile, loginId);
  const hosts = host ? [...jumpHosts(data.hosts, host), host] : [];
  const canRetry =
    !!service &&
    service.executionEnabled !== false &&
    run.finishedAt !== null &&
    !run.submitted &&
    run.error === "authentication" &&
    hosts.some((host) => host.authMethod !== "agent") &&
    ((!run.workflowRuleId && !!service.hostIds?.includes(run.hostId)) ||
      data.rules.some(
        (r) =>
          r.id === run.workflowRuleId &&
          r.hostId === run.hostId &&
          service.ruleIds.includes(r.id),
      ));
  useEffect(() => {
    if (!autoPrompt || !canRetry || prompted.current.has(run.id)) return;
    prompted.current.add(run.id);
    onPrompt?.();
    requestId.current = crypto.randomUUID();
    setValues({});
    setRemember({});
    setOpen(true);
  }, [autoPrompt, canRetry, run.id, onPrompt]);
  if (!canRetry || !service) return null;
  const operation = run.actionId.startsWith("$connect:")
    ? "connect"
    : run.actionId === "$status"
      ? "checkStatus"
      : run.actionId === "$health"
        ? "checkHealth"
        : "action";
  const close = () => {
    setOpen(false);
    setValues({});
    setRemember({});
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          requestId.current = crypto.randomUUID();
          setOpen(true);
        }}
      >
        {t("retryAuth")}
      </Button>
      <AnimatePresence>
        {open && (
          <Modal
            key="credential-retry"
            title={t("retryAuth")}
            description={t("executeHint")}
            close={close}
          >
            <code>{run.endpoint}</code>
            <form
              id="service-retry-auth"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                void bridge
                  .runServiceOperation({
                    serviceId: service.id, loginId,
                    revision: service.revision,
                    requestId: requestId.current,
                    operation,
                    actionId: operation === "action" ? run.actionId : undefined,
                    ruleId: run.workflowRuleId || `host:${run.hostId}`,
                    confirmed: true,
                    secrets: values,
                    rememberHostIds: Object.keys(remember).filter(
                      (id) => remember[id],
                    ),
                  })
                  .then((next) => {
                    onRun(next);
                    close();
                  })
                  .catch((e) => onError(formatUiError(String(e), t)))
                  .finally(() => setBusy(false));
              }}
            >
              {hosts
                .filter((h) => h.authMethod !== "agent")
                .map((host) => (
                  <AuthenticationField
                    key={host.id}
                    host={host}
                    value={values[host.id] || ""}
                    onChange={(value) =>
                      setValues((v) => ({ ...v, [host.id]: value }))
                    }
                    remember={!!remember[host.id]}
                    onRemember={(value) =>
                      setRemember((v) => ({ ...v, [host.id]: value }))
                    }
                  />
                ))}
              <ModalActions>
                <Button
                  type="submit"
                  form="service-retry-auth"
                  disabled={busy}
                  variant="primary-soft"
                >
                  {t("execute")}
                </Button>
              </ModalActions>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
