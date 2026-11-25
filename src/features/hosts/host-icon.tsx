import { ServerIcon } from "lucide-react";
import type { Host } from "@/types";
import { ConnectionIcon } from "../tunnels/connection-icon";

export function HostIcon({ appearance }: { appearance?: Host["appearance"] }) {
  return appearance?.icon ? (
    <ConnectionIcon icon={appearance.icon} color={appearance.color} />
  ) : (
    <ServerIcon
      size={16}
      aria-hidden="true"
      style={{ color: appearance?.color ?? undefined }}
    />
  );
}
