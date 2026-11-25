import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ServiceReview } from "@/features/commands/service-review";
import * as bridge from "@/lib/bridge";
import { formatUiError } from "@/lib/ui-message";
import type {
  ConfigExportMode,
  ConfigExportPreview,
  ConfigExportSelection,
  RemoteService,
  Snapshot,
} from "@/types";

type SelectionKey = "hostIds" | "ruleIds" | "serviceIds";

export function ConfigExportDialog({
  data,
  mode,
  close,
}: {
  data: Snapshot;
  mode: ConfigExportMode;
  close: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const hosts = data.hosts.filter(
    ({ id }) => data.addedHostIds?.includes(id) ?? true,
  );
  const services = data.services ?? [];
  const [selection, setSelection] = useState<ConfigExportSelection>(() => ({
    hostIds: mode === "migration" ? hosts.map(({ id }) => id) : [],
    serviceIds: mode === "migration" ? services.map(({ id }) => id) : [],
    ruleIds: mode === "migration" ? data.rules.map(({ id }) => id) : [],
    includeServiceCommands: false,
  }));
  const [preview, setPreview] = useState<ConfigExportPreview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const focusHeading = useRef<HTMLHeadingElement>(null);
  const isEmpty = !(
    selection.hostIds.length ||
    selection.ruleIds.length ||
    selection.serviceIds.length
  );
  const containsCommands = services.some(
    (service) =>
      selection.serviceIds.includes(service.id) &&
      (service.actions.length > 0 || service.control?.healthProbe),
  );

  useLayoutEffect(() => {
    if (preview) focusHeading.current?.focus();
  }, [preview]);

  function choose(field: SelectionKey, id: string, checked: boolean) {
    setError("");
    setSelection((before) => ({
      ...before,
      [field]: checked
        ? [...before[field], id]
        : before[field].filter((value) => value !== id),
      includeServiceCommands:
        field !== "serviceIds" && before.includeServiceCommands,
    }));
  }

  async function proceed() {
    if (
      pending.current ||
      isEmpty ||
      (containsCommands && !selection.includeServiceCommands)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!preview) {
        setPreview(await bridge.previewConfigExport(selection));
      } else {
        const path = await bridge.exportWorkspaceConfig(
          selection,
          preview.fingerprint,
        );
        if (path) {
          toast.add({
            title: t("exported"),
            description: path,
            type: "success",
          });
          close();
        }
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(mode === "migration" ? "exportWorkspace" : "exportSelected")}
      close={() => {
        if (!pending.current) close();
      }}
      className="max-w-2xl sm:max-w-2xl"
    >
      {preview ? (
        <section className="grid min-w-0 gap-3">
          <h3 ref={focusHeading} tabIndex={-1}>
            {t("exportReview")}
          </h3>
          <div className="config-export-summary">
            <span>
              {t("exportCount", {
                label: t("hosts"),
                count: preview.hosts.length,
              })}
            </span>
            <span>
              {t("exportCount", {
                label: t("tunnels"),
                count: preview.ruleCount,
              })}
            </span>
            <span>
              {t("exportCount", {
                label: t("services", { ns: "commands" }),
                count: preview.serviceCount,
              })}
            </span>
            <span>
              {t("exportCount", {
                label: t("settingsCredentials"),
                count: preview.logins.length,
              })}
            </span>
          </div>
          {!!preview.hosts.length && (
            <ul className="grid min-w-0 gap-2">
              {preview.hosts.map((host) => (
                <li
                  key={host.id}
                  className="settings-section-panel themed-surface grid min-w-0 gap-1 rounded-lg px-3 py-2.5 wrap-anywhere"
                >
                  <strong>{host.name}</strong>
                  {host.dependency && (
                    <span className="muted"> · {t("configDependency")}</span>
                  )}
                  <code className="block wrap-anywhere">{host.endpoint}</code>
                </li>
              ))}
            </ul>
          )}
          {!!preview.logins.length && (
            <details className="settings-section-panel themed-surface rounded-lg px-3 py-2.5 text-sm">
              <summary>{t("settingsCredentials")}</summary>
              <ul className="mt-2 grid gap-1">
                {preview.logins.map((login) => (
                  <li className="wrap-anywhere" key={login.id}>
                    {login.label
                      ? `${login.label} · ${login.user}`
                      : login.user}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted">{t("exportPortableHint")}</p>
          {containsCommands && (
            <p className="muted">{t("exportScriptsHint")}</p>
          )}
        </section>
      ) : (
        <>
          <p className="muted">{t("exportScopeHint")}</p>
          {isEmpty &&
            !hosts.length &&
            !data.rules.length &&
            !services.length && <p>{t("exportNothing")}</p>}
          {containsCommands && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={selection.includeServiceCommands}
                disabled={busy}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelection((before) => ({
                    ...before,
                    includeServiceCommands: checked,
                  }));
                }}
              />
              <span>{t("exportScriptsHint")}</span>
            </label>
          )}
          <SelectionGroup title={t("hosts")}>
            {hosts.map((host) => (
              <label
                key={host.id}
                className="check-field min-w-0 wrap-anywhere"
              >
                <input
                  type="checkbox"
                  checked={selection.hostIds.includes(host.id)}
                  disabled={busy}
                  onChange={(e) => choose("hostIds", host.id, e.target.checked)}
                />
                <span>{host.name}</span>
              </label>
            ))}
          </SelectionGroup>
          <SelectionGroup title={t("services", { ns: "commands" })}>
            {services.map((service) => (
              <div key={service.id} className="grid min-w-0 gap-1">
                <label className="check-field min-w-0 wrap-anywhere">
                  <input
                    type="checkbox"
                    checked={selection.serviceIds.includes(service.id)}
                    disabled={busy}
                    onChange={(e) =>
                      choose("serviceIds", service.id, e.target.checked)
                    }
                  />
                  <span>{service.name}</span>
                </label>
                {selection.serviceIds.includes(service.id) &&
                  (service.actions.length > 0 ||
                    service.control?.healthProbe) && (
                    <ExportServiceReview service={service} />
                  )}
              </div>
            ))}
          </SelectionGroup>
          <SelectionGroup title={t("tunnels")}>
            {data.rules.map((rule) => (
              <label
                key={rule.id}
                className="check-field min-w-0 wrap-anywhere"
              >
                <input
                  type="checkbox"
                  checked={selection.ruleIds.includes(rule.id)}
                  disabled={busy}
                  onChange={(e) => choose("ruleIds", rule.id, e.target.checked)}
                />
                <span>{rule.name}</span>
              </label>
            ))}
          </SelectionGroup>
        </>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {formatUiError(error, t)}
        </p>
      )}
      <ModalActions>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={
            preview
              ? () => {
                  setPreview(undefined);
                  setError("");
                }
              : close
          }
        >
          {t(preview ? "exportAdjust" : "cancel")}
        </Button>
        <Button
          type="button"
          variant="primary-soft"
          disabled={
            busy ||
            isEmpty ||
            (containsCommands && !selection.includeServiceCommands)
          }
          onClick={() => void proceed()}
        >
          {t(preview ? "chooseExportFile" : "exportReview")}
        </Button>
      </ModalActions>
    </Modal>
  );
}

function ExportServiceReview({ service }: { service: RemoteService }) {
  const { t } = useTranslation("commands");
  const [open, setOpen] = useState(false);
  return (
    <details
      className="ms-6 min-w-0 text-sm"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t("sharing.review", { ns: "commands" })}</summary>
      {open && (
        <ServiceReview
          service={service}
          endpoint={t("boundTargetHint", { ns: "commands" })}
        />
      )}
    </details>
  );
}

function SelectionGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode[];
}) {
  if (!children.length) return null;
  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="settings-section-panel themed-surface grid min-w-0 gap-2 rounded-lg px-3 py-2.5">
        {children}
      </div>
    </fieldset>
  );
}
