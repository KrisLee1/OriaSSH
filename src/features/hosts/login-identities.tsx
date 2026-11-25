import type { Host, LoginIdentity } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const primaryLogin = (host: Host) => `primary:${host.id}`;
export const defaultLoginId = (host?: Host) =>
  host && (host.defaultLoginId ?? primaryLogin(host));
export const loginLabel = (login: LoginIdentity) =>
  [login.label, login.user].filter(Boolean).join(" · ");
export const primaryLoginLabel = (host: Host) =>
  [host.primaryLoginLabel, host.user].filter(Boolean).join(" · ");
export const credentialKey = (host: Host) =>
  JSON.stringify([host.id, host.activeLoginId || primaryLogin(host)]);
export function resolvedLogin(host?: Host, id?: string | null) {
  if (!host || !id || id === primaryLogin(host)) return host;
  const login = host.logins?.find((item) => item.id === id);
  return (
    login && {
      ...host,
      user: login.user,
      identityFiles: login.identityFiles,
      authMethod: login.authMethod,
      activeLoginId: id,
    }
  );
}

export function resolvedDefaultLogin(host?: Host) {
  return resolvedLogin(host, defaultLoginId(host));
}

export function LoginPicker({
  host,
  value,
  change,
  label,
  hostDefault,
}: {
  host: Host;
  value?: string | null;
  change: (id: string) => void;
  label: string;
  hostDefault?: { label: string; select: () => void };
}) {
  if (!host.logins?.length || (host.credentialOnly && host.logins.length === 1))
    return null;
  const defaultOption = "host-default";
  const items = [
    ...(hostDefault ? [{ value: defaultOption, label: hostDefault.label }] : []),
    ...(host.credentialOnly
      ? []
      : [{ value: primaryLogin(host), label: primaryLoginLabel(host) }]),
    ...host.logins.map((l) => ({
      value: l.id,
      label: loginLabel(l),
    })),
  ];
  return (
    <label className="field">
      {label}
      <Select
        items={items}
        value={
          value ||
          (hostDefault
            ? defaultOption
            : host.credentialOnly ? host.defaultLoginId : primaryLogin(host))
        }
        onValueChange={(id) => {
          if (id === defaultOption) hostDefault?.select();
          else if (id) change(id);
        }}
      >
        <SelectTrigger aria-label={label} className="w-full">
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
    </label>
  );
}
