import { useId, useLayoutEffect, useRef } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import type { Host, LoginIdentity } from "@/types";
import {
  loginLabel,
  primaryLogin,
  primaryLoginLabel,
} from "./login-identities";

export function HostCredentialSelection({
  host,
  credentials,
  busy,
  change,
  manage,
}: {
  host: Host;
  credentials: LoginIdentity[];
  busy: boolean;
  change: (patch: Partial<Host>) => void;
  manage: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const id = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAddAfterRemove = useRef(false);
  const linked = host.credentialIds ?? [];
  useLayoutEffect(() => {
    if (focusAddAfterRemove.current) {
      addButton.current?.focus();
      focusAddAfterRemove.current = false;
    }
  }, [linked.length]);
  const local = (host.logins ?? []).filter(
    (login) => !linked.includes(login.id),
  );
  const library = new Map(credentials.map((login) => [login.id, login]));
  const primary = primaryLogin(host);
  const selected =
    host.defaultLoginId ?? (host.credentialOnly ? null : primary);
  const rows = [
    ...(host.credentialOnly
      ? []
      : [
          {
            id: primary,
            label: t(
              host.source === "config"
                ? "sshConfigCredential"
                : "existingHostCredential",
              {
                user: primaryLoginLabel(host),
              },
            ),
            reusable: false,
          },
        ]),
    ...local.map((login) => ({
      id: login.id,
      label: loginLabel(login),
      reusable: false,
    })),
    ...linked.flatMap((id) => {
      const login = library.get(id);
      return login ? [{ id, label: loginLabel(login), reusable: true }] : [];
    }),
  ];
  const available = credentials.filter(
    (login) =>
      !linked.includes(login.id) && !local.some(({ id }) => id === login.id),
  );

  const remove = (id: string) => {
    focusAddAfterRemove.current = true;
    const remaining = linked.filter((linkedId) => linkedId !== id);
    change({
      credentialIds: remaining,
      logins: host.logins?.filter((login) => login.id !== id),
      defaultLoginId:
        selected === id
          ? host.credentialOnly
            ? (remaining[0] ?? null)
            : null
          : host.defaultLoginId,
    });
  };

  return (
    <section
      className="host-credential-selection"
      aria-labelledby={`${id}-label`}
    >
      <div className="host-credential-header">
        <h3 id={`${id}-label`}>{t("hostCredential")}</h3>
        <div className="host-credential-actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={manage}
          >
            {t("manageCredentials")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={addButton}
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                />
              }
            >
              <PlusIcon aria-hidden="true" />
              {t("newCredential")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="host-credential-menu">
              {available.length ? (
                available.map((login) => {
                  const label = loginLabel(login);
                  return (
                    <DropdownMenuItem
                      key={login.id}
                      label={label}
                      onClick={() =>
                        change({
                          credentialIds: [...linked, login.id],
                          defaultLoginId: selected
                            ? host.defaultLoginId
                            : login.id,
                        })
                      }
                    >
                      <span className="truncate" title={label}>
                        {label}
                      </span>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem disabled>
                  {t("noAddableCredentials")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {rows.length ? (
        <ItemGroup
          className="host-credential-list"
          aria-labelledby={`${id}-label`}
        >
          {rows.map((row) => {
            const isDefault = selected === row.id;
            const showDefaultAction =
              rows.length > 1 && (row.reusable || !host.credentialOnly);
            return (
              <Item
                key={row.id}
                role="listitem"
                size="xs"
                className="host-credential-row"
              >
                <ItemContent>
                  <ItemTitle title={row.label}>{row.label}</ItemTitle>
                </ItemContent>
                <ItemActions className="host-credential-row-actions">
                  {showDefaultAction && (
                    <Button
                      type="button"
                      size="xs"
                      variant={isDefault ? "primary-soft" : "ghost"}
                      className="host-credential-default-action"
                      disabled={busy}
                      aria-pressed={isDefault}
                      aria-label={t("setDefaultCredentialNamed", {
                        name: row.label,
                      })}
                      onClick={() => {
                        if (!isDefault)
                          change({
                            defaultLoginId: row.id === primary ? null : row.id,
                          });
                      }}
                    >
                      <span
                        aria-hidden="true"
                        data-hidden={isDefault || undefined}
                      >
                        {t("setDefaultCredential")}
                      </span>
                      <span
                        aria-hidden="true"
                        data-hidden={!isDefault || undefined}
                      >
                        <CheckIcon />
                        {t("defaultCredentialMark")}
                      </span>
                    </Button>
                  )}
                  {row.reusable && (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="host-credential-remove-action"
                      disabled={busy}
                      aria-label={t("unlinkCredentialNamed", {
                        name: row.label,
                      })}
                      title={t("unlinkCredentialNamed", { name: row.label })}
                      onClick={() => remove(row.id)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      ) : (
        <p className="host-credential-empty">{t("noHostCredentials")}</p>
      )}
    </section>
  );
}
