import { defaultLoginId } from "../hosts/login-identities";
import { formatNativeMessage } from "@/lib/native-message";
import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ChevronDownIcon, ServerPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Field, ModalActions } from "@/components/tunnel-form";
import type {
  ConnectionOptions,
  Host,
  Rule,
  RemoteService,
  ServiceLink,
} from "@/types";
import {
  defaultConnection,
  networkChanged,
} from "./rule-model";
import { ServicePicker } from "@/features/commands/service-picker";
import { ServiceProtocolPicker } from "./service-protocol";
import { ConnectionIconPicker } from "./connection-icon";
import { HostPicker } from "@/features/hosts/host-picker";
import { ParameterField, ParameterSwitch } from "@/components/parameter-field";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

export function ConnectionFields({
  value,
  onChange,
}: {
  value: ConnectionOptions;
  onChange: (v: ConnectionOptions) => void;
}) {
  const { t } = useTranslation("tunnel");
  return (
    <div className="parameter-fields connection-fields">
      {(
        [
          [
            "connectTimeoutSecs",
            "connectTimeoutTitle",
            "-o ConnectTimeout",
            "connectTimeoutHint",
            1,
            600,
          ],
          [
            "keepaliveIntervalSecs",
            "keepaliveIntervalTitle",
            "-o ServerAliveInterval",
            "keepaliveIntervalHint",
            0,
            3600,
          ],
          [
            "keepaliveMax",
            "keepaliveMax",
            "-o ServerAliveCountMax",
            "keepaliveMaxHint",
            1,
            100,
          ],
        ] as const
      ).map(([key, label, parameter, description, min, max]) => (
        <ParameterField
          label={t(label)}
          parameter={parameter}
          description={t(description)}
          key={key}
          layout="inline"
          unit={t(key === "keepaliveMax" ? "unitAttempts" : "unitSeconds")}
        >
          <Input
            type="number"
            required
            min={min}
            max={max}
            value={value[key]}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
        </ParameterField>
      ))}
    </div>
  );
}

export function RuleEditor({
  draft,
  portFocus,
  hosts,
  services = [],
  selectedServiceIds,
  onServicesChange,
  busy,
  reconnect,
  activeRule,
  savedRule,
  onChange,
  onAddHost,
  onSave,
  onCancel,
}: {
  draft: Rule;
  portFocus?: RefObject<"bind" | "target" | null>;
  hosts: Host[];
  services?: RemoteService[];
  selectedServiceIds?: string[];
  onServicesChange?: (ids: string[]) => void;
  busy: boolean;
  reconnect: boolean;
  activeRule?: Rule;
  savedRule?: Rule;
  onChange: (r: Rule) => void;
  onAddHost: () => void;
  onSave: (start: boolean, serviceLinks?: ServiceLink[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const selected = hosts.find((h) => h.id === draft.hostId);
  const formId = useId();
  const [automatic, setAutomatic] = useState(draft.bindPort === 0);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!portFocus?.current) return;
    const frame = requestAnimationFrame(() => {
      const control = form.current?.querySelector<HTMLElement>(
        `[data-port-field="${portFocus.current}"]`,
      );
      control?.focus();
      portFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [portFocus]);
  const lastFixedPort = useRef(draft.bindPort);
  const auto = draft.kind !== "R" && automatic;
  const dynamic = draft.kind === "D";
  const remote = draft.kind === "R";
  const existingServices = services.filter((service) => !!draft.id && service.ruleIds.includes(draft.id));
  const [localServiceIds, setLocalServiceIds] = useState(() => existingServices.map((service) => service.id));
  const serviceIds = selectedServiceIds ?? localServiceIds;
  const availableServices = services.filter((service) =>
    service.hostIds?.includes(draft.hostId) ??
    (savedRule?.hostId === draft.hostId && service.ruleIds.includes(draft.id)),
  );
  const boundService = !dynamic && savedRule?.kind === draft.kind
    ? existingServices.find((service) => availableServices.includes(service))
    : undefined;
  const linkedPort = boundService?.port;
  const effectiveRule = {
    ...draft,
    loginIdentityId: defaultLoginId(selected),
    ...(linkedPort && (remote ? { bindPort: linkedPort } : { targetPort: linkedPort })),
  };
  const needsRestart =
    reconnect || (!!activeRule && networkChanged(activeRule, effectiveRule));
  const save = (launch: boolean) => {
    const kept = dynamic
      ? availableServices.filter((service) => serviceIds.includes(service.id))
      : boundService ? [boundService] : [];
    const links = new Set([...existingServices, ...kept]);
    onSave(launch, [...links].map((service) => ({
      id: service.id,
      revision: service.revision,
      selected: kept.includes(service),
    })));
  };
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(draft.bindAddress);
  const canSave = !busy && selected && !selected.diagnostics.length &&
    (!dynamic || ["127.0.0.1", "::1"].includes(draft.bindAddress));
  const change = (r: Partial<Rule>) => onChange({ ...draft, ...r });
  const types = (["L", "R", "D"] as const).map(value => ({ value, label: t(`type${value}`) }));
  const portHint = [t(`dns${draft.kind}`), dynamic ? t("socksHint") : remote && loopback ? t("remoteLoopbackHint") : ""]
    .filter(Boolean).join(" ");
  const listenPortLabel = t(remote ? "remoteBindPort" : "bindPort");

  return (
    <form id={formId} ref={form} className="forward-editor-form"
      onSubmit={(event) => { event.preventDefault(); if (canSave) save(false); }}>
      <div className="forward-editor-profile" data-avatar={draft.kind !== "L" || undefined}>
        {draft.kind !== "L" && <ConnectionIconPicker
          fieldLabel={t("connectionIcon")}
          value={draft.icon}
          color={draft.color}
          avatar={{
            fallbackIcon: { kind: "builtin", value: remote ? "network" : "globe" },
            colorLabel: t("connectionColor"),
            resetLabel: t("defaultServiceIcon", { ns: "commands" }),
            onColorChange: (color) => change({ color }),
          }}
          onChange={(icon) => change({ icon })}
        />}
        <div className="forward-editor-basics">
          <Field label={t("name")}>
            <Input required value={draft.name}
              onChange={(event) => change({ name: event.target.value })} />
          </Field>
          <div className="field">
            <span>{t("forwardType")}</span>
            <Select items={types} value={draft.kind}
              onValueChange={(kind) => {
                if (!kind || kind === draft.kind) return;
                change({
                  kind,
                  bindAddress: "127.0.0.1",
                  bindPort: kind !== "R" && automatic ? 0 : draft.bindPort,
                });
              }}>
              <SelectTrigger aria-label={t("forwardType")} title={t(`type${draft.kind}`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {types.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <fieldset className="forward-editor-group">
        <legend>{t("hostConnectionSection")}</legend>
        <div className="forward-editor-host">
          <HostPicker hosts={hosts} value={draft.hostId}
            onChange={(hostId) => change({ hostId })}
            actions={<Button type="button" variant="ghost" size="xs" onClick={onAddHost}>
              <ServerPlusIcon aria-hidden="true" />{t("addHost")}
            </Button>}
          />
        </div>
        {!hosts.length && <p className="muted">{t("noHostsBody")}</p>}
        {selected?.diagnostics.map((diagnostic, index) => (
          <p key={index} className="inline-error">{formatNativeMessage(diagnostic)}</p>
        ))}
      </fieldset>

      <fieldset className="forward-editor-group">
        <legend><span className="forward-editor-legend">
          {t("path")}<InfoTooltip label={t("path")} description={portHint} />
        </span></legend>
        <div className="forward-editor-endpoints">
          <section className="forward-editor-endpoint" aria-labelledby={`${formId}-listener`}>
            <h3 id={`${formId}-listener`}>{t("forwardListener")}</h3>
            <div className="forward-editor-address">
              <Field label={t(remote ? "remoteBindAddress" : "bindAddress")}>
                <Input required value={draft.bindAddress}
                  onChange={(event) => change({ bindAddress: event.target.value })} />
              </Field>
              <div className="field">
                <span>{listenPortLabel}</span>
                <div className="forward-editor-port">
                  <Input data-port-field="bind" aria-label={listenPortLabel}
                    type="number" min={1} max={65535} required={!auto}
                    placeholder={auto ? t("autoPortAssigned") : undefined}
                    title={remote && linkedPort ? t("servicePortLinked") : undefined}
                    value={auto ? "" : effectiveRule.bindPort || ""}
                    readOnly={remote && !!linkedPort}
                    onChange={(event) => {
                      if (!remote) setAutomatic(false);
                      change({ bindPort: Number(event.target.value) });
                    }}
                  />
                  {!remote && (
                    <Toggle type="button" pressed={auto}
                      onPressedChange={(pressed) => {
                        if (pressed) lastFixedPort.current = draft.bindPort;
                        setAutomatic(pressed);
                        change({ bindPort: pressed ? 0 : lastFixedPort.current });
                      }}>
                      {t("autoPort")}
                    </Toggle>
                  )}
                </div>
              </div>
            </div>
            {(!loopback || (dynamic && draft.bindAddress === "localhost")) && (
              <p className="inline-error">{t(remote ? "remoteExposure" : dynamic ? "socksLoopback" : "localExposure")}</p>
            )}
          </section>

          {!dynamic && <section className="forward-editor-endpoint" aria-labelledby={`${formId}-target`}>
            <h3 id={`${formId}-target`}>{t("forwardTarget")}</h3>
            <div className="forward-editor-address">
              <Field label={t(remote ? "localTargetHost" : "targetHost")}>
                <Input required value={draft.targetHost}
                  onChange={(event) => change({ targetHost: event.target.value })} />
              </Field>
              <Field label={t("targetPort")}>
                <Input data-port-field="target" type="number" min={1} max={65535} required
                  title={!remote && linkedPort ? t("servicePortLinked") : undefined}
                  value={effectiveRule.targetPort || ""}
                  readOnly={!remote && !!linkedPort}
                  onChange={(event) => change({ targetPort: Number(event.target.value) })}
                />
              </Field>
            </div>
          </section>}
        </div>
      </fieldset>
      {dynamic ? (
        <ServicePicker services={availableServices} value={serviceIds}
          onChange={onServicesChange ?? setLocalServiceIds} disabled={busy} />
      ) : (
        <ServiceProtocolPicker value={draft.serviceProtocol} disabled={false}
          onChange={(serviceProtocol) => change({ serviceProtocol })} />
      )}
      <details className="editor-disclosure" onInvalidCapture={event => { event.currentTarget.open = true; }}>
        <summary>{t("advanced")}<ChevronDownIcon size={16} aria-hidden="true" /></summary>
        <div className="forward-editor-advanced">
          <fieldset className="forward-advanced-group">
            <legend>{t("remoteCommand")}</legend>
            <ParameterSwitch
              label={t("noRemoteCommand")}
              parameter="-N"
              description={t("noRemoteCommandHint")}
              checked={draft.noRemoteCommand}
              onCheckedChange={(checked) =>
                change({
                  noRemoteCommand: checked,
                  remoteCommand: checked ? "" : draft.remoteCommand,
                })
              }
            />
            {!draft.noRemoteCommand && (
              <>
                <ParameterField
                  label={t("remoteCommand")}
                  parameter="-o RemoteCommand"
                  description={t("commandHint")}
                >
                  <Input
                    required
                    autoComplete="off"
                    value={draft.remoteCommand}
                    onChange={(e) => change({ remoteCommand: e.target.value })}
                  />
                </ParameterField>
              </>
            )}
          </fieldset>
          <fieldset className="forward-advanced-group">
            <legend>{t("forwardRecovery")}</legend>
            <ParameterSwitch
              label={t("autoConnect")}
              description={t("autoConnectHint")}
              checked={draft.autoConnect}
              onCheckedChange={(checked) => change({ autoConnect: checked })}
            />
            <ParameterSwitch
              label={t("autoReconnect")}
              description={t("reconnectPolicyHint")}
              checked={draft.reconnect.enabled}
              onCheckedChange={(checked) =>
                change({
                  reconnect: { ...draft.reconnect, enabled: checked },
                })
              }
            />
            {!draft.noRemoteCommand && draft.reconnect.enabled && (
              <>
                <ParameterSwitch
                  label={t("repeatCommandOnReconnect")}
                  description={t("repeatCommandHint")}
                  checked={draft.repeatCommandOnReconnect}
                  onCheckedChange={(checked) =>
                    change({ repeatCommandOnReconnect: checked })
                  }
                />
              </>
            )}
            {draft.reconnect.enabled && (
              <div className="parameter-fields">
                <ParameterField
                  label={t("maxAttempts")}
                  description={t("maxAttemptsHint")}
                  layout="inline"
                  unit={t("unitAttempts")}
                >
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={draft.reconnect.maxAttempts}
                    onChange={(e) =>
                      change({
                        reconnect: {
                          ...draft.reconnect,
                          maxAttempts: Number(e.target.value),
                        },
                      })
                    }
                  />
                </ParameterField>
                <ParameterField
                  label={t("initialDelayTitle")}
                  description={t("initialDelayHint")}
                  layout="inline"
                  unit={t("unitSeconds")}
                >
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    required
                    value={draft.reconnect.initialDelaySecs}
                    onChange={(e) =>
                      change({
                        reconnect: {
                          ...draft.reconnect,
                          initialDelaySecs: Number(e.target.value),
                        },
                      })
                    }
                  />
                </ParameterField>
                <ParameterField
                  label={t("maxDelayTitle")}
                  description={t("maxDelayHint")}
                  layout="inline"
                  unit={t("unitSeconds")}
                >
                  <Input
                    type="number"
                    min={draft.reconnect.initialDelaySecs}
                    max={3600}
                    required
                    value={draft.reconnect.maxDelaySecs}
                    onChange={(e) =>
                      change({
                        reconnect: {
                          ...draft.reconnect,
                          maxDelaySecs: Number(e.target.value),
                        },
                      })
                    }
                  />
                </ParameterField>
              </div>
            )}
          </fieldset>
          <fieldset className="forward-advanced-group">
            <legend>{t("hostTimingSection")}</legend>
            <ParameterSwitch
              label={t("overrideConnection")}
              description={t("overrideConnectionHint")}
              checked={!!draft.connection}
              onCheckedChange={(checked) =>
                change({
                  connection: checked
                    ? { ...(selected?.connection || defaultConnection()) }
                    : null,
                })
              }
            />
            {draft.connection ? (
              <ConnectionFields
                value={draft.connection}
                onChange={(connection) => change({ connection })}
              />
            ) : null}
          </fieldset>
        </div>
      </details>
      {needsRestart && <p className="inline-error">{t("restartHint")}</p>}
      <ModalActions>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("cancel")}</Button>
        {(!activeRule || needsRestart) && (
          <Button type="button" variant="primary-soft" disabled={!canSave}
            onClick={() => { if (form.current?.reportValidity()) save(true); }}>
            {t(needsRestart ? "saveReconnect" : "saveStart")}
          </Button>
        )}
        <Button type="submit" form={formId} disabled={!canSave}>
          {t(needsRestart ? "saveNextStart" : "save")}
        </Button>
      </ModalActions>
    </form>
  );
}
