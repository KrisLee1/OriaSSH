import { formatUiError } from "@/lib/ui-message";
import { useRef, useState, type DragEvent } from "react";
import { UploadIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal, Field, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { useNativeFileDrop } from "@/hooks/use-native-file-drop";
import { ServiceReview } from "@/features/commands/service-review";
import { primaryLogin } from "@/features/hosts/login-identities";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import type { Host, ImportChoices, ImportPreview, ImportSource } from "@/types";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function ImportConfig({
  hosts,
  addedHostIds,
  busy,
  close,
  previewFile,
  cancelPreview,
  submit,
}: {
  hosts: Host[];
  addedHostIds?: string[];
  busy: boolean;
  close: () => void;
  previewFile: (source: ImportSource) => Promise<ImportPreview>;
  cancelPreview: () => Promise<void>;
  submit: (token: string, choices: ImportChoices) => Promise<boolean>;
}) {
  const { t } = useTranslation("tunnel");
  const dropRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || loading;
  const showError = (cause: unknown) => {
    const message = String(cause);
    setError(
      message.includes("preview_import_file")
        ? "importBackendUpdateRequired"
        : message,
    );
  };
  async function load(source: () => Promise<ImportSource>) {
    if (pending.current || busy) return;
    pending.current = true;
    setLoading(true);
    setDragging(false);
    setError(null);
    try {
      setPreview(await previewFile(await source()));
    } catch (cause) {
      showError(cause);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  function loadFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("importFileType");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("importFileSize");
      return;
    }
    void load(async () => ({
      kind: "upload",
      fileName: file.name,
      content: await file.text(),
    }));
  }
  function loadPaths(paths: string[]) {
    if (paths.length !== 1) {
      setError("importSingleFile");
      return;
    }
    if (!paths[0].toLowerCase().endsWith(".json")) {
      setError("importFileType");
      return;
    }
    void load(async () => ({ kind: "path", path: paths[0] }));
  }
  useNativeFileDrop(dropRef, !preview && !disabled, loadPaths, setDragging);
  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (disabled) return;
    if (event.dataTransfer.files.length !== 1) {
      setError("importSingleFile");
      return;
    }
    loadFile(event.dataTransfer.files[0]);
  }
  async function replaceFile() {
    if (disabled || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      await cancelPreview();
      setPreview(null);
    } catch (cause) {
      showError(cause);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  return (
    <Modal
      title={t("importConfig")}
      description={
        preview?.version === 3
          ? t("importWorkspaceHint")
          : preview?.services?.length
            ? t("sharing.previewHint", { ns: "commands" })
            : t(preview ? "importHint" : "importFileHint")
      }
      close={() => {
        if (!disabled) close();
      }}
    >
      {error && (
        <FieldError role="alert">
          {formatUiError(error, t, "commands")}
        </FieldError>
      )}
      {preview ? (
        <>
          <div className="import-file-heading">
            <span>{preview.fileName}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void replaceFile()}
            >
              {t("importReplaceFile")}
            </Button>
          </div>
          <ImportConfigReview
            key={preview.token}
            preview={preview}
            hosts={hosts}
            addedHostIds={addedHostIds}
            busy={disabled}
            close={close}
            submit={(choices) =>
              submit(preview.token, choices).catch((cause) => {
                showError(cause);
                return false;
              })
            }
          />
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("importChooseFile")}
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) loadFile(file);
            }}
          />
          <button
            ref={dropRef}
            data-native-file-drop
            type="button"
            disabled={disabled}
            aria-busy={loading}
            className={cn(
              "window-muted-surface flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/20 px-4 py-5 text-center text-sm outline-none transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              dragging && "border-primary bg-primary/5",
            )}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!disabled) setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = disabled ? "none" : "copy";
              if (!disabled) setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted/35 shadow-sm ring-1 ring-border-strong/20">
              <UploadIcon className="size-5" aria-hidden="true" />
            </span>
            <span className="font-medium">
              {t(loading ? "importReadingFile" : "importChooseFile")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("importDropFile")}
            </span>
          </button>
          <ModalActions>
            <Button variant="ghost" disabled={disabled} onClick={close}>
              {t("cancel")}
            </Button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}

export function ImportConfigReview({
  preview,
  hosts,
  addedHostIds,
  busy,
  close,
  submit,
}: {
  preview: ImportPreview;
  hosts: Host[];
  addedHostIds?: string[];
  busy: boolean;
  close: () => void;
  submit: (choices: ImportChoices) => Promise<boolean>;
}) {
  const { t } = useTranslation("tunnel");
  const workspace = preview.version === 3;
  const [selectedHosts, setSelectedHosts] = useState(
    preview.selectedHostIds ?? [],
  );
  const [selected, setSelected] = useState(
    preview.rules.filter((r) => !r.commandOmitted).map((r) => r.id),
  );
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [reuseHosts, setReuseHosts] = useState<Record<string, string>>({});
  const [reuseLogins, setReuseLogins] = useState<
    NonNullable<ImportChoices["reuseLogins"]>
  >({});
  const [forwardOnly, setForwardOnly] = useState(false);
  const selection = workspace
    ? importDependencies(
        preview,
        selectedHosts,
        selected,
        selectedServices,
        reuseHosts,
      )
    : undefined;
  const reused = (id: string) =>
    Object.hasOwn(reuseHosts, id) ? reuseHosts[id] : undefined;
  const availableHosts = hosts.filter(
    (host) =>
      !host.diagnostics.length &&
      (!workspace || (addedHostIds?.includes(host.id) ?? true)),
  );
  const requiredReuseLogins = Object.fromEntries(
    Array.from(selection?.bindings ?? [])
      .filter(([hostId]) => reused(hostId))
      .map(([hostId, ids]) => [
        hostId,
        Object.fromEntries(
          [...ids].map((id) => [id, reuseLogins[hostId]?.[id] || ""]),
        ),
      ]),
  );
  const missingMapping = Object.values(requiredReuseLogins).some((logins) =>
    Object.values(logins).includes(""),
  );
  const newHostCount = selection
    ? [...selection.hosts].filter((id) => !reused(id)).length
    : 0;
  const blocked =
    (selected.some(
      (id) => preview.rules.find((r) => r.id === id)?.commandOmitted,
    ) &&
      !forwardOnly) ||
    (workspace &&
      (missingMapping ||
        preview.hosts.some(
          (host) =>
            host.blocked && selection?.hosts.has(host.id) && !reused(host.id),
        )));
  return (
    <>
      <h3>
        {t("hosts")} · {preview.hosts.length}
      </h3>
      {preview.hosts.map((h) => {
        const needed = !selection || selection.hosts.has(h.id);
        const chosen = selectedHosts.includes(h.id);
        const local = availableHosts.find((host) => host.id === reused(h.id));
        const localLogins = local
          ? [
              ...(local.credentialOnly
                ? []
                : [
                    {
                      id: primaryLogin(local),
                      label: local.primaryLoginLabel,
                      user: local.user,
                    },
                  ]),
              ...(local.logins ?? []),
            ]
          : [];
        const loginOptions = localLogins.map(({ id, label, user }) => ({
          value: id,
          label: label ? `${label} · ${user}` : user,
        }));
        return (
          <div
            className={cn(
              "import-entry themed-surface",
              workspace && "workspace-import-entry",
            )}
            key={h.id}
          >
            {workspace ? (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={chosen}
                  disabled={busy}
                  onChange={(e) =>
                    setSelectedHosts((before) =>
                      e.target.checked
                        ? [...before, h.id]
                        : before.filter((id) => id !== h.id),
                    )
                  }
                />
                <strong>{h.name}</strong>
              </label>
            ) : (
              <strong>{h.name}</strong>
            )}
            <code className="wrap-anywhere">{h.endpoint}</code>
            {workspace && needed && !chosen && (
              <p className="muted">{t("configDependency")}</p>
            )}
            {h.conflict && <p className="muted">{t("importHostConflict")}</p>}
            {h.blocked && needed && (!workspace || !local) && (
              <p className="inline-error">{t("importHostBlocked")}</p>
            )}
            {h.keyPathsOmitted && needed && (!workspace || !local) && (
              <p className="inline-error">{t("importMissingKeys")}</p>
            )}
            {!!h.keyPaths.length && (
              <p className="muted">
                {t("identity")}: {h.keyPaths.join(", ")}
              </p>
            )}
            {h.proxyJump && (
              <p className="muted wrap-anywhere">
                ProxyJump:{" "}
                {workspace
                  ? h.proxyJump
                      .split(",")
                      .map(
                        (id) =>
                          preview.hosts.find((host) => host.id === id.trim())
                            ?.name || id.trim(),
                      )
                      .join(" → ")
                  : h.proxyJump}
              </p>
            )}
            {needed && (
              <Field label={t("importHostAction")}>
                <Select
                  items={[
                    { value: "", label: t("importAsCopy") },
                    ...availableHosts.map((old) => ({
                      value: old.id,
                      label: t("importReuse", {
                        name: `${old.name} · ${old.user}@${old.address}:${old.port}`,
                      }),
                    })),
                  ]}
                  value={reused(h.id) || ""}
                  disabled={busy}
                  onValueChange={(value) => {
                    setReuseLogins((previous) => ({ ...previous, [h.id]: {} }));
                    const next = { ...reuseHosts };
                    if (value) next[h.id] = value;
                    else delete next[h.id];
                    setReuseHosts(next);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="">{t("importAsCopy")}</SelectItem>
                    {availableHosts.map((old) => (
                      <SelectItem value={old.id} key={old.id}>
                        {t("importReuse", {
                          name: `${old.name} · ${old.user}@${old.address}:${old.port}`,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {workspace &&
              local &&
              needed &&
              Object.entries(requiredReuseLogins[h.id] ?? {}).map(
                ([sourceId, value]) => {
                  const source = h.logins?.find(
                    (login) => login.id === sourceId,
                  );
                  const sourceName = source?.label
                    ? `${source.label} · ${source.user}`
                    : (source?.user ?? sourceId);
                  const label = t("importMapLogin", { source: sourceName });
                  return (
                    <Field key={sourceId} label={label}>
                      <Select
                        items={loginOptions}
                        value={value || null}
                        disabled={busy}
                        onValueChange={(target) =>
                          setReuseLogins((previous) => ({
                            ...previous,
                            [h.id]: {
                              ...previous[h.id],
                              [sourceId]: target || "",
                            },
                          }))
                        }
                      >
                        <SelectTrigger
                          className="w-full min-w-0"
                          aria-label={label}
                        >
                          <SelectValue placeholder={t("importChooseLogin")} />
                        </SelectTrigger>
                        <SelectContent>
                          {loginOptions.map((login) => (
                            <SelectItem key={login.value} value={login.value}>
                              {login.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  );
                },
              )}
          </div>
        );
      })}
      <h3>
        {t("tunnels")} · {preview.rules.length}
      </h3>
      {preview.rules.map((r) => (
        <div
          className={cn(
            "import-entry themed-surface",
            workspace && "workspace-import-entry",
          )}
          key={r.id}
        >
          <label className="check-field">
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              disabled={busy}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, r.id]
                    : selected.filter((id) => id !== r.id),
                )
              }
            />
            {r.name}
          </label>
          <code>{r.path}</code>
          {r.conflict && <p className="muted">{t("importRuleConflict")}</p>}
          {r.listenerConflict && (
            <p className="inline-error">{t("importListenerConflict")}</p>
          )}
          {r.commandOmitted && (
            <p className="inline-error">{t("importCommandMissing")}</p>
          )}
        </div>
      ))}
      {!!preview.services?.length && (
        <>
          <h3>
            {t("sharing.services", { ns: "commands" })} ·{" "}
            {preview.services.length}
          </h3>
          <p className="inline-error">
            {t("sharing.importHint", { ns: "commands" })}
          </p>
          {preview.services.map((service) => {
            return (
              <section
                className={cn(
                  "import-entry themed-surface",
                  workspace && "workspace-import-entry",
                )}
                key={service.id}
              >
                <label className="check-field">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selectedServices.includes(service.id)}
                    onChange={(e) =>
                      setSelectedServices((ids) =>
                        e.target.checked
                          ? [...ids, service.id]
                          : ids.filter((id) => id !== service.id),
                      )
                    }
                  />
                  {service.name}
                </label>
                {service.conflict && (
                  <p className="muted">
                    {t("sharing.nameConflict", { ns: "commands" })}
                  </p>
                )}
                <p className="muted">
                  {t("sharing.linksHint", { ns: "commands" })}
                </p>
                <details>
                  <summary>{t("sharing.review", { ns: "commands" })}</summary>
                  <ServiceReview
                    service={service}
                    endpoint={t("boundTargetHint", { ns: "commands" })}
                  />
                </details>
              </section>
            );
          })}
        </>
      )}
      {preview.rules.some((r) => r.commandOmitted) && (
        <label className="check-field">
          <input
            type="checkbox"
            checked={forwardOnly}
            disabled={busy}
            onChange={(e) => setForwardOnly(e.target.checked)}
          />
          {t("importForwardOnly")}
        </label>
      )}
      <p className="muted">
        {preview.services?.length
          ? t("sharing.importStopped", { ns: "commands" })
          : t("importStopped")}
      </p>
      {workspace && missingMapping && (
        <p className="muted">{t("importChooseLogin")}</p>
      )}
      <ModalActions>
        <Button variant="ghost" disabled={busy} onClick={close}>
          {t("cancel")}
        </Button>
        <Button
          className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal wrap-anywhere"
          disabled={
            busy ||
            (!selected.length && !selectedServices.length && !newHostCount) ||
            blocked
          }
          onClick={() =>
            void submit({
              ruleIds: selected,
              serviceIds: selectedServices,
              ...(workspace
                ? { hostIds: selectedHosts, reuseLogins: requiredReuseLogins }
                : {}),
              reuseHosts: selection
                ? Object.fromEntries(
                    Object.entries(reuseHosts).filter(([id]) =>
                      selection.hosts.has(id),
                    ),
                  )
                : reuseHosts,
              forwardOnly,
            })
          }
        >
          {workspace
            ? t("importWorkspaceSelection", {
                hosts: newHostCount,
                services: selectedServices.length,
                forwards: selected.length,
              })
            : selectedServices.length
              ? t("sharing.importSelected", {
                  ns: "commands",
                  services: selectedServices.length,
                  forwards: selected.length,
                })
              : t("importSelected", { count: selected.length })}
        </Button>
      </ModalActions>
    </>
  );
}

export function importDependencies(
  preview: ImportPreview,
  hostIds: string[],
  ruleIds: string[],
  serviceIds: string[],
  reuseHosts: Record<string, string>,
) {
  const pending = [...hostIds];
  const bindings = new Map<string, Set<string>>();
  const addBinding = (hostId: string, loginId: string) => {
    const logins = bindings.get(hostId) ?? new Set<string>();
    logins.add(loginId);
    bindings.set(hostId, logins);
  };
  for (const rule of preview.rules) {
    if (!ruleIds.includes(rule.id)) continue;
    pending.push(rule.hostId);
  }
  for (const service of preview.services ?? []) {
    if (!serviceIds.includes(service.id)) continue;
    pending.push(...(service.hostIds ?? []));
    for (const [hostId, loginId] of Object.entries(service.loginByHost ?? {})) {
      addBinding(hostId, loginId);
    }
  }
  const sources = new Map(
    preview.hosts.map((host) => [host.id, host.proxyJump]),
  );
  const hosts = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (hosts.has(id)) continue;
    hosts.add(id);
    const jumps = sources.get(id);
    if (!Object.hasOwn(reuseHosts, id) && jumps) {
      pending.push(...jumps.split(",").map((id) => id.trim()));
    }
  }
  return { hosts, bindings };
}
