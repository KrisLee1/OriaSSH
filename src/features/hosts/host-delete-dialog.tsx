import { useId, useRef } from "react";
import { PackageIcon, ServerIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { Button } from "@/components/ui/button";
import { ConnectionIcon } from "@/features/tunnels/connection-icon";
import { endpoint } from "@/features/tunnels/rule-model";
import type { Host, HostDeletionImpact } from "@/types";

export function HostDeleteDialog({
  host,
  impact,
  busy,
  canConfirm,
  error,
  close,
  confirm,
}: {
  host: Host;
  impact: HostDeletionImpact;
  busy: boolean;
  canConfirm: boolean;
  error: string;
  close: () => void;
  confirm: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { rules, services, active } = impact;
  const serviceGroups = [
    {
      key: "deleteHostServices",
      items: services.filter((service) => service.remove),
    },
    {
      key: "detachHostServices",
      items: services.filter((service) => !service.remove),
    },
  ];

  return (
    <Modal
      title={t("deleteHostHeading")}
      description={
        <span className="host-delete-summary">
          <span
            className="host-delete-icon"
            style={{ color: host.appearance?.color ?? undefined }}
          >
            {host.appearance?.icon ? (
              <ConnectionIcon
                icon={host.appearance.icon}
                color={host.appearance.color}
              />
            ) : (
              <ServerIcon size={20} aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0">
            <strong className="host-delete-name">{host.name}</strong>
            <code>{endpoint(host.address, host.port)}</code>
          </span>
        </span>
      }
      close={close}
      initialFocus={cancel}
      animateBody={false}
      className="host-delete-modal max-w-[420px] sm:max-w-[420px]"
    >
      {active && (
        <div className="host-delete-warning" role="status">
          <TriangleAlertIcon size={16} aria-hidden="true" />
          <p>{t("stopHostWorkHint")}</p>
        </div>
      )}
      {rules.length > 0 && (
        <section className="host-delete-rules" aria-labelledby={id}>
          <p id={id}>{t("deleteHostCascadeHint", { count: rules.length })}</p>
          <ul role="list">
            {rules.map((rule) => (
              <li key={rule.id}>
                <ConnectionIcon icon={rule.icon} color={rule.color} />
                <span className="host-delete-rule-name">{rule.name}</span>
                <span className="host-delete-rule-kind">
                  {t(`type${rule.kind}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {serviceGroups.map(
        ({ key, items }) =>
          items.length > 0 && (
            <section
              key={key}
              className="host-delete-rules host-delete-service-list"
              aria-labelledby={`${id}-${key}`}
            >
              <p id={`${id}-${key}`}>{t(key)}</p>
              <ul role="list">
                {items.map((service) => (
                  <li key={service.id}>
                    <PackageIcon size={15} aria-hidden="true" />
                    <span className="host-delete-rule-name">
                      {service.name}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <ModalActions>
        <Button
          type="button"
          variant="ghost"
          ref={cancel}
          disabled={busy}
          onClick={close}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={busy || !canConfirm}
          onClick={confirm}
        >
          {t(active ? "stopAndDeleteHost" : "delete")}
        </Button>
      </ModalActions>
    </Modal>
  );
}
