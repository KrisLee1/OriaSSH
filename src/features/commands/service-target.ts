import type { CommandRun, Host, RemoteService, ServiceObservation, Snapshot } from "@/types";
import { primaryLogin } from "@/features/hosts/login-identities";

export function serviceLoginId(
  service: Pick<RemoteService, "loginByHost"> | undefined,
  host: Host | undefined,
  requested?: string | null,
) {
  if (!host) return undefined;
  const saved = service?.loginByHost?.[host.id];
  return requested ?? (typeof saved === "string" ? saved : undefined) ??
    host.defaultLoginId ?? primaryLogin(host);
}
// UI selection keys distinguish explicit host execution from a saved forward.
export const hostServiceTarget = (hostId: string) => `host:${hostId}`;
export const serviceHostIds = (
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
) =>
  service.hostIds ?? [
    ...new Set(serviceRules(service, data).map((r) => r.hostId)),
  ];
export const serviceRules = (
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
) => data.rules.filter((r) => service.ruleIds.includes(r.id));
// Never choose the first of several targets implicitly: a service can be reused on different hosts.
export function serviceTarget(
  service: RemoteService,
  data: Pick<Snapshot, "rules">,
  ruleId?: string,
) {
  if (ruleId?.startsWith("host:")) {
    const hostId = ruleId.slice(5);
    return serviceHostIds(service, data).includes(hostId)
      ? { id: ruleId, hostId }
      : undefined;
  }
  const rules = serviceRules(service, data);
  if (!ruleId && service.hostIds !== undefined) {
    return service.hostIds.length === 1
      ? {
          id: hostServiceTarget(service.hostIds[0]),
          hostId: service.hostIds[0],
        }
      : undefined;
  }
  return ruleId
    ? rules.find((r) => r.id === ruleId)
    : rules.length === 1
      ? rules[0]
      : serviceHostIds(service, data).length === 1
        ? {
            id: hostServiceTarget(serviceHostIds(service, data)[0]),
            hostId: serviceHostIds(service, data)[0],
          }
        : undefined;
}

export function failedCommandRetryTarget(
  data: Pick<Snapshot, "services" | "rules">,
  run: CommandRun,
) {
  if (
    run.phase !== "failed" ||
    run.finishedAt === null ||
    run.error === "authentication" ||
    run.error === "remoteUnknown" ||
    run.actionId.startsWith("$") ||
    (run.submitted && run.exitCode === null && !run.exitSignal)
  )
    return undefined;

  const service = data.services?.find(
    (item) => item.id === run.serviceId && item.revision === run.serviceRevision,
  );
  if (!service || service.executionEnabled === false) return undefined;
  const ruleId = run.workflowRuleId ?? hostServiceTarget(run.hostId);
  const target = serviceTarget(service, data, ruleId);
  const action = service.actions.find((item) => item.id === run.actionId);
  if (target?.hostId !== run.hostId || !action || action.mode === "terminal")
    return undefined;
  return { service, action, ruleId };
}

export function serviceCommandOutput(
  runs: CommandRun[],
  service: RemoteService,
  hostId: string,
) {
  const local = runs.filter((run) =>
    run.serviceId === service.id &&
    run.serviceRevision === service.revision &&
    run.hostId === hostId,
  );
  return local.find((run) => run.finishedAt === null)
    ?? local.find((run) => !run.actionId.startsWith("$"));
}

export function serviceRuntimeState(
  service: RemoteService,
  hostId: string,
  loginId: string | undefined,
  runs: CommandRun[],
  observations: ServiceObservation[],
  terminalRunning: boolean,
) {
  if (terminalRunning || runs.some((run) =>
    run.hostId === hostId && run.serviceId === service.id &&
    run.serviceRevision === service.revision && run.finishedAt === null &&
    run.phase === "foreground-running" && service.actions.some((action) =>
      action.id === run.actionId && (action.kind === "start" || action.kind === "restart"),
    ),
  )) return "foreground-running";
  const fact = observations.find((item) => item.hostId === hostId && item.serviceId === service.id &&
    item.serviceRevision === service.revision && item.loginId === loginId)?.status;
  return fact && !fact.expired ? fact.value : "unknown";
}

export interface TrayServiceRequest {
  serviceId: string;
  revision: string;
  ruleId: string;
  actionId: string;
  stopTerminal: boolean;
}
export function resolveTrayServiceRequest(
  data: Pick<Snapshot, "services" | "rules">,
  request: TrayServiceRequest,
) {
  const service = data.services?.find(
    (service) =>
      service.id === request.serviceId && service.revision === request.revision,
  );
  if (!service || !serviceTarget(service, data, request.ruleId))
    return undefined;
  const action = service.actions.find(
    (action) => action.id === request.actionId,
  );
  if (
    !action ||
    (request.stopTerminal &&
      (action.kind !== "start" || action.mode !== "terminal"))
  )
    return undefined;
  return { service, action, ruleId: request.ruleId };
}
