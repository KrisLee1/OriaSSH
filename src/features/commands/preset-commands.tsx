import { LoginPicker, resolvedDefaultLogin, resolvedLogin } from "../hosts/login-identities";
import { formatUiError } from "@/lib/ui-message";
import {
  serviceRules,
  serviceHostIds,
  hostServiceTarget,
  serviceTarget,
  serviceLoginId,
  failedCommandRetryTarget,
  serviceCommandOutput,
  serviceRuntimeState,
  resolveTrayServiceRequest,
  type TrayServiceRequest,
} from "./service-target";
import {
  ConnectionIcon,
  ConnectionIconPicker,
} from "@/features/tunnels/connection-icon";
import { ConnectionColorPicker } from "@/features/tunnels/connection-color";
import { VncLauncher } from "@/features/tunnels/service-protocol";
import { CardEdge } from "@/features/tunnels/canvas-link";
import { directProtocol, directProtocols } from "./direct-protocol";
import { ServiceRunningContext } from "./service-running-context";
import {
  CommandInvocationEditor,
  renderInvocation,
  displayInvocation,
  readableActionPreview,
  readableShellSource,
  normalizeInvocation,
  CommandEnvironmentEditor,
  isStructuredCommand,
  actionScript,
  editActionScript,
  editActionEnvironment,
  switchActionFormat,
} from "./command-invocation";
import { CommandVariableField, CommandVariableText } from "./command-variable-field";
import { hasServicePort } from "./command-variable-model";
import { CommandOutputText } from "./command-output";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ServiceEnableDialog, ServiceReview } from "./service-review";
import { ServiceTemplateDialog } from "./service-template";
import { fillServiceTemplate } from "./service-template-catalog";
import { backgroundServices, manageServiceWithSystemd, restoreSystemdCommand, systemdService, systemdUnit } from "./systemd-service";
import {
  TerminalWorkspaceProvider,
  useTerminalWorkspace,
} from "@/features/terminal/terminal-workspace";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type RefObject,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence } from "motion/react";
import {
  MonitorIcon,
  ExternalLinkIcon,
  ScreenShareIcon,
  ActivityIcon,
  FileTextIcon,
  RotateCwIcon,
  SquareIcon,
  SquareTerminalIcon,
  FileInputIcon,
  InfoIcon,
  PackagePlusIcon,
  PlusIcon,
  Trash2Icon,
  Settings2Icon,
  BoxesIcon,
  ArrowRightIcon,
  PlayIcon,
  ChevronDownIcon,
  EraserIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ParameterField } from "@/components/parameter-field";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Modal,
  ModalActions,
  ModalTitleActions,
} from "@/components/tunnel-form";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { endpoint, jumpHosts } from "@/features/tunnels/rule-model";
import * as bridge from "@/lib/bridge";
import type {
  CommandEvent,
  CommandInvocation,
  DirectProtocol,
  CommandRun,
  Host,
  PresetAction,
  RemoteService,
  Rule,
  Runtime,
  Snapshot,
} from "@/types";
import {
  commandActive,
  commandKinds,
  mergeRuns,
  newAction,
  changeActionKind,
  newService,
  OutputDecoder,
  reviewScript,
  allowsUnlimitedAction,
  serviceForwardReachableAt,
} from "./command-model";

import {
  CredentialRetry,
  ControlEditor,
  ServiceState,
  ServiceOperations,
  useServiceObservations,
} from "./service-controls";
import type { ServiceOperation } from "@/types";

interface Filter {
  hostId?: string;
  ruleId?: string;
}
interface ServiceUI {
  data: Pick<Snapshot, "rules">;
  running: (service: RemoteService, targetId?: string) => boolean;
  inspect: (service: RemoteService, targetId?: string) => void;
  create: (hostId: string) => void;
  definitionLocked: (service: RemoteService) => boolean;
  edit: (service: RemoteService) => void;
  remove: (service: RemoteService) => void;
  output: (service: RemoteService, hostId: string) => CommandRun | undefined;
  openOutput: (run: CommandRun) => void;
  stopOutput: (run: CommandRun) => void;
  refreshStatus: (service: RemoteService, targetId: string) => void;
  state: (service: RemoteService, hostId: string) => string;
  canCreate: boolean;
  services: RemoteService[];
  disabled: (service: RemoteService, ruleId?: string) => boolean;
  execute: (
    service: RemoteService,
    action: PresetAction,
    ruleId?: string,
  ) => void;
}
const Context = createContext<ServiceUI | null>(null);
const commandIcons = {
  start: PlayIcon, stop: SquareIcon, restart: RotateCwIcon,
  status: ActivityIcon, logs: FileTextIcon, custom: SquareTerminalIcon,
};

function HostServiceLauncher({
  service,
  hostId,
  protocol,
  forward,
  children,
}: {
  service: RemoteService;
  forward?: { id: string; runtime?: Pick<Runtime, "status" | "configurationChanged"> };
  hostId: string;
  protocol: DirectProtocol | null;
  children: (
    unavailable: string | null,
    open?: () => void,
    asks?: boolean,
    trigger?: RefObject<HTMLButtonElement | null>,
  ) => ReactNode;
}) {
  const { t } = useTranslation("commands");
  if (!bridge.desktop) return children("serviceDesktopOnly");
  if (!service.port) return children("servicePort");
  if (!protocol) return children("serviceSelectProtocol");
  if (forward && forward.runtime?.status !== "listening") return children("serviceStartFirst");
  if (forward?.runtime?.configurationChanged) return children("serviceReconnect");
  const launch = (internal = false) => {
    const opening = forward
      ? bridge.openService(forward.id, internal, { id: service.id, revision: service.revision, protocol })
      : bridge.openHostService(hostId, service.id, service.revision, protocol, internal);
    void opening.catch((error) =>
        toast.add({ title: formatUiError(String(error), t), type: "error" }),
      );
  };
  if (protocol !== "vnc") return children(null, () => launch());
  return (
    <VncLauncher name={service.name} disabled={false} onOpen={launch}>
      {(open, asks, trigger) => children(null, open, asks, trigger)}
    </VncLauncher>
  );
}

function OpenHostServiceButton({
  service,
  hostId,
  protocol,
  forward,
}: {
  service: RemoteService;
  forward?: { id: string; runtime?: Pick<Runtime, "status" | "configurationChanged"> };
  hostId: string;
  protocol: DirectProtocol;
}) {
  const { t } = useTranslation("commands");
  const label = t("openNamedService", { name: service.name });
  const Icon = protocol === "vnc" ? ScreenShareIcon : ExternalLinkIcon;
  return (
    <HostServiceLauncher service={service} hostId={hostId} protocol={protocol} forward={forward}>
      {(unavailable, open, asks, trigger) => (
        <span
          className="service-open-action nodrag nopan nokey inline-flex"
          title={unavailable ? t(unavailable, { ns: "tunnel" }) : label}
        >
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!!unavailable}
            aria-label={label}
            aria-haspopup={asks ? "dialog" : undefined}
            onClick={open}
          >
            <Icon aria-hidden="true" />
          </Button>
        </span>
      )}
    </HostServiceLauncher>
  );
}

export const ServiceCommandsButton = memo(function ServiceCommandsButton({
  hostId,
  ruleId,
}: Filter) {
  const ui = useContext(Context);
  const workspace = useTerminalWorkspace();
  const { t } = useTranslation("commands");
  if (!ui) return null;
  const services = ui.services.filter((s) => (
    ruleId
      ? s.ruleIds.includes(ruleId)
      : hostId
        ? serviceHostIds(s, ui.data).includes(hostId)
        : false
  ));
  if (!services.length) return null;
  const targetId = ruleId || (hostId ? hostServiceTarget(hostId) : undefined);
  const vncForward = ruleId && ui.data.rules.some((r) => r.id === ruleId && r.serviceProtocol === "vnc");
  return (
    <div className="service-command-icons inline-flex flex-wrap items-center gap-1 nodrag nopan">
      {services.map((service) => {
        const protocol = directProtocol(service, ui.data.rules, hostId);
        const foreground = workspace?.foregroundSession(service, targetId);
        const running = ui.running(service, targetId);
        const muted = !hostId && !running;
        const color = running
          ? service.color || "var(--oria-color-accent)"
          : hostId ? "var(--oria-color-fg)" : "var(--oria-color-muted-fg)";
        const icon = (
          <span
            className="inline-flex shrink-0"
            data-foreground-emoji={hostId && !running && service.icon?.kind === "emoji" ? "" : undefined}
            style={muted ? { filter: "grayscale(1)", opacity: 0.7 } : undefined}
          >
            <ConnectionIcon icon={service.icon} color={color} />
          </span>
        );
        const terminalStop =
          foreground ||
          (service.actions.some(
            (a) => a.kind === "start" && a.mode === "terminal",
          ) &&
            !service.actions.some((a) => a.kind === "stop"));
        const managed = systemdService(service);
        const menu = (unavailable: string | null, open?: () => void, asks?: boolean, trigger?: RefObject<HTMLButtonElement | null>) => (
          <DropdownMenu key={service.id}>
            <DropdownMenuTrigger
              render={
                <Button
                  ref={trigger}
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="nodrag nopan nokey"
                  aria-label={`${t("services")} ${service.name}`}
                  title={service.name}
                  disabled={!bridge.desktop}
                />
              }
            >
              {vncForward ? <MonitorIcon style={{ color }} /> : icon}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-48" align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-2">
                  {icon}
                  <span>{service.name}</span>
                </DropdownMenuLabel>
                {service.actions
                  .filter((a) => !(foreground && a.kind === "stop"))
                  .map((action) => {
                    const Icon = commandIcons[action.kind];
                    return (
                      <DropdownMenuItem
                        key={action.id}
                        disabled={ui.disabled(service, targetId)}
                        onClick={() => ui.execute(service, action, targetId)}
                      >
                        <Icon aria-hidden="true" />
                        {action.id === managed?.status.id ? t("restoreRunningState") : action.label}
                      </DropdownMenuItem>
                    );
                  })}
                {terminalStop && (
                  <DropdownMenuItem
                    disabled={!bridge.desktop || !foreground || workspace?.busy}
                    onClick={() =>
                      void workspace?.stopService(service, targetId)
                    }
                  >
                    <SquareIcon aria-hidden="true" />
                    {t("kind.stop")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {hostId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t("open", { ns: "files" })}</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={!!unavailable}
                      title={unavailable ? t(unavailable, { ns: "tunnel" }) : undefined}
                      aria-haspopup={asks ? "dialog" : undefined}
                      onClick={open}
                    >
                      {protocol === "vnc" ? <ScreenShareIcon aria-hidden="true" /> : <ExternalLinkIcon aria-hidden="true" />}
                      {t("openNamedService", { name: service.name })}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => ui.inspect(service, targetId)}>
                <InfoIcon aria-hidden="true" />
                {t("details", { ns: "tunnel" })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
        if (!hostId) return menu(null);
        return (
          <HostServiceLauncher
            key={service.id}
            service={service}
            hostId={hostId}
            protocol={protocol}
          >
            {menu}
          </HostServiceLauncher>
        );
      })}
    </div>
  );
});

type ServiceForwardControls = {
  runtime?: Pick<Runtime, "status" | "configurationChanged">;
  traffic: string;
  open: ReactNode;
};

function isVncListAction(action: PresetAction) {
  if (action.kind !== "status" || action.mode === "terminal") return false;
  const words = action.command.trim().split(/[ \t]+/).map(word => word.replace(/^(['"])(.*)\1$/, "$2"));
  return words.length === 2 && words[1] === "-list" &&
    /^(?:[a-zA-Z0-9_./:=-]*\/)?(?:tigervncserver|vncserver)$/.test(words[0]);
}

function hasVncInventory(service: RemoteService) {
  const probe = service.control?.statusProbe;
  return probe ? probe.mode === "vncSessions" : service.actions.some(isVncListAction);
}

function CanvasServiceCard({ host, service, canLink, linked, ports, forwardControls }: {
  host: Host; service: RemoteService; canLink: boolean; linked: Rule[]; ports?: ReactNode;
  forwardControls?: (rule: Rule) => ServiceForwardControls;
}) {
  const ui = useContext(Context)!;
  const workspace = useTerminalWorkspace();
  const { t } = useTranslation("commands");
  const { name } = service;
  const [selectedForward, setSelectedForward] = useState("");
  const rule = linked.find(item => item.id === selectedForward) ?? linked[0];
  const forward = rule && forwardControls?.(rule);
  const linkable = !!service.port && !host.diagnostics.length;
  const address = rule ? endpoint(rule.targetHost, rule.targetPort)
    : service.port ? endpoint(host.address, service.port) : host.address;
  const localAddress = (item: Rule) => endpoint(item.bindAddress, item.bindPort || t("autoPort", { ns: "tunnel" }));
  const protocol = rule?.serviceProtocol ?? directProtocol(service, ui.data.rules, host.id);
  const serviceType = protocol
    ? directProtocols[protocol]
    : t("commandCount", { count: service.actions.length });
  const target = hostServiceTarget(host.id);
  const state = ui.state(service, host.id);
  const running = state === "foreground-running" || state === "running";
  const managed = systemdService(service);
  const inventory = hasVncInventory(service);
  const foreground = workspace?.foregroundSession(service, target);
  const output = ui.output(service, host.id);
  const activeRun = output && commandActive(output) ? output : undefined;
  const checking = activeRun?.phase === "checking-status";
  const statusTone = checking ? "neutral" : running ? "success"
    : state === "failed" ? "danger"
    : state === "stopped" || managed || inventory ? "neutral"
    : null;
  const action = running
    ? managed?.stop ?? service.actions.find((item) => item.kind === "stop")
    : service.actions.find((item) => item.id === managed?.startId) ??
      service.actions.find((item) => item.kind === "start");
  const logsAction = service.actions.find((item) => item.kind === "logs");
  const canCheck = service.control?.statusProbe || service.actions.some((item) => item.kind === "status");
  const hasMainAction = !!(foreground || activeRun || action);
  const terminating = activeRun && workspace?.commandTerminating(activeRun.id);
  const actionsDisabled = ui.disabled(service, target);
  const statusLabel = t("service.checkStatus");
  const outputLabel = t("viewRunOutput");
  const editLabel = t("edit");
  const deleteLabel = t("delete");
  const detailsLabel = t("details", { ns: "tunnel" });
  return (
    <section className="canvas-service" data-canvas-service={service.id} data-link-service={linkable ? service.id : undefined}
      data-link-color={linkable ? service.color ?? undefined : undefined} aria-label={name}
      data-canvas-rules={linked.length ? linked.map(item => item.id).join(" ") : undefined}
      style={{ "--connection-color": service.color || "var(--oria-color-accent)" } as CSSProperties}>
      {linkable && <CardEdge source={{
        type: "service", hostId: host.id, serviceId: service.id, name, color: service.color,
      }} disabled={!canLink} />}
      <div className="canvas-service-heading">
        <h4 className="canvas-service-identity">
          <Button type="button" variant="ghost" size="sm" className="canvas-service-title nodrag nopan nokey"
            aria-label={`${detailsLabel} ${name}`} title={name} aria-haspopup="dialog"
            onClick={() => ui.inspect(service, target)}>
            <ConnectionIcon icon={service.icon ?? { kind: "builtin", value: "boxes" }} color={service.color ?? null} />
            <span>{name}</span>
          </Button>
        </h4>
        {statusTone && (
          <span className={`status tone-${statusTone}`} title={t("service.status")} aria-live="polite">
            <i />{checking ? t("phase.checking-status") : state === "foreground-running" ? t("phase.foreground-running") : t(`service.value.${state}`)}
          </span>
        )}
      </div>
      {rule && <div className="host-rule-meta canvas-service-forward">
        <button type="button" className="host-rule-type nodrag nopan nokey"
          data-rule-endpoint={rule.id} aria-haspopup="dialog"
          aria-label={`${t("typeL", { ns: "tunnel" })} · ${rule.name}`}>
          {t("typeL", { ns: "tunnel" })}
        </button>
        {forward && <small className="host-rule-traffic">{forward.traffic}</small>}
      </div>}
      <div className="canvas-service-endpoints">
        {ports}
        <div className="canvas-service-path">
          <div className="canvas-path-access">
            <span className="canvas-path-type" title={serviceType}>{serviceType}</span>
            {rule?.serviceProtocol && forward ? forward.open : !!service.port && protocol && (
              <OpenHostServiceButton service={service} hostId={host.id} protocol={protocol}
                forward={rule ? { id: rule.id, runtime: forward?.runtime } : undefined} />
            )}
          </div>
          <div className="canvas-path-route">
            {rule ? <>
              {linked.length > 1 ? <Select value={rule.id} onValueChange={id => { if (id) setSelectedForward(id); }}>
                <SelectTrigger size="sm" className="canvas-route-select nodrag nopan nokey"
                  aria-label={t("service.connectForward")} title={localAddress(rule)}>
                  <span>{localAddress(rule)}</span>
                </SelectTrigger>
                <SelectContent>{linked.map(item => <SelectItem value={item.id} key={item.id}>
                  {item.name} · {localAddress(item)}
                </SelectItem>)}</SelectContent>
              </Select> : <code title={localAddress(rule)}>{localAddress(rule)}</code>}
              <ArrowRightIcon aria-hidden="true" />
              <code className="canvas-path-address" title={address}>
                <span>{endpoint(rule.targetHost, "")}</span>
                <button type="button" className="connection-port-number nodrag nopan nokey"
                  data-edit-port={rule.id} data-port-side="host" aria-label={`${editLabel} · ${address}`}>
                  {rule.targetPort}
                </button>
              </code>
            </> : <code title={address}>{address}</code>}
          </div>
        </div>
      </div>
      <footer className="canvas-service-actions nodrag nopan nokey">
        {canCheck && (
          <Button type="button" size={hasMainAction ? "icon-sm" : "sm"}
            variant={hasMainAction ? "ghost" : "primary-soft"} disabled={actionsDisabled}
            title={statusLabel} aria-label={`${statusLabel} ${name}`}
            onClick={() => ui.refreshStatus(service, target)}>
            <ActivityIcon aria-hidden="true" />
            {!hasMainAction && statusLabel}
          </Button>
        )}
        {foreground || output ? (
          <Button type="button" size="icon-sm" variant="ghost"
            title={outputLabel} aria-label={`${outputLabel} ${name}`}
            onClick={() => foreground ? workspace?.revealSession(foreground.id) : output && ui.openOutput(output)}>
            <SquareTerminalIcon aria-hidden="true" />
          </Button>
        ) : null}
        {logsAction && (managed || !(foreground || output)) && (
          <Button type="button" size="icon-sm" variant="ghost" disabled={actionsDisabled}
            title={t("viewServiceLogs")} aria-label={`${t("viewServiceLogs")} ${name}`}
            onClick={() => ui.execute(service, logsAction, target)}>
            <FileTextIcon aria-hidden="true" />
          </Button>
        )}
        <Button type="button" size="icon-sm" variant="ghost" disabled={ui.definitionLocked(service)}
          title={editLabel} aria-label={`${editLabel} ${name}`} aria-haspopup="dialog"
          onClick={() => ui.edit(service)}>
          <Settings2Icon aria-hidden="true" />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" disabled={ui.definitionLocked(service)}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          title={deleteLabel} aria-label={`${deleteLabel} ${name}`} aria-haspopup="dialog"
          onClick={() => ui.remove(service)}>
          <Trash2Icon aria-hidden="true" />
        </Button>
        {hasMainAction && (
          <Button type="button" size="sm"
            variant={foreground || activeRun || running ? "destructive" : "primary-soft"}
            disabled={foreground ? workspace?.busy : activeRun ? terminating : actionsDisabled}
            onClick={() => {
              if (foreground) void workspace?.stopService(service, target);
              else if (activeRun) ui.stopOutput(activeRun);
              else if (action) ui.execute(service, action, target);
            }}>
            {foreground || activeRun || running ? <SquareIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
            {foreground || activeRun ? t(terminating ? "terminating" : "terminateCommand") : action?.label}
          </Button>
        )}
      </footer>
    </section>
  );
}

export function AddHostService({ hostId, afterOpen }: { hostId: string; afterOpen?: () => void }) {
  const ui = useContext(Context);
  const { t } = useTranslation("commands");
  if (!ui) return null;
  return <Button type="button" size="icon-sm" variant="ghost" disabled={!ui.canCreate}
    title={t("addService")} aria-label={t("addService")}
    onClick={() => { ui.create(hostId); afterOpen?.(); }}>
    <PackagePlusIcon aria-hidden="true" />
  </Button>;
}

export const HostServices = memo(function HostServices({
  host, canLink, forwardsFor, renderPorts, forwardControls, standaloneForwards,
}: {
  host: Host; canLink: boolean;
  forwardsFor?: (serviceId: string) => Rule[];
  renderPorts?: (rules: Rule[]) => ReactNode;
  forwardControls?: (rule: Rule) => ServiceForwardControls;
  standaloneForwards?: ReactNode[];
}) {
  const ui = useContext(Context);
  const { t } = useTranslation("commands");
  if (!ui) return null;
  const services = ui.services.filter((s) =>
    serviceHostIds(s, ui.data).includes(host.id),
  );
  if (!services.length && !standaloneForwards?.length) return null;
  return (
    <section className="host-card-group">
      <h3 className="host-card-group-title">{t("services")}</h3>
      {services.map(service => {
        const linked = forwardsFor?.(service.id) ?? [];
        return <CanvasServiceCard key={service.id} host={host} service={service}
          canLink={canLink} linked={linked} ports={renderPorts?.(linked)} forwardControls={forwardControls} />;
      })}
      {standaloneForwards}
    </section>
  );
});
type PresetCommandProviderProps = {
  data: Snapshot;
  onSnapshot: (data: Snapshot) => void;
  children: ReactNode;
};

export function PresetCommandProvider(props: PresetCommandProviderProps) {
  const workspace = useTerminalWorkspace();
  const scope = <PresetCommandScope {...props} />;
  return workspace ? scope : (
    <TerminalWorkspaceProvider data={props.data}>
      {scope}
    </TerminalWorkspaceProvider>
  );
}

function PresetCommandScope({ data, onSnapshot, children }: PresetCommandProviderProps) {
  const { t } = useTranslation("commands");
  const workspace = useTerminalWorkspace();
  if (!workspace) throw new Error("TerminalWorkspaceProvider is required");
  const [reviewing, setReviewing] = useState<RemoteService | null>(null);
  const [inspectingService, setInspectingService] =
    useState<RemoteService | null>(null);
  const [inspectionTarget, setInspectionTarget] = useState<string>();
  const inspect = (service: RemoteService, targetId?: string) => {
    setInspectionTarget(targetId);
    setInspectingService(service);
    setError("");
  };
  const [runs, setRuns] = useState<CommandRun[]>([]);
  const observations = useServiceObservations(true);
  const [editing, setEditing] = useState<RemoteService | null>(null);
  const [intent, setIntent] = useState<{
    service: RemoteService;
    action: PresetAction;
    loginId?: string;
    operation?: ServiceOperation;
    ruleId?: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    revision: string;
    commands: Record<string, string>;
  }>();
  const currentService =
    intent && data.services?.find((s) => s.id === intent.service.id);
  useEffect(() => {
    let live = true;
    setPreview(undefined);
    if (!intent) return;
    if (!currentService) {
      setError("serviceMissing");
      return;
    }
    if (intent.service.revision !== currentService.revision) {
      setSecrets({});
      setRemember({});
      const action = intent.operation
        ? intent.action
        : currentService.actions.find((a) => a.id === intent.action.id);
      if (action) {
        setError("previewUpdated");
        setIntent({ ...intent, service: currentService, action });
      } else setError("actionMissing");
      return;
    }
    void bridge
      .previewServiceCommands(currentService.id, currentService.revision)
      .then((commands) => {
        if (live)
          setPreview({
            id: currentService.id,
            revision: currentService.revision,
            commands,
          });
      })
      .catch((e) => {
        if (live) {
          setError(String(e));
          if (String(e) === "staleAction")
            void bridge
              .snapshot()
              .then((s) => {
                if (live) onSnapshot(s);
              })
              .catch(() => {});
        }
      });
    return () => {
      live = false;
    };
  }, [intent, currentService?.revision, currentService?.id]);
  const previewReady =
    !!intent &&
    !!preview &&
    preview.id === intent.service.id &&
    preview.revision === intent.service.revision &&
    currentService?.revision === preview.revision;
  const [deleting, setDeleting] = useState<RemoteService[] | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  const submissions = useRef(new Map<string, string>());
  const knownRuns = useRef(new Map<string, CommandRun>());
  const [backgroundToRestore] = useState(backgroundServices);
  const restored = useRef(new Set<string>());
  const restoringRequests = useRef(new Set<string>());
  const retryCommand = useRef<(run: CommandRun) => void>(() => {});
  const requestRetry = useCallback((run: CommandRun) => retryCommand.current(run), []);
  const translate = useRef(t);
  translate.current = t;
  const merge = useCallback((next: CommandRun[]) => {
    for (const run of next) {
      const before = knownRuns.current.get(run.id);
      if (before && before.revision > run.revision) continue;
      const restoring = restoringRequests.current.has(run.requestId);
      if (restoring && run.phase === "verifying-host" && before?.phase !== run.phase)
        void bridge.cancelCommand(run.id).catch(() => {});
      if (!restoring && before && commandActive(before) && !commandActive(run) && run.phase !== "cancelled")
        toast.add({
          id: run.id,
          title: `${run.actionLabel.startsWith("$") ? translate.current(`service.${run.actionLabel.slice(1)}`) : run.actionLabel} · ${translate.current(`phase.${run.phase}`)}`,
          description: run.endpoint,
          type: run.phase === "succeeded" ? "success" : "error",
          timeout: 5000,
        });
      knownRuns.current.set(run.id, run);
      if (!commandActive(run)) restoringRequests.current.delete(run.requestId);
    }
    setRuns((old) => mergeRuns(old, next));
  }, []);
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const sub = listen<CommandRun[]>("command://runs", (e) => {
      if (live) merge(e.payload);
    });
    void sub
      .then(() => bridge.commandRuns())
      .then((next) => {
        if (live) merge(next);
      })
      .catch(() => {});
    return () => {
      live = false;
      void sub.then((off) => off()).catch(() => {});
    };
  }, [merge]);
  const targetFor = (service: RemoteService, targetId?: string) => serviceTarget(service, data, targetId);
  const routeFor = (
    service: RemoteService,
    ruleId?: string,
    loginId?: string,
  ) => {
    const target = targetFor(service, ruleId);
    const host = data.hosts.find((h) => h.id === target?.hostId);
    const login = resolvedLogin(host, serviceLoginId(service, host, loginId));
    return login ? [...jumpHosts(data.hosts, login), login] : [];
  };
  useEffect(() => {
    if (!bridge.desktop) return;
    for (const saved of backgroundToRestore) {
      const key = JSON.stringify([saved.serviceId, saved.hostId, saved.loginId]);
      if (restored.current.has(key)) continue;
      const service = data.services?.find((item) =>
        item.id === saved.serviceId && item.revision === saved.serviceRevision,
      );
      if (!service || service.executionEnabled === false || !systemdService(service)) continue;
      const ruleId = saved.workflowRuleId ?? hostServiceTarget(saved.hostId);
      const route = routeFor(service, ruleId, saved.loginId);
      const host = route.at(-1);
      if (!host || host.id !== saved.hostId || route.some((hop) => hop.diagnostics.length) ||
          saved.endpoint !== `${host.user}@${host.address}:${host.port}`) continue;
      restored.current.add(key);
      const requestId = crypto.randomUUID();
      restoringRequests.current.add(requestId);
      void bridge.runServiceOperation({
        serviceId: service.id,
        revision: service.revision,
        loginId: saved.loginId,
        ruleId,
        requestId,
        operation: "checkStatus",
        confirmed: true,
        secrets: {},
        rememberHostIds: [],
      }).catch(() => restoringRequests.current.delete(requestId));
    }
  }, [backgroundToRestore, data]);
  const intentRoute = intent ? routeFor(intent.service, intent.ruleId, intent.loginId) : [];
  const intentHost = intentRoute.at(-1);
  const intentTarget = intent && targetFor(intent.service, intent.ruleId);
  const intentProfile = data.hosts.find((host) => host.id === intentTarget?.hostId);
  const authBinding =
    intent &&
    JSON.stringify(
      intentRoute.map((h) => [
        h.id,
        h.activeLoginId,
        h.address,
        h.port,
        h.user,
        h.authMethod,
        h.identityFiles,
      ]),
    );
  useEffect(() => {
    setSecrets({});
    setRemember({});
  }, [authBinding]);
  const operationAction = (
    service: RemoteService,
    operation: ServiceOperation,
  ): PresetAction => ({
    id: `$${operation}`,
    kind: operation === "connect" ? "start" : "status",
    label: t(`service.${operation}`),
    command: [
      operation !== "checkHealth" &&
        service.actions.find(
          (a) => a.id === service.control?.statusProbe?.actionId,
        )?.command,
      operation === "connect" &&
        service.actions.find((a) => a.id === service.control?.startActionId)
          ?.command,
      operation !== "checkStatus" && service.control?.healthProbe?.command,
    ]
      .filter(Boolean)
      .join("\n\n"),
    timeoutSecs: 60,
    successCodes: [0],
    confirm: operation === "connect",
  });
  const perform = async (fn: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const key = String(e);
      setError(key);
      if(key === "staleAction") void bridge.snapshot().then(onSnapshot).catch(() => {});
      toast.add({ title: formatUiError(key, t), type: "error" });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const start = async (
    service: RemoteService,
    action: PresetAction,
    values: Record<string, string>,
    saved: Record<string, boolean>,
    operation?: ServiceOperation,
    ruleId?: string,
    loginId?: string,
  ) => {
    await perform(async () => {
      if (action.mode === "terminal") {
        await workspace.openPreset(
          service,
          action,
          values,
          Object.keys(saved).filter((id) => saved[id]),
          ruleId, loginId,
        );
        setIntent(null);
        setSecrets({});
        setRemember({});
        return;
      }
      const key = `${service.id}:${service.revision}:${action.id}:${ruleId || ""}:${loginId || ""}`;
      const requestId = submissions.current.get(key) || crypto.randomUUID();
      submissions.current.set(key, requestId);
      const run = operation
        ? await bridge.runServiceOperation({
            serviceId: service.id, loginId,
            revision: service.revision,
            requestId,
            operation,
            ruleId,
            confirmed: true,
            secrets: values,
            rememberHostIds: Object.keys(saved).filter((id) => saved[id]),
          })
        : await bridge.startCommand({
            serviceId: service.id, loginId,
            actionId: action.id,
            ruleId,
            revision: service.revision,
            requestId,
            confirmed: true,
            secrets: values,
            rememberHostIds: Object.keys(saved).filter((id) => saved[id]),
          });
      submissions.current.delete(key);
      merge([run]);
      workspace.showCommand(run, requestRetry);
      setIntent(null);
      setSecrets({});
      setRemember({});
    });
  };
  const execute = (
    service: RemoteService,
    action: PresetAction,
    override?: string,
  ) => {
    const target = targetFor(service, override);
    const ruleId = target?.id;
    const route = routeFor(service, ruleId);
    const host = route.at(-1);
    if (!ruleId || !host) {
      setError("serviceTargetRequired");
      return;
    }
    setError("");
    setSecrets({});
    setRemember({});
    const loginId = serviceLoginId(service, host);
    if (
      action.confirm ||
      action.servicePortVariable ||
      host.logins?.length ||
      route.some((h) => h.authMethod === "password")
    )
      setIntent({ service, action, ruleId, loginId });
    else void start(service, action, {}, {}, undefined, ruleId, loginId);
  };
  const executeOperation = (
    service: RemoteService,
    operation: ServiceOperation,
    ruleId?: string,
  ) => {
    setError("");
    setSecrets({});
    setRemember({});
    const target = targetFor(service, ruleId);
    ruleId = target?.id;
    const route = routeFor(service, ruleId);
    const host = route.at(-1);
    if (!ruleId || !host) {
      setError("serviceTargetRequired");
      return;
    }
    const action = operationAction(service, operation);
    const loginId = serviceLoginId(service, host);
    const statusAction = operation === "checkStatus" && service.actions.find(
      (action) => action.id === service.control?.statusProbe?.actionId,
    );
    if (
      operation === "connect" ||
      (statusAction && statusAction.servicePortVariable) ||
      host.logins?.length ||
      route.some((h) => h.authMethod === "password")
    )
      setIntent({ service, action, operation, ruleId, loginId });
    else void start(service, action, {}, {}, operation, ruleId, loginId);
  };
  const trust = runs.find(
    (r) => r.phase === "verifying-host" && commandActive(r) && r.fingerprint &&
      !restoringRequests.current.has(r.requestId),
  );
  const close = () => {
    setEditing(null);
    setIntent(null);
    setDeleting(null);
    setSecrets({});
    setRemember({});
    setError("");
  };
  const isDisabled = (service: RemoteService, ruleId?: string, settledRun?: CommandRun) => {
    const target = targetFor(service, ruleId);
    const host = data.hosts.find((h) => h.id === target?.hostId);
    return (
      !bridge.desktop ||
      busy ||
      workspace.serviceBusy(service.id) ||
      runs.some((r) =>
        r.serviceId === service.id &&
        commandActive(r) &&
        (r.id !== settledRun?.id || r.revision > settledRun.revision),
      ) ||
      service.executionEnabled === false ||
      !host ||
      !!host.diagnostics.length
    );
  };
  const trayAction = useRef<(request: TrayServiceRequest) => void>(() => {});
  useLayoutEffect(() => {
    retryCommand.current = (run) => {
      if (submitting.current) return;
      const target = failedCommandRetryTarget(data, run);
      const report = (error: string) => toast.add({
        title: formatUiError(error, t),
        type: "error",
        timeout: 6000,
      });
      const host = target && routeFor(target.service, target.ruleId, run.loginId).at(-1);
      if (!target || !host || run.endpoint !== `${host.user}@${host.address}:${host.port}`) {
        report("staleAction");
        return;
      }
      if (isDisabled(target.service, target.ruleId, run)) {
        report(host.diagnostics.length ? "hostBlocked" : "serviceBusy");
        return;
      }
      void start(target.service, target.action, {}, {}, undefined, target.ruleId, run.loginId);
    };
    trayAction.current = (request) => {
      const resolved = resolveTrayServiceRequest(data, request);
      if (!resolved) {
        toast.add({
          title: t("error.staleAction"),
          type: "error",
          timeout: 6000,
        });
        return;
      }
      const { service, action, ruleId } = resolved;
      if (request.stopTerminal) {
        if (
          workspace.foregroundSession(service, ruleId)?.actionId === action.id
        )
          void workspace.stopService(service, ruleId);
        else inspect(service, ruleId);
      } else if (isDisabled(service, ruleId)) inspect(service, ruleId);
      else execute(service, action, ruleId);
    };
  });
  useEffect(() => {
    if (!bridge.desktop) return;
    let live = true;
    const subscription = listen<TrayServiceRequest>(
      "tunnel://tray-service-action",
      ({ payload }) => {
        if (live) trayAction.current(payload);
      },
    );
    return () => {
      live = false;
      void subscription.then((off) => off()).catch(() => {});
    };
  }, []);
  const definitionLocked = (service: RemoteService) =>
    busy || workspace.serviceBusy(service.id) ||
    runs.some((run) => run.serviceId === service.id && commandActive(run));
  const stateFor = (service: RemoteService, hostId: string) => {
    const host = data.hosts.find((item) => item.id === hostId);
    const login = serviceLoginId(service, host);
    const session = workspace.foregroundSession(service, hostServiceTarget(hostId));
    return serviceRuntimeState(service, hostId, login, runs, observations,
      session?.phase === "running" && session.finishedAt === null);
  };
  const serviceUi = useMemo<ServiceUI>(
    () => ({
      data,
      definitionLocked,
      edit: (service) => {
        setError("");
        setEditing(structuredClone(service));
      },
      remove: (service) => {
        setError("");
        setDeleting([service]);
      },
      output: (service, hostId) => serviceCommandOutput(
        runs.filter((run) => !restoringRequests.current.has(run.requestId)),
        service,
        hostId,
      ),
      openOutput: (run) => workspace.revealCommand(run, requestRetry),
      stopOutput: (run) => workspace.terminateCommand(run.id),
      refreshStatus: (service, targetId) => {
        const probe = service.control?.statusProbe;
        if (probe && probe.mode !== "vncSessions") {
          executeOperation(service, "checkStatus", targetId);
          return;
        }
        const status = probe ? service.actions.find((action) => action.id === probe.actionId) :
          service.actions.find(isVncListAction) ?? service.actions.find((action) => action.kind === "status");
        if (status) execute(service, status, targetId);
      },
      state: stateFor,
      running: (service, targetId) => {
        const target = targetFor(service, targetId);
        if (!target) return false;
        const state = stateFor(service, target.hostId);
        return state === "running" || state === "foreground-running";
      },
      inspect,
      create: (hostId) => {
        setError("");
        setEditing(newService(hostId));
      },
      canCreate: bridge.desktop && !busy,
      services: data.services || [],
      disabled: isDisabled,
      execute,
    }),
    [
      data.hosts,
      data.rules,
      data.services,
      data.addedHostIds,
      onSnapshot,
      workspace,
      t,
      reviewing,
      inspectingService,
      runs,
      observations,
      editing,
      intent,
      deleting,
      secrets,
      remember,
      busy,
      error,
    ],
  );
  const editingHost = editing?.hostIds?.length === 1
    ? data.hosts.find((host) => host.id === editing.hostIds?.[0])
    : undefined;
  return (
    <Context.Provider value={serviceUi}>
      <ServiceRunningContext.Provider value={serviceUi.running}>
        {children}
      </ServiceRunningContext.Provider>
      <AnimatePresence>
        {inspectingService && (
          <Modal
            key="service-details"
            title={inspectingService.name}
            close={() => setInspectingService(null)}
            className="max-w-3xl sm:max-w-3xl"
          >
            <ServiceReview
              service={inspectingService}
              endpoint={
                serviceRules(inspectingService, data)
                  .map((rule) => rule.name)
                  .join(" · ") || t("serviceUnbound")
              }
              renderAction={(action) => action.id !== inspectingService.control?.statusProbe?.actionId && (
                <div className="inline-actions">
                  <Button type="button" size="xs" variant="outline"
                    aria-label={`${t("execute")} ${action.label}`}
                    disabled={isDisabled(inspectingService, inspectionTarget)}
                    onClick={() => {
                      setInspectingService(null);
                      execute(inspectingService, action, inspectionTarget);
                    }}>
                    <PlayIcon aria-hidden="true" />{t("execute")}
                  </Button>
                </div>
              )}
            />
            {(inspectingService.control?.statusProbe || inspectingService.control?.healthProbe) && <ServiceOperations service={inspectingService} data={data} ruleId={inspectionTarget}
              disabled={isDisabled(inspectingService, inspectionTarget)} onOperation={(operation, target) => {
                setInspectingService(null);
                executeOperation(inspectingService, operation, target);
              }} />}
            <Button variant="outline" disabled={!bridge.desktop || busy || workspace?.serviceBusy(inspectingService.id) ||
              runs.some(run => run.serviceId === inspectingService.id && commandActive(run))} onClick={() => {
              if (inspectingService.executionEnabled === false) {
                setReviewing(inspectingService);
                setInspectingService(null);
              } else void perform(async () => {
                onSnapshot(await bridge.setServiceExecution(inspectingService.id, inspectingService.revision, false, false));
                setInspectingService(null);
              });
            }}>{t(inspectingService.executionEnabled === false ? "sharing.enableReview" : "sharing.disable")}</Button>
          </Modal>
        )}
        {reviewing && (
          <ServiceEnableDialog
            key="service-enable"
            service={reviewing}
            endpoint={
              serviceRules(reviewing, data)
                .map((rule) => rule.name)
                .join(" · ") || t("serviceUnbound")
            }
            busy={busy}
            error={formatUiError(error, t)}
            close={() => setReviewing(null)}
            enable={() =>
              void perform(async () => {
                onSnapshot(
                  await bridge.setServiceExecution(
                    reviewing.id,
                    reviewing.revision,
                    true,
                    true,
                  ),
                );
                setReviewing(null);
              })
            }
          />
        )}
        {editing && (
          <ServiceEditor
            key={`service-editor:${editing.id || "new"}`}
            service={editing}
            data={data}
            busy={busy}
            dialog={{
              title: t(editing.id ? "editService" : "addService"),
              description:
                editingHost && t("editorHost", { name: editingHost.name }),
              error: error && formatUiError(error, t),
              close,
            }}
            onCancel={() => setEditing(null)}
            onSave={(service) =>
              void perform(async () => {
                onSnapshot(await bridge.saveServiceProfile(service));
                setEditing(null);
              })
            }
          />
        )}
        {intent && (
          <Modal
            key="command-intent"
            title={intent.action.label}
            description={t("executeHint")}
            close={() => {
              setIntent(null);
              setSecrets({});
              setRemember({});
            }}
          >
            <code className="preset-command-code">
              {intentHost
                ? `${intentHost.user}@${intentHost.address}:${intentHost.port}`
                : t("serviceTargetRequired")}
            </code>
            {error && (
              <p role="alert" className="inline-error">
                {formatUiError(error, t)}
              </p>
            )}
            {intentProfile && (
              <LoginPicker
                label={t("logins", { ns: "tunnel" })}
                host={intentProfile}
                value={intent.loginId}
                change={(loginId) => {
                  setSecrets({});
                  setRemember({});
                  setIntent({ ...intent, loginId });
                }}
              />
            )}
            <pre className="preset-script" data-selectable="true">
              {previewReady &&
                reviewScript(
                  intent.operation
                    ? operationAction(
                        {
                          ...intent.service,
                          actions: intent.service.actions.map((action) => ({
                            ...action,
                            command: readableActionPreview(action, preview.commands[action.id] || ""),
                          })),
                        },
                        intent.operation,
                      ).command
                    : readableActionPreview(intent.action, preview.commands[intent.action.id] || ""),
                )}
            </pre>
            {(() => {
              const launcher = (intent.operation === "connect"
                ? intent.service.actions.find((action) => action.id === intent.service.control?.startActionId)
                : intent.action)?.systemdLaunch;
              return launcher && (
                <p className="muted">{t("managedBySystemd", { unit: launcher.unit })}</p>
              );
            })()}
            {intent.operation === "connect" && (
              <p className="muted">
                {t("service.connectReview", {
                  forward: data.rules.find((r) => r.id === intent.ruleId)?.name,
                })}
              </p>
            )}
            <form
              id="command-auth"
              onSubmit={(e) => {
                e.preventDefault();
                if (!previewReady || busy || !intentHost) return;
                void start(
                  intent.service,
                  intent.action,
                  secrets,
                  remember,
                  intent.operation,
                  intent.ruleId, intent.loginId,
                );
              }}
            >
              {intentRoute
                .filter((h) => h.authMethod === "password")
                .map((host) => (
                  <AuthenticationField
                    key={host.id}
                    host={host}
                    labelContext={host.id === intentHost?.id ? "screen-reader" : undefined}
                    value={secrets[host.id] || ""}
                    onChange={(value) =>
                      setSecrets((old) => ({ ...old, [host.id]: value }))
                    }
                    remember={!!remember[host.id]}
                    onRemember={(value) =>
                      setRemember((old) => ({ ...old, [host.id]: value }))
                    }
                  />
                ))}
              <ModalActions>
                <Button
                  type="submit"
                  form="command-auth"
                  variant="primary-soft"
                  disabled={busy || !previewReady || !intentHost}
                >
                  <PlayIcon aria-hidden="true" />
                  {t("execute")}
                </Button>
              </ModalActions>
            </form>
          </Modal>
        )}
        {deleting && (
          <Modal
            key="delete-service"
            title={t("batch.deleteTitle", { count: deleting.length })}
            description={t("deleteHint")}
            close={() => setDeleting(null)}
          >
            <ul className="delete-targets">
              {deleting.map((service) => (
                <li key={service.id}>{service.name}</li>
              ))}
            </ul>
            {error && (
              <p className="inline-error" role="alert">
                {formatUiError(error, t)}
              </p>
            )}
            <ModalActions>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    onSnapshot(
                      await bridge.deleteServiceProfiles(
                        deleting.map(({ id, revision }) => ({ id, revision })),
                      ),
                    );
                    setDeleting(null);
                  })
                }
              >
                {t("delete")}
              </Button>
            </ModalActions>
          </Modal>
        )}
        {trust && (
          <Modal
            key="command-trust"
            title={t("trust")}
            description={t("trustHint")}
            close={() =>
              void bridge
                .cancelCommand(trust.id)
                .catch((e) => setError(String(e)))
            }
          >
            <strong>{trust.verificationEndpoint}</strong>
            <code className="fingerprint">{trust.fingerprint}</code>
            <ModalActions>
              <Button
                variant="destructive"
                onClick={() => void bridge.cancelCommand(trust.id)}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await bridge.trustHost(
                      trust.id,
                      trust.id,
                      trust.fingerprint!,
                    );
                  })
                }
              >
                {t("trust")}
              </Button>
            </ModalActions>
          </Modal>
        )}
      </AnimatePresence>
    </Context.Provider>
  );
}

export function ServiceEditor({
  service,
  data,
  busy,
  dialog,
  onSave,
  onCancel,
}: {
  service: RemoteService;
  data: Snapshot;
  busy: boolean;
  dialog?: {
    title: string;
    description?: string;
    error?: string;
    close: () => void;
  };
  onSave: (s: RemoteService) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("commands");
  const id = useId();
  const protocolOptions = [
    { value: "auto", label: t("authAuto", { ns: "tunnel" }) },
    ...Object.entries(directProtocols).map(([value, label]) => ({
      value,
      label,
    })),
  ];
  const [draft, setDraft] = useState<RemoteService>(() => ({
    ...restoreSystemdCommand(service),
    hostIds: serviceHostIds(service, data),
  }));
  const [templateOpen, setTemplateOpen] = useState(false);
  const [configuringSystemd, setConfiguringSystemd] = useState(false);
  const [addedActionId, setAddedActionId] = useState("");
  const actionToFocus = useRef<string | null>(null);
  const structuredDrafts = useRef(new Map<string, CommandInvocation>());
  const serviceHosts = data.hosts.filter((host) =>
    draft.hostIds?.includes(host.id),
  );
  const affectedRules = serviceRules(service, data).filter(
    (rule) => rule.kind !== "D" && draft.hostIds?.includes(rule.hostId),
  );
  const needsPort = draft.actions.some(
    (a) =>
      a.servicePortVariable &&
      (isStructuredCommand(a)
        ? a.invocation?.arguments.some((arg) => hasServicePort(arg.value))
        : hasServicePort(actionScript(a))),
  );
  const hasServiceTarget =
    !!draft.hostIds?.length &&
    !!(draft.port || draft.actions.length || draft.control?.healthProbe);
  const actionLabels = Object.fromEntries(
    commandKinds.map((kind) => [kind, t(`kind.${kind}`)]),
  ) as Record<PresetAction["kind"], string>;
  const managed = systemdService(draft);
  const systemdTarget = systemdUnit(draft.id);
  const foregroundStart = draft.actions.filter((action) => action.kind === "start");
  const managedUnit = managed?.unit ?? foregroundStart[0]?.systemdLaunch?.unit;
  const configureSystemd = async () => {
    if (!systemdTarget || foregroundStart.length !== 1 || configuringSystemd) return;
    const start = foregroundStart[0];
    setConfiguringSystemd(true);
    try {
      const template = await bridge.previewServiceTemplate("systemdUser", systemdTarget);
      setDraft((current) => {
        const action = current.actions.find((item) => item.id === start.id);
        return action?.command.trim() && !action.systemdLaunch && !systemdService(current) &&
          current.actions.filter((item) => item.kind === "start").length === 1 &&
          current.actions.length + template.actions.filter((item) => item.kind !== "start" && item.kind !== "restart").length <= 32
          ? manageServiceWithSystemd(current, action, template, actionLabels)
          : current;
      });
    } catch (error) {
      toast.add({ title: formatUiError(String(error), t), type: "error" });
    } finally {
      setConfiguringSystemd(false);
    }
  };
  const updateAction = (index: number, patch: Partial<PresetAction>) =>
    setDraft((current) => {
      const action = current.actions[index];
      if (!action) return current;
      const next = { ...action, ...patch };
      const control = current.control?.startActionId === action.id &&
        (next.mode === "terminal" || next.kind !== "start")
        ? { ...current.control, startActionId: null }
        : current.control;
      if (
        (patch.mode || patch.kind) && next.timeoutSecs === 0 &&
        !allowsUnlimitedAction(next, control?.startActionId)
      ) {
        next.timeoutSecs = next.kind === "status" ? 15 : 60;
      }
      return { ...current, control, actions: current.actions.map((item, i) => i === index ? next : item) };
    });
  const addAction = (kind: PresetAction["kind"]) => {
    const action = newAction(kind, actionLabels[kind]);
    actionToFocus.current = action.id;
    setAddedActionId(action.id);
    setDraft((current) => ({
      ...current,
      actions: [...current.actions, action],
    }));
  };
  const focusAddedAction = () => {
    const actionId = actionToFocus.current;
    actionToFocus.current = null;
    if (actionId) document.getElementById(`${id}-${actionId}-label`)?.focus();
  };
  const fields = (
    <>
      {dialog?.error && (
        <p role="alert" className="inline-error">
          {dialog.error}
        </p>
      )}
      <ModalTitleActions>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy || !bridge.desktop}
          onClick={() => setTemplateOpen(true)}
        >
          <FileInputIcon aria-hidden="true" />
          {t("templates.import")}
        </Button>
      </ModalTitleActions>
      <form
        id={`${id}-form`}
        className="service-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (hasServiceTarget)
            onSave({
              ...draft,
              actions: draft.actions.map((action) => {
                if (!action.invocation) return action;
                const invocation = normalizeInvocation(action.invocation);
                return {
                  ...action,
                  invocation,
                  command: renderInvocation(invocation),
                };
              }),
              executionHostId: "",
              ruleIds: draft.ruleIds.filter((id) =>
                data.rules.some((rule) => rule.id === id),
              ),
            });
        }}
      >
        <div className="service-editor-profile">
          <ConnectionIconPicker
            fieldLabel={t("serviceIcon")}
            initialCategory="service"
            value={draft.icon ?? null}
            color={draft.color ?? null}
            avatar={{
              fallbackIcon: { kind: "builtin", value: "boxes" },
              colorLabel: t("serviceColor"),
              resetLabel: t("defaultServiceIcon"),
              onColorChange: (color) =>
                setDraft((current) => ({ ...current, color })),
            }}
            onChange={(icon) => setDraft((current) => ({ ...current, icon }))}
          />
          <label className="field" htmlFor={`${id}-name`}>
            <span>{t("name")}</span>
            <Input
              id={`${id}-name`}
              required
              maxLength={256}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
        </div>

        <fieldset className="service-editor-connection">
          <legend>{t("hostConnectionSection", { ns: "tunnel" })}</legend>
          <div className="service-editor-endpoint">
            <label className="field" htmlFor={`${id}-port`}>
              <span>{t("servicePort")}</span>
              <Input
                id={`${id}-port`}
                type="number"
                min={1}
                required={needsPort}
                max={65535}
                value={draft.port ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    port: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            <div className="field">
              <span>{t("serviceProtocol", { ns: "tunnel" })}</span>
              <Select
                value={draft.directProtocol ?? "auto"}
                items={protocolOptions}
                onValueChange={(value) => {
                  if (value)
                    setDraft({
                      ...draft,
                      directProtocol:
                        value === "auto" ? null : (value as DirectProtocol),
                    });
                }}
              >
                <SelectTrigger
                  aria-label={t("serviceProtocol", { ns: "tunnel" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {protocolOptions.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {needsPort && !draft.port && (
            <p className="inline-error">{t("servicePortRequired")}</p>
          )}
          {draft.port !== service.port && affectedRules.length > 0 && (
            <p className="muted">
              {t("linkedForwards")} ·{" "}
              {affectedRules.map((rule) => rule.name).join(", ")}
            </p>
          )}
        </fieldset>

        <section
          className="service-editor-commands"
          aria-labelledby={`${id}-commands`}
        >
          <div className="service-editor-section-header">
            <h3 id={`${id}-commands`}>{t("editorCommands")}</h3>
            <div className="service-editor-command-actions">
              {!managed && systemdTarget && foregroundStart.length === 1 && !foregroundStart[0].systemdLaunch && foregroundStart[0].command.trim() && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || configuringSystemd || draft.actions.length > 29}
                  onClick={() => void configureSystemd()}
                >
                  {t("manageWithSystemd")}
                </Button>
              )}
              <DropdownMenu
                onOpenChangeComplete={(open) => {
                  if (!open) focusAddedAction();
                }}
              >
                <DropdownMenuTrigger
                  render={<Button type="button" size="sm" variant="outline" />}
                  disabled={busy || draft.actions.length >= 32}
                >
                  <PlusIcon aria-hidden="true" />
                  {t("editorAddCommand")}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  finalFocus={() => !actionToFocus.current}
                >
                  {commandKinds.map((kind) => {
                    const Icon = commandIcons[kind];
                    return (
                      <DropdownMenuItem
                        key={kind}
                        onClick={() => addAction(kind)}
                      >
                        <Icon aria-hidden="true" />
                        {actionLabels[kind]}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {managedUnit && (
            <p className="muted">{t("managedBySystemd", { unit: managedUnit })}</p>
          )}
          {draft.actions.map((action, index) => (
            <details
              className="editor-disclosure service-command-item"
              key={action.id}
              open={addedActionId === action.id || undefined}
              onInvalidCapture={(event) => {
                event.currentTarget.open = true;
              }}
            >
              <summary>
                <span className="service-command-summary-label">
                  <span>{action.label || actionLabels[action.kind]}</span>
                  {action.label &&
                    action.label !== actionLabels[action.kind] && (
                      <small>{actionLabels[action.kind]}</small>
                    )}
                </span>
                <ChevronDownIcon size={16} aria-hidden="true" />
              </summary>
              <fieldset className="preset-action-editor command-action-editor">
                <legend className="sr-only">
                  {action.label || actionLabels[action.kind]}
                </legend>
                <div className="preset-action-heading command-action-header">
                  <div className="field">
                    <span>{t("kindLabel")}</span>
                    <Select
                      items={commandKinds.map((kind) => ({
                        value: kind,
                        label: t(`kind.${kind}`),
                      }))}
                      value={action.kind}
                      disabled={!!action.systemdLaunch}
                      onValueChange={(kind) => {
                        if (kind)
                          updateAction(
                            index,
                            changeActionKind(
                              action,
                              kind as PresetAction["kind"],
                              actionLabels,
                            ),
                          );
                      }}
                    >
                      <SelectTrigger aria-label={t("kindLabel")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {commandKinds.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {t(`kind.${kind}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="field" htmlFor={`${id}-${action.id}-label`}>
                    <span>{t("actionName")}</span>
                    <Input
                      id={`${id}-${action.id}-label`}
                      required
                      maxLength={256}
                      value={action.label}
                      onChange={(e) =>
                        updateAction(index, { label: e.target.value })
                      }
                    />
                  </label>
                  <div className="field command-execution-field">
                    <span>{t("mode", { ns: "terminal" })}</span>
                    <Select
                      value={action.mode || "command"}
                      disabled={!!action.systemdLaunch}
                      items={[
                        {
                          value: "command",
                          label: t("modeCommand", { ns: "terminal" }),
                        },
                        {
                          value: "terminal",
                          label: t("modeTerminal", { ns: "terminal" }),
                        },
                      ]}
                      onValueChange={(mode) =>
                        updateAction(index, {
                          mode: mode as "command" | "terminal",
                        })
                      }
                    >
                      <SelectTrigger aria-label={t("mode", { ns: "terminal" })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="command">
                          {t("modeCommand", { ns: "terminal" })}
                        </SelectItem>
                        <SelectItem value="terminal">
                          {t("modeTerminal", { ns: "terminal" })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="destructive"
                    aria-label={`${t("removeAction")} ${action.label}`}
                    disabled={busy}
                    onClick={() => {
                      structuredDrafts.current.delete(action.id);
                      setDraft({
                        ...draft,
                        actions: draft.actions.filter((_, i) => i !== index),
                      });
                    }}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
                <Tabs
                  value={isStructuredCommand(action) ? "command" : "script"}
                  onValueChange={(format) => {
                    if (format !== "script" && format !== "command") return;
                    const drafts = structuredDrafts.current;
                    if (
                      format === "script" &&
                      isStructuredCommand(action) &&
                      action.invocation
                    )
                      drafts.set(action.id, action.invocation);
                    const updated = switchActionFormat(
                      action,
                      format,
                      drafts.get(action.id),
                    );
                    if (format === "command") drafts.delete(action.id);
                    updateAction(index, updated);
                  }}
                >
                  <div className="service-command-format">
                    <span className="parameter-title">
                      {t("command")}
                      <InfoTooltip
                        label={t("command")}
                        description={
                          isStructuredCommand(action)
                            ? t("scriptHint")
                            : `${t("commandVariableHint")} ${t("scriptHint")}`
                        }
                      />
                    </span>
                    <TabsList variant="soft" aria-label={t("builder.mode")}>
                      <TabsTrigger value="script" disabled={busy}>
                        {t("builder.script")}
                      </TabsTrigger>
                      <TabsTrigger value="command" disabled={busy}>
                        {t("builder.title")}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent
                    value="command"
                    className="service-command-mode-panel"
                  >
                    {isStructuredCommand(action) && action.invocation && (
                      <>
                        <CommandInvocationEditor
                          value={action.invocation}
                          variables={{
                            port: draft.port,
                            active: !!action.servicePortVariable,
                          }}
                          disabled={busy}
                          onChange={(invocation, insertedVariable) =>
                            updateAction(index, {
                              invocation,
                              command: renderInvocation(
                                normalizeInvocation(invocation),
                              ),
                              servicePortVariable:
                                insertedVariable || action.servicePortVariable,
                            })
                          }
                        />
                        <pre
                          className="preset-script service-command-preview"
                          data-selectable="true"
                        >
                          <CommandVariableText
                            view={displayInvocation(
                              normalizeInvocation(action.invocation),
                              !!action.servicePortVariable,
                              draft.port
                                ? String(draft.port)
                                : t("servicePort"),
                            )}
                            name={t("servicePort")}
                          />
                        </pre>
                      </>
                    )}
                  </TabsContent>
                  <TabsContent
                    value="script"
                    className="service-command-mode-panel"
                  >
                    <CommandVariableField
                      id={`${id}-${action.id}-command`}
                      label={t("command")}
                      description={`${id}-${action.id}-hint`}
                      value={actionScript(action)}
                      format={(text) =>
                        readableShellSource(text, !!action.servicePortVariable)
                      }
                      port={draft.port}
                      active={!!action.servicePortVariable}
                      multiline
                      required
                      disabled={busy}
                      onChange={(script, insertedVariable) =>
                        updateAction(index, {
                          ...editActionScript(action, script),
                          servicePortVariable:
                            insertedVariable || action.servicePortVariable,
                          confirm: ["stop", "restart", "custom"].includes(
                            action.kind,
                          ),
                        })
                      }
                    />
                  </TabsContent>
                </Tabs>
                {!isStructuredCommand(action) && (
                  <p id={`${id}-${action.id}-hint`} className="sr-only">
                    {t("commandVariableHint")}
                  </p>
                )}
                <fieldset className="command-execution-options">
                  <legend>{t("editorExecutionOptions")}</legend>
                  <div className="command-action-options">
                    <div className="field">
                      <span className="parameter-title">
                        <label htmlFor={`${id}-${action.id}-timeout`}>
                          {t("timeout")}
                        </label>
                        {allowsUnlimitedAction(action, draft.control?.startActionId) && (
                          <InfoTooltip
                            label={t("review.timeout")}
                            description={t("terminalTimeout")}
                          />
                        )}
                      </span>
                      <Input
                        id={`${id}-${action.id}-timeout`}
                        type="number"
                        required
                        min={allowsUnlimitedAction(action, draft.control?.startActionId) ? 0 : 1}
                        max={3600}
                        value={action.timeoutSecs}
                        onChange={(e) =>
                          updateAction(index, {
                            timeoutSecs: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <ParameterField
                      label={t("review.successCodes")}
                      description={t("successCodes")}
                    >
                      <Input
                        required
                        pattern="[0-9]+(,[0-9]+)*"
                        defaultValue={action.successCodes.join(",")}
                        onChange={(e) =>
                          updateAction(index, {
                            successCodes: e.target.value.split(",").map(Number),
                          })
                        }
                      />
                    </ParameterField>
                    <label
                      className="field"
                      htmlFor={`${id}-${action.id}-confirm`}
                    >
                      <span>{t("confirm")}</span>
                      <div className="command-switch-control">
                        <Switch
                          id={`${id}-${action.id}-confirm`}
                          checked={action.confirm}
                          onCheckedChange={(confirm) =>
                            updateAction(index, { confirm })
                          }
                        />
                      </div>
                    </label>
                  </div>
                </fieldset>
                <CommandEnvironmentEditor
                  value={action.invocation?.environment || []}
                  disabled={busy}
                  onChange={(environment) =>
                    updateAction(
                      index,
                      editActionEnvironment(action, environment),
                    )
                  }
                />
              </fieldset>
            </details>
          ))}
        </section>

        <details
          className="editor-disclosure service-editor-advanced"
          onInvalidCapture={(event) => {
            event.currentTarget.open = true;
          }}
        >
          <summary>
            {t("advanced", { ns: "tunnel" })}
            <ChevronDownIcon size={16} aria-hidden="true" />
          </summary>
          <div className="service-editor-advanced-body">
            <fieldset className="service-advanced-group service-editor-execution">
              <legend>{t("editorExecution")}</legend>
              {serviceHosts.map((host) => (
                <LoginPicker
                  key={host.id}
                  host={host}
                  label={
                    serviceHosts.length > 1
                      ? `${host.name} · ${t("editorLogin")}`
                      : t("editorLogin")
                  }
                  value={draft.loginByHost?.[host.id]}
                  hostDefault={{
                    label: t("followHostCredential", { user: resolvedDefaultLogin(host)?.user ?? host.user }),
                    select: () => setDraft((current) => {
                      const loginByHost = { ...current.loginByHost };
                      delete loginByHost[host.id];
                      return { ...current, loginByHost };
                    }),
                  }}
                  change={(login) =>
                    setDraft((current) => ({
                      ...current,
                      loginByHost: { ...current.loginByHost, [host.id]: login },
                    }))
                  }
                />
              ))}
              <label
                className="field service-switch-field service-advanced-switch"
                htmlFor={`${id}-env`}
              >
                {t("noEnvironment")}
                <Switch
                  id={`${id}-env`}
                  checked={draft.noLocalEnvironment}
                  onCheckedChange={(noLocalEnvironment) =>
                    setDraft((current) => ({ ...current, noLocalEnvironment }))
                  }
                />
              </label>
            </fieldset>
            <ControlEditor
              service={draft}
              onChange={(control) =>
                setDraft((current) => ({ ...current, control }))
              }
            />
          </div>
        </details>
        <ModalActions>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form={`${id}-form`}
            disabled={busy || !hasServiceTarget}
          >
            {t("save")}
          </Button>
        </ModalActions>
      </form>
      <AnimatePresence>
        {templateOpen && (
          <ServiceTemplateDialog
            key="service-template"
            close={() => setTemplateOpen(false)}
            apply={(template) => {
              structuredDrafts.current.clear();
              setDraft((current) => fillServiceTemplate(current, template));
              setTemplateOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
  return dialog ? (
    <Modal
      title={dialog.title}
      description={dialog.description}
      close={dialog.close}
      disablePointerDismissal
      className="service-editor-modal max-w-lg sm:max-w-lg"
    >
      {fields}
    </Modal>
  ) : (
    fields
  );
}
export function CommandResult({
  data,
  onRerun,
  onRetry,
  run,
  accept,
  onCancel,
  onError,
  terminating = false,
  autoPromptCredentials = false,
  onCredentialsPrompt,
}: {
  data?: Snapshot;
  onRerun?: (run: CommandRun) => void;
  onRetry?: (run: CommandRun) => void;
  run: CommandRun;
  accept: (r: CommandRun) => void;
  onCancel: () => void;
  onError: (s: string) => void;
  terminating?: boolean;
  autoPromptCredentials?: boolean;
  onCredentialsPrompt?: () => void;
}) {
  const { t, i18n } = useTranslation("commands");
  const observations = useServiceObservations(true);
  const [view, setView] = useState({ run, text: "" });
  const [stream, setStream] = useState<"all" | "stdout" | "stderr">("all");
  const [outputMode, setOutputMode] = useState<"formatted" | "raw">("formatted");
  const [output, setOutput] = useState({ all: "", stdout: "", stderr: "" });
  const follow = useRef(true),
    outputViewport = useRef<HTMLDivElement>(null);
  const modeScrollTop = useRef<number | null>(null);
  const clearAt = useRef(0);
  const lastSequence = useRef(0);
  const resetDisplay = useRef(false);
  useEffect(() => {
    let live = true;
    const decoder = new OutputDecoder(),
      stdout = new OutputDecoder(),
      stderr = new OutputDecoder();
    const channel = new bridge.Channel<CommandEvent>();
    channel.onmessage = (event) => {
      if (!live) return;
      lastSequence.current = Math.max(
        lastSequence.current,
        ...event.output.map((c) => c.sequence),
      );
      const visible = {
        ...event,
        reset: event.reset || resetDisplay.current,
        output: event.output.filter((c) => c.sequence > clearAt.current),
      };
      resetDisplay.current = false;
      const text = decoder.accept(visible);
      setOutput({
        all: text,
        stdout: stdout.accept({
          ...visible,
          output: visible.output.filter((c) => c.stream === "stdout"),
        }),
        stderr: stderr.accept({
          ...visible,
          output: visible.output.filter((c) => c.stream === "stderr"),
        }),
      });
      setView({ run: event.run, text });
      accept(event.run);
    };
    void bridge.attachCommand(run.id, channel).catch((e) => {
      if (live) onError(String(e));
    });
    return () => {
      live = false;
      void bridge.detachCommand(run.id).catch(() => {});
    };
  }, [run.id, accept, onError]);
  useEffect(() => {
    void bridge.ackCommand(run.id, view.run.revision).catch(() => {});
  }, [run.id, view]);
  useLayoutEffect(() => {
    const viewport = outputViewport.current;
    if (!viewport) return;
    if (modeScrollTop.current !== null) {
      viewport.scrollTop = modeScrollTop.current;
      modeScrollTop.current = null;
    } else if (follow.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [output, stream, outputMode]);
  const current =
    view.run.id === run.id && view.run.revision >= run.revision
      ? view.run
      : run;
  const active = commandActive(current);
  const cancelled = current.phase === "cancelled";
  const hasExitResult = !cancelled && current.phase !== "timedOut" && current.phase !== "unknown";
  const unconfirmed = cancelled && current.error === "remoteUnknown";
  const canRetry = data && onRetry && failedCommandRetryTarget(data, current);
  const error =
    cancelled ||
    (current.error === "exitCode" && current.exitCode !== null) ||
    (current.error === "exitSignal" && current.exitSignal)
      ? null
      : current.error;
  const tone = active
    ? current.phase === "foreground-running" ? "success" : "pending"
    : current.phase === "succeeded"
      ? "success"
      : current.phase === "failed"
        ? "danger"
        : current.phase === "timedOut" || current.phase === "unknown"
          ? "warning"
          : undefined;
  const started = new Date(current.startedAt);
  const finished =
    current.finishedAt === null ? undefined : new Date(current.finishedAt);
  const startLabel = started.toLocaleString(i18n.resolvedLanguage);
  const steps = current.steps ?? [];
  const showSteps =
    steps.length > 1 ||
    steps.some(
      (step) =>
        step.attempt > 1 ||
        (step.error && step.error !== current.error) ||
        (step.exitCode !== null && step.exitCode !== current.exitCode),
    );
  const showReadiness =
    current.phase === "succeeded" &&
    steps.some((step) => step.kind === "start" || step.kind === "restart") &&
    !steps.some((step) => step.kind === "health" && step.phase === "succeeded");
  const reachableAt = current.phase === "foreground-running"
    ? serviceForwardReachableAt(data, current, current.workflowRuleId)
    : undefined;
  const observation = observations.find(
    (item) =>
      item.serviceId === current.serviceId &&
      item.serviceRevision === current.serviceRevision &&
      item.hostId === current.hostId &&
      item.loginId === current.loginId &&
      (item.ruleId ?? null) === (current.workflowRuleId ?? null),
  );
  const formatMiB = (bytes: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      maximumFractionDigits: 2,
    }).format(bytes / 1048576);

  return (
    <section className="preset-result" aria-label={t("output")}>
      <header className="command-result-header">
        <div className="command-result-summary">
          <div className="command-result-status" role="status">
            <span className="command-result-phase">
              <span
                className="terminal-tab-indicator"
                data-tone={tone}
                aria-hidden="true"
              />
              {t(`phase.${current.phase}`)}
            </span>
            {finished && (
              <span>
                {t("review.seconds", {
                  count: Math.max(
                    0,
                    Math.round((finished.getTime() - current.startedAt) / 1000),
                  ),
                })}
              </span>
            )}
            {hasExitResult && current.exitCode !== null && (
              <span>
                {t("exitCode")} {current.exitCode}
              </span>
            )}
            {hasExitResult && current.exitSignal && (
              <span>{current.exitSignal}</span>
            )}
          </div>
          <div className="command-result-meta">
            <code data-selectable="true">{current.endpoint}</code>
            <span
              title={
                finished
                  ? `${startLabel} → ${finished.toLocaleString(i18n.resolvedLanguage)}`
                  : startLabel
              }
            >
              <time dateTime={started.toISOString()}>
                {started.toLocaleTimeString(i18n.resolvedLanguage)}
              </time>
              {finished && (
                <>
                  {" → "}
                  <time dateTime={finished.toISOString()}>
                    {finished.toLocaleTimeString(i18n.resolvedLanguage)}
                  </time>
                </>
              )}
            </span>
            {reachableAt !== undefined && (
              <span title={`${t("service.checkedAt")} ${new Date(reachableAt).toLocaleString(i18n.resolvedLanguage)}`}>
                {t("target-reachable", { ns: "tunnel" })}
              </span>
            )}
          </div>
        </div>
        {active ? (
          <Button type="button" size="xs" variant="outline" disabled={terminating} onClick={onCancel}>
            {t(terminating ? "terminating" : "terminateCommand")}
          </Button>
        ) : canRetry ? (
          <Button type="button" size="xs" variant="outline" onClick={() => onRetry(current)}>
            <RotateCwIcon aria-hidden="true" />
            {t("retryCommand")}
          </Button>
        ) : null}
      </header>
      {unconfirmed && <p className="muted command-result-error">{t("terminationUnconfirmed")}</p>}
      {error && (
        <p className="inline-error command-result-error" role="alert">
          {formatUiError(error, t)}
        </p>
      )}
      {data && onRerun && (
        <CredentialRetry
          data={data}
          run={current}
          onRun={onRerun}
          onError={onError}
          autoPrompt={autoPromptCredentials}
          onPrompt={onCredentialsPrompt}
        />
      )}
      <ServiceState observation={observation} />
      {(showSteps || showReadiness) && (
        <details className="editor-disclosure command-result-details">
          <summary>
            {t("resultDetails")}
            <ChevronDownIcon size={14} aria-hidden="true" />
          </summary>
          {showSteps && (
            <ol className="service-steps" aria-label={t("service.steps")}>
              {steps.map((step, index) => (
                <li key={index}>
                  <span>
                    {t(`service.step.${step.kind}`, {
                      defaultValue: t(`kind.${step.kind}`),
                    })}
                  </span>
                  <span>
                    {t(`phase.${step.phase}`)}
                    {step.attempt > 1 &&
                      ` · ${t("service.attempts", { count: step.attempt })}`}
                    {step.phase !== "timedOut" && step.phase !== "cancelled" && step.exitCode !== null &&
                      ` · ${t("exitCode")} ${step.exitCode}`}
                  </span>
                  {step.error && step.error !== current.error && (
                    <small className="inline-error">
                      {formatUiError(step.error, t)}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          )}
          {showReadiness && <p className="muted">{t("notReadiness")}</p>}
        </details>
      )}
      {current.workflowRuleId &&
        current.actionId.startsWith("$connect") &&
        (!active || current.workflowForwardCreated) && (
          <div className="command-result-forward">
            <span className="muted">
              {t(
                current.workflowForwardCreated
                  ? "service.createdForward"
                  : "service.preserveForward",
              )}
            </span>
            {current.workflowForwardCreated && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  void bridge
                    .stopServiceForward(current.id)
                    .catch((e) => onError(formatUiError(String(e), t)))
                }
              >
                {t("service.stopForward")}
              </Button>
            )}
          </div>
        )}
      <Tabs
        className="command-output-tabs"
        value={stream}
        onValueChange={(value) => {
          if (value === "all" || value === "stdout" || value === "stderr") {
            follow.current = true;
            setStream(value);
          }
        }}
      >
        <div className="command-output-toolbar">
          <TabsList variant="soft" aria-label={t("output")}>
            <TabsTrigger value="all">{t("allOutput")}</TabsTrigger>
            <TabsTrigger value="stdout">stdout</TabsTrigger>
            <TabsTrigger value="stderr">stderr</TabsTrigger>
          </TabsList>
          <div className="command-output-actions">
            <ToggleGroup<"formatted" | "raw">
              className="command-output-mode"
              aria-label={t("outputMode")}
              value={[outputMode]}
              onValueChange={([mode]) => {
                if (!mode || mode === outputMode) return;
                modeScrollTop.current = outputViewport.current?.scrollTop ?? null;
                setOutputMode(mode);
              }}
            >
              <Toggle value="formatted">{t("formattedOutput")}</Toggle>
              <Toggle value="raw">{t("rawOutput")}</Toggle>
            </ToggleGroup>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={!output.all}
              onClick={() => {
                clearAt.current = lastSequence.current;
                resetDisplay.current = true;
                setOutput({ all: "", stdout: "", stderr: "" });
              }}
            >
              <EraserIcon aria-hidden="true" />
              {t("clear")}
            </Button>
          </div>
        </div>
        {current.truncated && (
          <p className="muted command-output-truncated">
            {t("truncated")}
            {(current.discardedBytes ?? 0) > 0 &&
              ` ${t("sharing.outputStats", {
                retained: formatMiB(current.outputBytes ?? 0),
                discarded: formatMiB(current.discardedBytes ?? 0),
              })}`}
          </p>
        )}
        {(["all", "stdout", "stderr"] as const).map((value) => (
          <TabsContent key={value} value={value} className="command-output-tab">
            {stream === value && (
              <div
                ref={outputViewport}
                className="preset-output"
                data-selectable="true"
                data-empty={output[value] ? undefined : ""}
                tabIndex={0}
                role="region"
                aria-label={t("output")}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 32;
                }}
              >
                {!output[value] ? (
                  t("noOutput")
                ) : outputMode === "formatted" ? (
                  <CommandOutputText text={output[value]} />
                ) : (
                  <pre className="command-log-text">{output[value]}</pre>
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
