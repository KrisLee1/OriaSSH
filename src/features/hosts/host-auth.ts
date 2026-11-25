import type { Host, Runtime } from "@/types";
import { passwordStatus } from "@/lib/bridge";

export const hostAuthLabels: Record<Host["authMethod"], string> = {
  auto: "authAuto",
  password: "authPassword",
  privateKey: "authPrivateKey",
  agent: "authAgent",
};

// A configured key is a useful preference label; the successful Rust result
// takes precedence without changing the host's underlying Auto fallback policy.
export function hostAuthMethod(
  host: Host,
  runtime?: Runtime,
): Host["authMethod"] {
  if (runtime?.authMethodUsed) return runtime.authMethodUsed;
  if (host.authMethod !== "auto") return host.authMethod;
  if (host.identityFiles.some((path) => path.trim() && path !== "none"))
    return "privateKey";
  if (host.identityAgent && host.identityAgent !== "none") return "agent";
  return "auto";
}

export async function passwordsToRequest(
  hosts: Host[],
  readStatus = passwordStatus,
) {
  const checks = await Promise.all(
    hosts
      .filter((host) => host.authMethod === "password")
      .map(async (host) => {
        const statuses = await readStatus([host.id], host.activeLoginId).catch(
          () => [],
        );
        return statuses.some(({ id, saved }) => id === host.id && saved)
          ? null
          : host;
      }),
  );
  return checks.filter((host) => host !== null);
}

export type AutomaticAttempt = { previousRunId?: string; hostId?: string };
export function automaticAuthOutcome(
  attempt: AutomaticAttempt,
  runtime?: Runtime,
) {
  if (!runtime || runtime.runId === attempt.previousRunId) return "waiting";
  if (["failed", "needs-attention"].includes(runtime.status))
    return runtime.errorKind === "authentication" ? "prompt" : "done";
  return ["stopped", "tested", "listening"].includes(runtime.status)
    ? "done"
    : "waiting";
}
