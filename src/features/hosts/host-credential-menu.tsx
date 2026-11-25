import { KeyRoundIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Host } from "@/types";
import { loginLabel, primaryLogin, primaryLoginLabel } from "./login-identities";

export function HostCredentialMenu({ host, disabled, onSelect }: {
  host: Host;
  disabled: boolean;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation("tunnel");
  const primary = primaryLogin(host);
  const choices = (host.logins ?? [])
    .filter(({ id }) => !host.credentialOnly || host.credentialIds?.includes(id))
    .map((login) => ({ id: login.id, label: loginLabel(login) }));
  if (!host.credentialOnly) {
    choices.unshift({
      id: primary,
      label: t(host.source === "config" ? "sshConfigCredential" : "existingHostCredential", {
        user: primaryLoginLabel(host),
      }),
    });
  }
  if (choices.length < 2) return null;
  const selected = host.defaultLoginId ?? (host.credentialOnly ? "" : primary);
  const title = t("hostCredential");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost"
        disabled={disabled} aria-label={title} title={title} />}>
        <KeyRoundIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="host-credential-menu">
        <DropdownMenuRadioGroup aria-label={title} value={selected} onValueChange={(value) => {
          if (value !== selected) onSelect(value === primary ? null : value);
        }}>
          {choices.map(({ id, label }) => (
            <DropdownMenuRadioItem key={id} value={id} closeOnClick>
              <span className="truncate" title={label}>{label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
