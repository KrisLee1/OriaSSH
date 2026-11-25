import { ChevronDownIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/tunnel-form";
import { Input } from "@/components/ui/input";
import { ParameterField, ParameterSwitch } from "@/components/parameter-field";
import { ConnectionIconPicker } from "../tunnels/connection-icon";
import { ConnectionFields } from "../tunnels/rule-editor";
import type { Host, LoginIdentity } from "@/types";
import { HostCredentialSelection } from "./host-credential-selection";
import { HostTags } from "./host-tags";
import { JumpRouteEditor } from "./jump-route-editor";

export function HostEditorFields({
  host,
  hosts,
  credentials,
  busy,
  change,
  manageCredentials,
}: {
  host: Host;
  hosts: Host[];
  credentials: LoginIdentity[];
  busy: boolean;
  change: (patch: Partial<Host>) => void;
  manageCredentials: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const sourceManaged = host.source === "config";
  const icon = host.appearance?.icon ?? null;
  const color = host.appearance?.color ?? null;

  return (
    <>
      <div className="host-profile">
        <ConnectionIconPicker
          value={icon}
          color={color}
          avatar={{
            onColorChange: (color) => change({ appearance: { icon, color } }),
          }}
          onChange={(icon) => change({ appearance: { icon, color } })}
        />
        <Field label={t("name")}>
          <Input
            required
            value={host.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </Field>
      </div>

      <fieldset className="host-editor-connection" disabled={sourceManaged}>
        <legend>{t("hostConnectionSection")}</legend>
        <div className="host-address-fields">
          <Field label={t("address")}>
            <Input
              required
              value={host.address}
              onChange={(event) => change({ address: event.target.value })}
            />
          </Field>
          <Field label={t("port")}>
            <Input
              type="number"
              min={1}
              max={65535}
              required
              value={host.port}
              onChange={(event) => change({ port: Number(event.target.value) })}
            />
          </Field>
        </div>
      </fieldset>

      <HostCredentialSelection
        host={host}
        credentials={credentials}
        busy={busy}
        change={change}
        manage={manageCredentials}
      />
      <HostTags
        hosts={hosts}
        value={host.tags}
        onChange={(tags) => change({ tags })}
      />

      <details
        className="editor-disclosure host-connection-advanced"
        onInvalidCapture={(event) => {
          event.currentTarget.open = true;
        }}
      >
        <summary>
          {t("advanced")}
          <ChevronDownIcon size={16} aria-hidden="true" />
        </summary>
        <fieldset className="host-advanced-content" disabled={sourceManaged}>
          <legend className="sr-only">{t("advanced")}</legend>
          <section className="host-advanced-group">
            <h3>{t("hostTimingSection")}</h3>
            <ConnectionFields
              value={host.connection}
              onChange={(connection) => change({ connection })}
            />
          </section>
          <section className="host-advanced-group">
            <h3>{t("hostRouteSection")}</h3>
            <JumpRouteEditor
              hosts={hosts}
              hostId={host.id}
              value={host.proxyJump}
              disabled={busy || sourceManaged}
              onChange={(proxyJump) => change({ proxyJump })}
            />
            <ParameterField
              label={t("identityAgentTitle")}
              parameter="-o IdentityAgent"
              description={t("identityAgentHint")}
            >
              <Input
                value={host.identityAgent ?? ""}
                placeholder={t("systemDefault")}
                onChange={(event) =>
                  change({ identityAgent: event.target.value || null })
                }
              />
            </ParameterField>
            <ParameterSwitch
              label={t("identitiesOnlyTitle")}
              parameter="-o IdentitiesOnly"
              description={t("identitiesOnlyHint")}
              checked={host.identitiesOnly}
              onCheckedChange={(identitiesOnly) => change({ identitiesOnly })}
            />
          </section>
        </fieldset>
      </details>
    </>
  );
}
