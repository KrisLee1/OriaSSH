import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalActions,
  ModalTitleActions,
} from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { PageEmptyState } from "@/components/page-empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNativeMessage } from "@/lib/native-message";
import * as bridge from "@/lib/bridge";
import type { Host, LoginIdentity, Snapshot } from "@/types";
import { hostAuthLabels } from "./host-auth";
import { IdentityFilesEditor } from "./identity-files-editor";
import { loginLabel, primaryLogin } from "./login-identities";

type Editor = {
  login: LoginIdentity;
  hostId?: string;
  primary?: boolean;
  creating?: boolean;
};
type CredentialManagerActivity = "idle" | "editing" | "saving";
const newCredential = (): LoginIdentity => ({
  id: crypto.randomUUID(),
  label: "",
  user: "",
  authMethod: "auto",
  identityFiles: [],
});

function CredentialRow({
  id,
  login,
  hostNames,
  hostScoped = false,
  disabled,
  onEdit,
  onDelete,
}: {
  id: string;
  login: LoginIdentity;
  hostNames: string[];
  hostScoped?: boolean;
  disabled: boolean;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const name = login.label || login.user;
  const hostText = hostNames.join(", ");
  const hostLabel = t("credentialLinkedHosts", { hosts: hostText });
  return (
    <Item role="listitem" size="sm" className="credential-row">
      <ItemMedia
        variant="icon"
        className="credential-row-icon"
        data-host-scoped={hostScoped || undefined}
        aria-hidden="true"
      >
        {hostScoped ? <ServerIcon /> : <KeyRoundIcon />}
      </ItemMedia>
      <ItemContent className="credential-row-content">
        <ItemTitle className="credential-row-title" title={name}>
          {name}
        </ItemTitle>
        <ItemDescription className="credential-row-meta">
          {login.label && (
            <>
              <code className="credential-row-user" title={login.user}>
                {login.user}
              </code>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="credential-row-auth">
            {t(hostAuthLabels[login.authMethod])}
          </span>
          {hostText && (
            <>
              <span aria-hidden="true">·</span>
              <span className="credential-row-hosts" title={hostLabel}>
                <span className="sr-only">{hostLabel}</span>
                <span aria-hidden="true">{hostText}</span>
              </span>
            </>
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="credential-row-actions">
        <Button
          id={`${id}-edit`}
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("editCredentialNamed", { name: loginLabel(login) })}
          title={t("editCredential")}
          disabled={disabled}
          onClick={onEdit}
        >
          <PencilIcon aria-hidden="true" />
        </Button>
        {onDelete && (
          <Button
            id={`${id}-delete`}
            type="button"
            size="icon-sm"
            variant="ghost"
            className="credential-row-delete"
            aria-label={t("deleteCredentialNamed", { name: loginLabel(login) })}
            title={t("deleteCredential")}
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

export function CredentialManager({
  data,
  close,
  disabled = false,
  onSnapshot,
  onActivityChange,
}: {
  data: Snapshot;
  close?: () => void;
  disabled?: boolean;
  onSnapshot: (snapshot: Snapshot) => void;
  onActivityChange?: (activity: CredentialManagerActivity) => void;
}) {
  const { t } = useTranslation("tunnel");
  const id = useId();
  const [editor, setEditor] = useState<Editor>();
  const [deleting, setDeleting] = useState<LoginIdentity>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<bridge.PasswordStatus>();
  const [clearPassword, setClearPassword] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const aliasInput = useRef<HTMLInputElement>(null);
  const deleteCancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<string | null>(null);
  const editorId = editor?.login.id;
  const deletingId = deleting?.id;
  const activity = busy
    ? "saving"
    : editorId || deletingId
      ? "editing"
      : "idle";
  useLayoutEffect(() => {
    onActivityChange?.(activity);
  }, [activity, onActivityChange]);
  useLayoutEffect(() => {
    if (editorId) {
      aliasInput.current?.focus();
    } else if (deletingId) {
      deleteCancel.current?.focus();
    } else if (returnFocus.current) {
      (
        document.getElementById(returnFocus.current) ?? addButton.current
      )?.focus();
      returnFocus.current = null;
    }
  }, [editorId, deletingId]);
  const credentials = data.loginCredentials ?? [];
  const legacyHostId = editor?.hostId;
  const legacyLoginId = legacyHostId ? editor?.login.id : undefined;
  const hosts = data.hosts.filter(
    (host) => !data.addedHostIds || data.addedHostIds.includes(host.id),
  );
  const hostName = hosts.find((host) => host.id === editor?.hostId)?.name;
  const legacy = hosts.flatMap((host) => [
    ...(!host.credentialOnly && host.source === "manual"
      ? [
          {
            hostId: host.id,
            primary: true,
            login: {
              id: primaryLogin(host),
              label: host.primaryLoginLabel,
              user: host.user,
              authMethod: host.authMethod,
              identityFiles: host.identityFiles,
            },
          },
        ]
      : []),
    ...(host.logins ?? [])
      .filter((login) => !host.credentialIds?.includes(login.id))
      .map((login) => ({ hostId: host.id, primary: false, login })),
  ]);
  const original = legacyHostId
    ? legacy.find(
        ({ hostId, login }) =>
          hostId === legacyHostId && login.id === legacyLoginId,
      )?.login
    : credentials.find(({ id }) => id === editorId);
  const statusId = original && (legacyHostId ?? original.id);
  const passwordEligible =
    editor?.login.authMethod === "auto" ||
    editor?.login.authMethod === "password";
  const currentPasswordStatus =
    passwordStatus?.id === statusId &&
    editor?.login.user.trim() === original?.user &&
    editor?.login.authMethod === original?.authMethod
      ? passwordStatus
      : undefined;
  const savedPassword = currentPasswordStatus?.saved;
  const canClearPassword = savedPassword || currentPasswordStatus?.error;
  useEffect(() => {
    if (!statusId || !data.passwordStorageSupported) return;
    let live = true;
    const status = legacyHostId
      ? bridge
          .passwordStatus([statusId], legacyLoginId)
          .then(([status]) => status)
      : bridge.loginCredentialPasswordStatus(statusId);
    void status.then(
      (status) => {
        if (live) setPasswordStatus(status);
      },
      (error) => {
        if (live) setError(formatNativeMessage(String(error)));
      },
    );
    return () => {
      live = false;
    };
  }, [statusId, legacyHostId, legacyLoginId, data.passwordStorageSupported]);
  const reset = () => {
    setEditor(undefined);
    setDeleting(undefined);
    setError("");
    setPasswordStatus(undefined);
    setClearPassword(false);
  };
  const openEditor = (entry: Editor, actionId: string) => {
    returnFocus.current = actionId;
    setEditor(entry);
  };
  const commit = async (save: () => Promise<Snapshot>) => {
    setBusy(true);
    setError("");
    try {
      const snapshot = await save();
      onSnapshot(snapshot);
      reset();
    } catch (error) {
      setError(formatNativeMessage(String(error)));
    } finally {
      setBusy(false);
    }
  };
  const save = (entry: Editor, password?: string) => {
    const login = {
      ...entry.login,
      label: entry.login.label?.trim(),
      user: entry.login.user.trim(),
      identityFiles: entry.login.identityFiles.filter((path) => path.trim()),
    };
    const clear = Boolean(clearPassword && canClearPassword);
    if (!entry.hostId)
      return commit(() => bridge.saveLoginCredential(login, password, clear));
    const host = hosts.find(({ id }) => id === entry.hostId);
    if (
      !host ||
      (!entry.primary && !host.logins?.some(({ id }) => id === login.id))
    ) {
      setError(t("credentialUnavailable"));
      return;
    }
    const updated = entry.primary
      ? {
          ...host,
          primaryLoginLabel: login.label,
          user: login.user,
          authMethod: login.authMethod,
          identityFiles: login.identityFiles,
        }
      : {
          ...host,
          logins: host.logins?.map((item) =>
            item.id === login.id ? login : item,
          ),
        };
    const passwordEdit =
      password || clear
        ? { loginId: login.id, password, clearPassword: clear }
        : undefined;
    return commit(() =>
      updated.source === "config"
        ? bridge.saveHostMetadata(updated, passwordEdit)
        : bridge.saveHost(updated, passwordEdit),
    );
  };
  const update = (patch: Partial<LoginIdentity>) => {
    if (patch.user !== undefined || patch.authMethod !== undefined)
      setClearPassword(false);
    if (editor) setEditor({ ...editor, login: { ...editor.login, ...patch } });
  };
  const authItems = Object.entries(hostAuthLabels).map(([value, key]) => ({
    value,
    label: t(key),
  }));
  const addingInModal = !close && !!editor?.creating;
  const title = t(
    editor
      ? editor.hostId || original
        ? "editCredential"
        : "newCredential"
      : deleting
        ? "deleteCredential"
        : "credentialManager",
  );

  const Actions = close || addingInModal ? ModalActions : CredentialPageActions;
  const showingList = (!editor && !deleting) || addingInModal;
  const addAction = showingList && (
    <Button
      id={`${id}-add`}
      ref={addButton}
      type="button"
      size="sm"
      disabled={disabled}
      onClick={() =>
        openEditor({ login: newCredential(), creating: true }, `${id}-add`)
      }
    >
      <PlusIcon aria-hidden="true" />
      {t("newCredential")}
    </Button>
  );
  const list = (
    <>
      {!credentials.length && !legacy.length ? (
        <PageEmptyState
          compact
          className="credential-manager-empty"
          icon={<KeyRoundIcon />}
          title={t("noReusableCredentials")}
          description={t("noCredentials")}
        />
      ) : (
        <>
          <section
            className="credential-group"
            aria-labelledby={`${id}-reusable`}
          >
            <h3 id={`${id}-reusable`}>{t("reusableCredentials")}</h3>
            {credentials.length ? (
              <ItemGroup
                className="credential-list"
                aria-labelledby={`${id}-reusable`}
              >
                {credentials.map((login) => {
                  const linkedHosts = hosts.filter((host) =>
                    host.credentialIds?.includes(login.id),
                  );
                  const actionId = `${id}-reusable-${login.id}`;
                  return (
                    <CredentialRow
                      id={actionId}
                      key={login.id}
                      login={login}
                      hostNames={linkedHosts.map((host) => host.name)}
                      disabled={disabled}
                      onEdit={() => openEditor({ login }, `${actionId}-edit`)}
                      onDelete={
                        linkedHosts.length
                          ? undefined
                          : () => {
                              returnFocus.current = `${actionId}-delete`;
                              setDeleting(login);
                            }
                      }
                    />
                  );
                })}
              </ItemGroup>
            ) : (
              <p className="credential-group-empty">
                {t("noReusableCredentials")}
              </p>
            )}
          </section>
          {legacy.length > 0 && (
            <section
              className="credential-group"
              aria-labelledby={`${id}-host-specific`}
            >
              <h3 id={`${id}-host-specific`}>{t("existingHostCredentials")}</h3>
              <ItemGroup
                className="credential-list"
                aria-labelledby={`${id}-host-specific`}
              >
                {legacy.map((entry) => {
                  const actionId = `${id}-${encodeURIComponent(entry.hostId)}-${entry.login.id}`;
                  const name = hosts.find(
                    (host) => host.id === entry.hostId,
                  )?.name;
                  return (
                    <CredentialRow
                      id={actionId}
                      key={actionId}
                      login={entry.login}
                      hostNames={name ? [name] : []}
                      hostScoped
                      disabled={disabled}
                      onEdit={() => openEditor(entry, `${actionId}-edit`)}
                    />
                  );
                })}
              </ItemGroup>
            </section>
          )}
        </>
      )}
    </>
  );
  const body = (
    <>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {editor ? (
        <form
          aria-labelledby={`${id}-title`}
          id={`${id}-form`}
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !disabled) {
              const password = new FormData(event.currentTarget).get(
                "password",
              );
              void save(
                editor,
                typeof password === "string" && password ? password : undefined,
              );
            }
          }}
        >
          <fieldset className="credential-editor-fields" disabled={busy}>
            {hostName && (
              <div className="credential-editor-host">
                <ServerIcon aria-hidden="true" />
                <span>{t("credentialLinkedHosts", { hosts: hostName })}</span>
              </div>
            )}
            <div className="form-grid credential-identity-fields">
              <div className="field">
                <label htmlFor={`${id}-alias`}>{t("credentialAlias")}</label>
                <Input
                  id={`${id}-alias`}
                  ref={aliasInput}
                  maxLength={256}
                  value={editor.login.label ?? ""}
                  onChange={(event) => update({ label: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-user`}>{t("user")}</label>
                <Input
                  id={`${id}-user`}
                  required
                  pattern=".*\S.*"
                  maxLength={256}
                  autoCapitalize="none"
                  spellCheck={false}
                  value={editor.login.user}
                  onChange={(event) => update({ user: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label id={`${id}-auth`}>{t("authMethod")}</label>
              <Select
                items={authItems}
                value={editor.login.authMethod}
                disabled={busy}
                onValueChange={(value) => {
                  if (value)
                    update({ authMethod: value as Host["authMethod"] });
                }}
              >
                <SelectTrigger
                  aria-labelledby={`${id}-auth`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {authItems.map(({ value, label }) => (
                    <SelectItem
                      key={value}
                      value={value}
                      disabled={value === "agent" && !data.agentSupported}
                    >
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {passwordEligible && (
              <div className="field">
                <label htmlFor={`${id}-password`}>
                  {t("credentialPassword")}
                </label>
                <PasswordInput
                  key={editor.login.authMethod}
                  id={`${id}-password`}
                  name="password"
                  maxLength={65536}
                  disabled={clearPassword || !data.passwordStorageSupported}
                  aria-describedby={`${id}-password-hint`}
                  placeholder={
                    savedPassword ? t("savedPasswordPlaceholder") : undefined
                  }
                />
                <p className="muted" id={`${id}-password-hint`}>
                  {t(
                    !data.passwordStorageSupported
                      ? "credentialPasswordUnsupported"
                      : currentPasswordStatus?.error
                        ? "passwordStorageNeedsAttention"
                        : savedPassword
                          ? "credentialPasswordKeep"
                          : "credentialPasswordHint",
                  )}
                </p>
                {canClearPassword && (
                  <div className="host-credential-option">
                    <Checkbox
                      id={`${id}-clear-password`}
                      checked={clearPassword}
                      disabled={busy}
                      onCheckedChange={setClearPassword}
                    />
                    <label htmlFor={`${id}-clear-password`}>
                      {t("clearSavedPassword")}
                    </label>
                  </div>
                )}
              </div>
            )}
            {(editor.login.authMethod === "privateKey" ||
              editor.login.authMethod === "auto") && (
              <IdentityFilesEditor
                value={editor.login.identityFiles}
                disabled={busy}
                pickFile={bridge.desktop ? bridge.pickIdentityFile : undefined}
                onChange={(identityFiles) => update({ identityFiles })}
              />
            )}
          </fieldset>
          <Actions>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={reset}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              form={`${id}-form`}
              disabled={busy || disabled}
            >
              {t("save")}
            </Button>
          </Actions>
        </form>
      ) : deleting ? (
        <>
          <p>{t("deleteCredentialConfirm", { name: loginLabel(deleting) })}</p>
          <Actions>
            <Button
              type="button"
              variant="ghost"
              ref={deleteCancel}
              disabled={busy}
              onClick={reset}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || disabled}
              onClick={() =>
                void commit(() => bridge.deleteLoginCredential(deleting.id))
              }
            >
              {t("delete")}
            </Button>
          </Actions>
        </>
      ) : (
        list
      )}
    </>
  );

  if (close) {
    return (
      <Modal
        title={<span id={`${id}-title`}>{title}</span>}
        className="credential-manager-modal max-w-[560px] sm:max-w-[560px]"
        initialFocus={addButton}
        disablePointerDismissal={!!editor}
        close={() => {
          if (!busy) close();
        }}
      >
        <ModalTitleActions>{addAction}</ModalTitleActions>
        {body}
      </Modal>
    );
  }

  return (
    <div className="credential-manager-page">
      <div className="credential-manager-page-header">
        <div>
          <h3 id={addingInModal ? undefined : `${id}-title`}>
            {showingList ? t("credentialManager") : title}
          </h3>
          {showingList && <p>{t("settingsCredentialHint")}</p>}
        </div>
        {addAction}
      </div>
      {addingInModal ? list : body}
      {addingInModal && (
        <Modal
          title={<span id={`${id}-title`}>{title}</span>}
          className="credential-manager-modal max-w-[560px] sm:max-w-[560px]"
          initialFocus={aliasInput}
          disablePointerDismissal
          close={() => {
            if (!busy) reset();
          }}
        >
          {body}
        </Modal>
      )}
    </div>
  );
}

function CredentialPageActions({ children }: { children: ReactNode }) {
  return <div className="credential-manager-page-actions">{children}</div>;
}
