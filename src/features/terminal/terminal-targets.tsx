import { PageEmptyState } from "@/components/page-empty-state";
import { Monitor, SquarePlusIcon, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HostIcon } from "@/features/hosts/host-icon";
import { resolvedDefaultLogin } from "@/features/hosts/login-identities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Host } from "@/types";

export function TerminalTargets({
  hosts,
  busy,
  choose,
  menu = false,
}: {
  hosts: Host[];
  busy: boolean;
  choose: (host: Host | null) => void;
  menu?: boolean;
}) {
  const { t } = useTranslation("terminal");
  const targets = [null, ...hosts].map((host) => {
    const label = host?.name ?? t("localTerminal");
    const login = resolvedDefaultLogin(host ?? undefined);
    const endpoint = login ? `${login.user}@${login.address}:${login.port}` : "";
    const content = (
      <>
        <span
          className="grid size-5 shrink-0 place-items-center"
          aria-hidden="true"
        >
          {host ? (
            <HostIcon appearance={host.appearance} />
          ) : (
            <Monitor size={16} />
          )}
        </span>
        <span className="terminal-target-text">
          <span>{label}</span>
          {endpoint && <small>{endpoint}</small>}
        </span>
      </>
    );
    const props = {
      disabled: busy || !!host?.diagnostics.length,
      onClick: () => choose(host),
      title: host?.diagnostics.join("\n") || endpoint || label,
      "data-terminal-target": host?.id ?? "",
      className: "terminal-target",
    };
    return menu ? (
      <DropdownMenuItem key={host?.id ?? ""} label={label} {...props}>
        {content}
      </DropdownMenuItem>
    ) : (
      <Button key={host?.id ?? ""} type="button" variant="outline" {...props}>
        {content}
      </Button>
    );
  });
  if (!menu)
    return (
      <div
        className="terminal-start scroll-fade"
        data-terminal-start=""
        aria-label={t("new")}
      >
        <PageEmptyState
          compact
          className="my-auto flex-none"
          icon={<SquareTerminal />}
          title={t("new")}
          action={<div className="grid w-full gap-2">{targets}</div>}
        />
      </div>
    );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" />}
        disabled={busy}
        data-terminal-new=""
        aria-label={t("new")}
        title={t("new")}
      >
        <SquarePlusIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="terminal-target-menu">
        {targets}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
