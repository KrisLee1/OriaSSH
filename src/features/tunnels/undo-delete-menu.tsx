import { ServerIcon, Undo2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Snapshot } from "@/types";
import { ForwardIcon } from "./forward-icon";

type UndoDeleteProps = {
  history: Pick<Snapshot, "hostUndoCount" | "forwardUndoCount">;
  disabled: boolean;
  onUndo: (kind: "host" | "forward") => void;
};

export function UndoDeleteItems({ history, disabled, onUndo }: UndoDeleteProps) {
  const { t } = useTranslation("tunnel");
  const { hostUndoCount, forwardUndoCount } = history;
  const items = [
    { kind: "host", label: t("hosts"), icon: ServerIcon, count: hostUndoCount },
    { kind: "forward", label: t("tunnels"), icon: ForwardIcon, count: forwardUndoCount },
  ] as const;

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t("undoDelete")}</DropdownMenuLabel>
      {items.filter(({ count }) => count > 0).map(({ kind, label, icon: Icon, count }) => (
        <DropdownMenuItem
          key={kind}
          label={label}
          className="min-h-7 whitespace-nowrap"
          disabled={disabled}
          onClick={() => onUndo(kind)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
          <span className="ms-auto ps-3 text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

export function UndoDeleteMenu(props: UndoDeleteProps) {
  const { t } = useTranslation("tunnel");
  if (!props.history.hostUndoCount && !props.history.forwardUndoCount) return null;

  const label = t("undoDelete");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={props.disabled}
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} />}
      >
        <Undo2Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-max min-w-44" aria-label={label}>
        <UndoDeleteItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
