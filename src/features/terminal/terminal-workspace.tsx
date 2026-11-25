import { defaultLoginId, resolvedLogin } from "../hosts/login-identities";
import { formatUiError } from "@/lib/ui-message";
import { serviceLoginId, serviceTarget } from "@/features/commands/service-target";
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  SquareTerminalIcon,
  XIcon,
  PanelsTopLeftIcon,
  GripVerticalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Modal, ModalActions } from "@/components/tunnel-form";
import { TerminalTargets } from "./terminal-targets";
import { AuthenticationField } from "@/features/hosts/authentication-field";
import { addedHosts } from "@/features/hosts/host-collection";
import { jumpHosts } from "@/features/tunnels/rule-model";
import { CommandResult } from "@/features/commands/preset-commands";
import { commandActive, mergeRuns, serviceForwardReachableAt } from "@/features/commands/command-model";
import { rememberBackgroundService, systemdService } from "@/features/commands/systemd-service";
import * as bridge from "@/lib/bridge";
import type {
  CommandRun,
  Host,
  PresetAction,
  RemoteService,
  Snapshot,
  TerminalSession,
} from "@/types";
import {
  mergeSessions,
  terminalActive,
  type TerminalTabControls,
  unsubmittedPreset,
  terminalNeedsCredentials,
  terminalStateTone,
  serviceForegroundSession,
} from "./terminal-model";
import { PaneIdentity } from "./pane-identity";
import { TerminalSplitPanels } from "./terminal-split-panels";
import {
  movePane,
  paneKeys,
  reconcileGroups,
  type PaneDrop,
  type TerminalGroup,
  type SplitSide,
} from "./terminal-splits";
import { usePaneDrag } from "./use-pane-drag";
import { terminalTabScrollEdges } from "./workspace-layout";
import { workspaceLayoutKey } from "@/components/ui/workspace-layout";
import { useWorkspacePanel } from "@/components/ui/use-workspace-panel";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { SavedCommandsButton, SavedCommandsProvider } from "./saved-commands";
const TerminalView = lazy(() => import("./terminal-view"));
interface WorkspaceApi {
  openHost: (hostId?: string) => void;
  openPreset: (
    service: RemoteService,
    action: PresetAction,
    secrets: Record<string, string>,
    rememberHostIds: string[],
    ruleId?: string, loginId?: string,
  ) => Promise<void>;
  showCommand: (run: CommandRun, onRetry?: (run: CommandRun) => void) => void;
  revealCommand: (run: CommandRun, onRetry?: (run: CommandRun) => void) => void;
  revealSession: (id: string) => void;
  terminateCommand: (id: string) => void;
  commandTerminating: (id: string) => boolean;
  serviceBusy: (id: string) => boolean;
  busy: boolean;
  foregroundSession: (
    service: RemoteService,
    ruleId?: string,
  ) => TerminalSession | undefined;
  stopService: (service: RemoteService, ruleId?: string) => Promise<void>;
}
const Context = createContext<WorkspaceApi | null>(null);
export const useTerminalWorkspace = () => useContext(Context);

// Keep pointer-driven bounds updates in the panel. Its tabs and session portals
// can keep the same React children throughout a drag.
function TerminalPanel({
  open,
  panelRef,
  ...props
}: Omit<ComponentProps<typeof WorkspacePanel>, "panel"> & {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const panel = useWorkspacePanel({ open, storageKey: workspaceLayoutKey });
  useImperativeHandle(panelRef, () => panel.ref.current!, [panel.ref]);
  return <WorkspacePanel {...props} panel={panel} />;
}

export function OpenTerminalButton({
  hostId,
  disabled,
  workspace = false,
  onOpen,
  className,
}: {
  hostId?: string;
  disabled?: boolean;
  workspace?: boolean;
  onOpen?: () => void;
  className?: string;
}) {
  const api = useTerminalWorkspace();
  const { t } = useTranslation("terminal");
  if (!api) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={["nodrag nopan", className].filter(Boolean).join(" ")}
      aria-label={t(workspace ? "workspace" : "open")}
      title={t(workspace ? "workspace" : "open")}
      disabled={!bridge.desktop || disabled}
      onClick={() => {
        onOpen?.();
        api.openHost(hostId);
      }}
    >
      <SquareTerminalIcon aria-hidden="true" />
    </Button>
  );
}
export function TerminalWorkspaceProvider({
  data,
  viewerSessions,
  preferredHost,
  onChooseHost,
  commandSettingsActive = false,
  openCommandSettings,
  children,
}: {
  data:
    | Snapshot
    | Pick<Snapshot, "hosts" | "addedHostIds" | "rules" | "services">;
  viewerSessions?: TerminalSession[];
  preferredHost?: string;
  onChooseHost?: (id: string) => void;
  commandSettingsActive?: boolean;
  openCommandSettings?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("terminal");
  const [clientId] = useState(() => crypto.randomUUID());
  const [sessions, setSessions] = useState<TerminalSession[]>([]),
    [commands, setCommands] = useState<CommandRun[]>([]);
  const [commandTabs, setCommandTabs] = useState<string[]>([]);
  const [commandClose, setCommandClose] = useState<{
    id: string;
    choice?: "terminate" | "background";
  } | null>(null);
  const [terminatingCommands, setTerminatingCommands] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const keepCommandFocus = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [tabEdges, setTabEdges] = useState({ left: false, right: false });
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{
    hostId: string;
    loginId?: string;
    noEnvironment: boolean;
    fallback: boolean;
    replaceId?: string;
    profile?: { service: RemoteService; action: PresetAction; ruleId?: string; loginId?:string };
  } | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({}),
    [remember, setRemember] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<{
      group: boolean;
      ids: string[];
    } | null>(null),
    [busy, setBusy] = useState(false);
  const tabControls = useRef(new Map<string, TerminalTabControls>());
  const submitting = useRef(false),
    requests = useRef(new Map<string, string>()),
    dismissed = useRef(new Set<string>());
  const tabKeys = useRef(new Map<string, string>());
  const replacementRequests = useRef(new Map<string, string>());
  const automaticAuthRequests = useRef(new Map<string, string | undefined>());
  const promptedSessions = useRef(new Set<string>());
  const automaticCommandAuth = useRef(new Set<string>());
  const commandRetry = useRef<(run: CommandRun) => void>(null);
  const merge = useCallback((next: TerminalSession[]) => {
    const replacements = new Map(replacementRequests.current);
    for (const session of next) {
      const previousId = replacements.get(session.requestId);
      if (previousId && previousId !== session.id) {
        dismissed.current.add(previousId);
        tabKeys.current.set(
          session.id,
          tabKeys.current.get(previousId) || previousId,
        );
        setSelected((id) => (id === previousId ? session.id : id));
      }
    }
    setSessions((old) =>
      mergeSessions(old, next, replacements, dismissed.current),
    );
  }, []);
  const acceptCommand = useCallback(
    (run: CommandRun) => setCommands((old) => mergeRuns(old, [run])),
    [],
  );
  const fail = useCallback((message: string) => setError(message), []);
  const viewer = viewerSessions !== undefined;
  useEffect(() => {
    if (viewerSessions) merge(viewerSessions);
  }, [merge, viewerSessions]);
  useEffect(() => {
    if (!bridge.desktop || viewer) return;
    let live = true;
    const terminals = listen<TerminalSession[]>(
      "terminal://sessions",
      (e) => {
        if (live) merge(e.payload);
      },
      { target: "main" },
    );
    const jobs = listen<CommandRun[]>("command://runs", (e) => {
      if (live) setCommands((old) => mergeRuns(old, e.payload));
    });
    void terminals
      .then(() => bridge.terminalSessions())
      .then((next) => {
        if (live) merge(next);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    void jobs
      .then(() => bridge.commandRuns())
      .then((next) => {
        if (live) setCommands((old) => mergeRuns(old, next));
      })
      .catch(() => {});
    return () => {
      live = false;
      void terminals.then((off) => off()).catch(() => {});
      void jobs.then((off) => off()).catch(() => {});
    };
  }, [merge, viewer]);
  const revealCommand = useCallback(
    (run: CommandRun, onRetry?: (run: CommandRun) => void) => {
      if (onRetry) commandRetry.current = onRetry;
      acceptCommand(run);
      setCommandTabs((ids) => (ids.includes(run.id) ? ids : [...ids, run.id]));
      setSelected(run.id);
      setExpanded(true);
    },
    [acceptCommand],
  );
  const showCommand = useCallback(
    (run: CommandRun, onRetry?: (run: CommandRun) => void) => {
      automaticCommandAuth.current.add(run.id);
      revealCommand(run, onRetry);
    },
    [revealCommand],
  );
  const removeCommandTab = useCallback((id: string) => {
    setCommandTabs((ids) => ids.filter((value) => value !== id));
    setSelected((current) =>
      current === id
        ? sessions[0]?.id || commandTabs.find((value) => value !== id) || ""
        : current,
    );
  }, [commandTabs, sessions]);
  const terminateCommand = useCallback((id: string) => {
    if (terminatingCommands.includes(id)) return;
    setTerminatingCommands((ids) => [...ids, id]);
    void bridge.cancelCommand(id).catch((error) => {
      setTerminatingCommands((ids) => ids.filter((value) => value !== id));
      setCommandClose((close) => close?.id === id ? null : close);
      setError(String(error));
    });
  }, [terminatingCommands]);
  const closingCommand = commands.find((run) => run.id === commandClose?.id);
  const closingService = "runtimes" in data
    ? data.services?.find((service) =>
        service.id === closingCommand?.serviceId &&
        service.revision === closingCommand.serviceRevision &&
        service.executionEnabled !== false,
      )
    : undefined;
  const closingRuleId = closingCommand && (closingCommand.workflowRuleId ?? `host:${closingCommand.hostId}`);
  const closingTarget = closingService && serviceTarget(closingService, data, closingRuleId);
  const closingProfile = data.hosts.find((host) => host.id === closingTarget?.hostId);
  const closingHost = closingCommand && resolvedLogin(
    closingProfile,
    serviceLoginId(closingService, closingProfile, closingCommand.loginId),
  );
  const lifecycle = systemdService(closingService);
  const managedClose = closingHost && closingCommand && lifecycle?.startId === closingCommand.actionId &&
    closingHost.id === closingCommand.hostId &&
    closingCommand.endpoint === `${closingHost.user}@${closingHost.address}:${closingHost.port}`
    ? lifecycle : undefined;
  useEffect(() => {
    setTerminatingCommands((ids) => {
      const pending = ids.filter((id) => commands.some((run) => run.id === id && commandActive(run)));
      return pending.length === ids.length ? ids : pending;
    });
    if (!commandClose?.choice || !closingCommand || commandActive(closingCommand)) return;
    setCommandClose(null);
    if (commandClose.choice === "terminate" && managedClose && closingService) {
      void bridge.startCommand({
        serviceId: closingService.id,
        revision: closingService.revision,
        actionId: managedClose.stop.id,
        ruleId: closingRuleId,
        loginId: closingCommand.loginId,
        requestId: crypto.randomUUID(),
        confirmed: true,
        secrets: {},
        rememberHostIds: [],
      }).then((run) => {
        removeCommandTab(closingCommand.id);
        showCommand(run);
      }).catch((error) => setError(String(error)));
    } else if (commandClose.choice === "background"
      ? !!managedClose && closingCommand.phase === "succeeded"
      : closingCommand.error !== "remoteUnknown") {
      if (commandClose.choice === "background" && managedClose)
        rememberBackgroundService(closingCommand);
      removeCommandTab(closingCommand.id);
    }
  }, [commands, commandClose, closingCommand, closingService, closingRuleId, managedClose, removeCommandTab, showCommand]);
  const openHost = (hostId?: string) => {
    if (expanded) panelRef.current?.focus();
    setExpanded(true);
    setError("");
    if (hostId) {
      return connectHost(hostId);
    }
    if (!selected) setSelected(sessions[0]?.id || commandTabs[0] || "");
  };
  const trayOpen = useRef(openHost);
  useLayoutEffect(() => {
    trayOpen.current = openHost;
  });
  useEffect(() => {
    if (!bridge.desktop || viewer) return;
    let live = true;
    const subscription = listen<{ hostId?: string } | null>(
      "tunnel://open-terminal",
      ({ payload }) => {
        if (live) trayOpen.current(payload?.hostId);
      },
    );
    return () => {
      live = false;
      void subscription.then((off) => off()).catch(() => {});
    };
  }, [viewer]);
  const launch = async (
    hostId: string | null,
    noEnvironment: boolean,
    values: Record<string, string>,
    remembered: string[],
    profile?: { service: RemoteService; action: PresetAction; ruleId?: string; loginId?:string },
    options?: { replaceId?: string; automatic?: boolean; loginId?: string },
  ) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const previous = options?.replaceId
      ? sessions.find((s) => s.id === options.replaceId && !terminalActive(s))
      : undefined;
    if (options?.replaceId && !previous) {
      submitting.current = false;
      setBusy(false);
      return;
    }
    try {
      const loginId = profile
        ? profile.loginId
        : options?.loginId ?? defaultLoginId(data.hosts.find((host) => host.id === hostId));
      const baseKey = profile
        ? `${profile.service.id}:${profile.service.revision}:${profile.action.id}:${hostId}:${loginId || ""}`
        : hostId === null
          ? "local"
          : `shell:${hostId}:${loginId || ""}`;
      const key = previous ? `${baseKey}:replace:${previous.id}` : baseKey;
      const requestId = requests.current.get(key) || crypto.randomUUID();
      requests.current.set(key, requestId);
      if (previous) replacementRequests.current.set(requestId, previous.id);
      if (options?.automatic)
        automaticAuthRequests.current.set(requestId, profile?.service.revision);
      const session =
        hostId === null
          ? await bridge.openLocalTerminal(requestId, clientId, 80, 24)
          : await bridge.openTerminal({
              hostId,
              loginId,
              noLocalEnvironment: profile ? noEnvironment : true,
              clientId,
              requestId,
              cols: 80,
              rows: 24,
              confirmed: true,
              secrets: values,
              rememberHostIds: remembered,
              ...(profile
                ? {
                    serviceId: profile.service.id,
                    ruleId: profile.ruleId,
                    actionId: profile.action.id,
                    revision: profile.service.revision,
                  }
                : {}),
            });
      requests.current.delete(key);
      merge([session]);
      replacementRequests.current.delete(requestId);
      if (previous)
        void bridge
          .forgetTerminal(previous.id, previous.clientId)
          .catch(() => {});
      setSelected(session.id);
      setExpanded(true);
      setDraft(null);
      setSecrets({});
      setRemember({});
    } catch (e) {
      const message = String(e);
      setError(message);
      throw e;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const connectHost = async (hostId: string, replaceId?: string) => {
    setExpanded(true);
    setDraft(null);
    setSecrets({});
    setRemember({});
    await launch(hostId, true, {}, [], undefined, {
      replaceId,
      automatic: true,
    }).catch(() => {});
  };
  const connectLocal = (replaceId?: string) =>
    launch(null, false, {}, [], undefined, { replaceId }).catch(() => {});
  const targets = addedHosts(data).filter((host) => !host.hidden);
  if (preferredHost)
    targets.sort(
      (a, b) => Number(b.id === preferredHost) - Number(a.id === preferredHost),
    );
  const chooseTarget = (host: Host | null) => {
    if (host) {
      onChooseHost?.(host.id);
      void connectHost(host.id);
    } else void connectLocal();
  };
  const openPreset: WorkspaceApi["openPreset"] = async (
    service,
    action,
    values,
    remembered,
    ruleId,loginId,
  ) => {
    const target = serviceTarget(service, data, ruleId);
    if (!target) throw new Error("serviceTargetRequired");
    await launch(
      target.hostId,
      service.noLocalEnvironment,
      values,
      remembered,
      { service, action, ruleId,loginId },
      { automatic: true },
    );
  };
  const close = async (targets: TerminalSession[]) => {
    if (submitting.current || !targets.length) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const results = await Promise.allSettled(
        targets.map(async (session) => {
          if (terminalActive(session)) {
            await tabControls.current.get(session.id)?.logout();
            await bridge.closeTerminal(session.id, session.clientId);
          }
          await bridge.forgetTerminal(session.id, session.clientId);
          dismissed.current.add(session.id);
        }),
      );
      const closed = new Set<string>();
      const failed: string[] = [];
      let message = "";
      results.forEach((result, i) => {
        const id = targets[i].id;
        if (result.status === "fulfilled") closed.add(id);
        else {
          failed.push(id);
          message ||= String(result.reason);
        }
      });
      setSessions((old) => old.filter((session) => !closed.has(session.id)));
      const sibling =
        selectedGroup &&
        paneKeys(selectedGroup.tree)
          .map((key) => sessionsByKey.get(key))
          .find((session) => session && !closed.has(session.id));
      setSelected((current) =>
        closed.has(current)
          ? sibling?.id ||
            sessions.find((s) => !closed.has(s.id))?.id ||
            commandTabs[0] ||
            ""
          : current,
      );
      if (failed.length) {
        setClosing((old) => old && { ...old, ids: failed });
        setError(message);
        setExpanded(true);
        if (targets.length === 1) setSelected(failed[0]);
      } else setClosing(null);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const requestClose = async (session: TerminalSession) => {
    const controls = tabControls.current.get(session.id);
    try {
      if (
        session.phase === "running" &&
        terminalActive(session) &&
        ((session.serviceId && session.submitted) ||
          controls?.foreground() ||
          (session.local &&
            !controls?.atPrompt() &&
            (await bridge.localTerminalForeground(
              session.id,
              session.clientId,
            ))))
      ) {
        setError("");
        setClosing({ group: false, ids: [session.id] });
      } else {
        await close([session]);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const sessionsByKey = new Map(
    sessions.map((s) => [tabKeys.current.get(s.id) || s.id, s]),
  );
  const [layout, setLayout] = useState<TerminalGroup[]>([]);
  const groups = reconcileGroups(layout, [...sessionsByKey.keys()]);
  if (groups !== layout) setLayout(groups);
  const selectedCommand = commandTabs.includes(selected)
    ? commands.find((r) => r.id === selected)
    : undefined;
  const selectedSession =
    sessions.find((s) => s.id === selected) ??
    (!selectedCommand ? sessions[0] : undefined);
  const selectedKey =
    selectedSession &&
    (tabKeys.current.get(selectedSession.id) || selectedSession.id);
  const selectedGroup = groups.find(
    (group) => selectedKey && paneKeys(group.tree).includes(selectedKey),
  );
  const activeTab =
    selectedGroup?.tab ?? selectedCommand?.id ?? commandTabs[0] ?? "";
  const focusActiveTerminal = (expectedKey?: string) => {
    if (
      document.querySelector(
        '[role="dialog"][data-open], [role="alertdialog"][data-open]',
      )
    )
      return;
    const pane = panelRef.current?.querySelector<HTMLElement>(
      '.terminal-session-panel[data-active="true"]',
    );
    if (!pane || (expectedKey && pane.dataset.terminalPane !== expectedKey))
      return;
    const input =
      pane.querySelector<HTMLElement>(".shell-edit textarea") ??
      pane.querySelector<HTMLElement>(
        ".ssh-terminal-screen:not(.shell-screen-hidden) .xterm-helper-textarea",
      );
    input?.focus({ preventScroll: true });
  };
  const place = (source: string, drop: PaneDrop) => {
    const session = sessionsByKey.get(source);
    if (!session) return;
    const next = movePane(groups, source, drop, crypto.randomUUID());
    if (next !== groups) {
      setLayout(next);
      setSelected(session.id);
      // WebKit blurs the input when its portal host moves, even if the same pane stays active.
      requestAnimationFrame(() => focusActiveTerminal(source));
    }
  };
  const drag = usePaneDrag(tabListRef, place);
  const closingSessions = closing
    ? sessions.filter((session) => closing.ids.includes(session.id))
    : [];
  if (closing && !busy && !closingSessions.length) setClosing(null);
  const closeButton = (session: TerminalSession, groupMembers?: string[]) => {
    const label = groupMembers
      ? t("closeGroup")
      : t("closeTab") + " " + session.label;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={() => {
          if (!groupMembers) return void requestClose(session);
          setError("");
          setClosing({
            group: true,
            ids: groupMembers.map((key) => sessionsByKey.get(key)!.id),
          });
        }}
      >
        <XIcon aria-hidden="true" />
      </Button>
    );
  };
  const draftHost = data.hosts.find((host) => host.id === draft?.hostId);
  const route = draft?.profile
    ? resolvedLogin(draftHost, serviceLoginId(draft.profile.service, draftHost, draft.profile.loginId))
    : resolvedLogin(draftHost, draft?.loginId ?? defaultLoginId(draftHost));
  const routeHosts = route ? [...jumpHosts(data.hosts, route), route] : [];
  const trust = sessions.find(
    (s) => s.phase === "verifying-host" && terminalActive(s) && s.fingerprint,
  );
  useEffect(() => {
    if (busy || draft || closing || commandClose || trust) return;
    const failed = sessions.find(
      (session) =>
        automaticAuthRequests.current.has(session.requestId) &&
        !promptedSessions.current.has(session.id) &&
        session.clientId === clientId &&
        terminalNeedsCredentials(session, data.hosts) &&
        (!session.serviceId ||
          (!!unsubmittedPreset(session, data.services || []) &&
            unsubmittedPreset(session, data.services || [])?.service
              .revision ===
              automaticAuthRequests.current.get(session.requestId) &&
            ((!session.ruleId &&
              (
                unsubmittedPreset(session, data.services || [])?.service
                  .hostIds || []
              ).includes(session.hostId)) ||
              data.rules.some(
                (r) => r.id === session.ruleId && r.hostId === session.hostId,
              )))),
    );
    if (!failed) return;
    promptedSessions.current.add(failed.id);
    automaticAuthRequests.current.delete(failed.requestId);
    setSelected(failed.id);
    const profile = unsubmittedPreset(failed, data.services || []);
    setDraft({
      hostId: failed.hostId,
      loginId: failed.loginId ?? undefined,
      noEnvironment: profile ? profile.service.noLocalEnvironment : true,
      fallback: true,
      replaceId: failed.id,
      ...(profile ? { profile } : {}),
    });
    setSecrets({});
    setRemember({});
    setError(failed.error || "");
  }, [sessions, data, clientId, busy, draft, closing, commandClose, trust, t]);
  const tabSignature = [
    ...groups.map((group) => group.tab),
    ...commandTabs,
  ].join("\0");
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const update = () => {
      const next = terminalTabScrollEdges(
        list.scrollLeft,
        list.clientWidth,
        list.scrollWidth,
      );
      setTabEdges((previous) =>
        previous.left === next.left && previous.right === next.right
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    list.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [tabSignature, expanded]);
  const latestActions = useRef({ openHost, openPreset, showCommand, close });
  useLayoutEffect(() => {
    latestActions.current = { openHost, openPreset, showCommand, close };
  });
  const workspaceApi = useMemo<WorkspaceApi>(
    () => ({
      openHost: (hostId) => latestActions.current.openHost(hostId),
      openPreset: (...args) => latestActions.current.openPreset(...args),
      showCommand: (...args) => latestActions.current.showCommand(...args),
      revealCommand,
      revealSession: (id) => {
        if (!sessions.some((session) => session.id === id && session.clientId === clientId)) return;
        setSelected(id);
        setExpanded(true);
      },
      terminateCommand,
      commandTerminating: (id) => terminatingCommands.includes(id),
      serviceBusy: (id) =>
        sessions.some(
          (session) => session.serviceId === id && terminalActive(session),
        ),
      busy,
      foregroundSession: (service, ruleId) => {
        const target = serviceTarget(service, { rules: data.rules }, ruleId);
        return target
          ? serviceForegroundSession(
              sessions,
              service,
              target.id,
              clientId,
              target.hostId,
            )
          : undefined;
      },
      stopService: async (service, ruleId) => {
        const target = serviceTarget(service, { rules: data.rules }, ruleId);
        if (!target) return;
        const session = serviceForegroundSession(
          sessions,
          service,
          target.id,
          clientId,
          target.hostId,
        );
        if (session) await latestActions.current.close([session]);
      },
    }),
    [sessions, busy, clientId, data.rules, revealCommand, terminateCommand, terminatingCommands],
  );
  const workspace = (
    <Context.Provider value={workspaceApi}>
      {children}
      <TerminalPanel
        open={expanded}
        panelRef={panelRef}
        title={t("workspace")}
        onClose={() => setExpanded(false)}
        className="terminal-workspace"
        actions={
          <>
            <SavedCommandsButton openSettings={openCommandSettings} />
            <TerminalTargets
              menu
              hosts={targets}
              choose={chooseTarget}
              busy={busy}
            />
          </>
        }
      >
        {error && !draft && (
          <p className="terminal-error" role="alert">
            {formatUiError(error, t)}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("dismiss")}
              onClick={() => setError("")}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </p>
        )}
        {tabSignature ? (
          <Tabs
            className="terminal-tabs"
            value={activeTab}
            onValueChange={(id) => {
              if (typeof id === "string")
                setSelected(sessionsByKey.get(id)?.id ?? id);
            }}
          >
            <TabsList
              ref={tabListRef}
              data-drop={drag.preview?.drop === "tabs" || undefined}
              variant="line"
              className="terminal-tab-list"
              data-fade-left={tabEdges.left}
              data-fade-right={tabEdges.right}
            >
              {groups.map((group) => {
                const s = sessionsByKey.get(group.tab)!;
                const members = paneKeys(group.tree);
                const grouped = members.length > 1;
                const canDock =
                  !grouped &&
                  selectedKey !== undefined &&
                  group.tab !== activeTab;
                const canDockGroup =
                  canDock && typeof selectedGroup?.tree === "object";
                const title = grouped
                  ? members
                      .map((key) => sessionsByKey.get(key)!.label)
                      .join(" · ")
                  : s.endpoint + " · " + t(`phase.${s.phase}`);
                return (
                  <div className="terminal-tab-entry" key={group.tab}>
                    <TabsTrigger
                      value={group.tab}
                      className={canDock ? "terminal-draggable-tab" : undefined}
                      {...(canDock && drag.handle(group.tab, false))}
                      aria-keyshortcuts={
                        canDock
                          ? "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" +
                            (canDockGroup
                              ? " Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
                              : "")
                          : undefined
                      }
                      onKeyDownCapture={(event) => {
                        if (
                          !canDock ||
                          !event.altKey ||
                          (event.shiftKey && !canDockGroup)
                        )
                          return;
                        const sides: Record<string, SplitSide> = {
                          ArrowLeft: "left",
                          ArrowRight: "right",
                          ArrowUp: "top",
                          ArrowDown: "bottom",
                        };
                        const side = sides[event.key];
                        if (side) {
                          event.preventDefault();
                          event.stopPropagation();
                          place(group.tab, {
                            scope: event.shiftKey ? "group" : "pane",
                            target:
                              event.shiftKey && selectedGroup
                                ? selectedGroup.tab
                                : selectedKey,
                            side,
                          });
                        }
                      }}
                      title={title}
                      aria-label={
                        grouped
                          ? undefined
                          : s.label + " · " + t(`phase.${s.phase}`)
                      }
                    >
                      {grouped ? (
                        <PanelsTopLeftIcon aria-hidden="true" />
                      ) : (
                        <span
                          className="terminal-tab-indicator"
                          data-tone={terminalStateTone(s)}
                          aria-hidden="true"
                        />
                      )}
                      <span className="terminal-tab-label">
                        {grouped
                          ? t("terminalGroup")
                          : s.local
                            ? t("localTerminal") + " · " + s.label
                            : s.label}
                      </span>
                      {grouped && <span>{members.length}</span>}
                    </TabsTrigger>
                    {closeButton(s, grouped ? members : undefined)}
                  </div>
                );
              })}
              {commandTabs.map((id) => {
                const run = commands.find((item) => item.id === id);
                const actionLabel = run?.actionLabel?.startsWith("$")
                  ? t(`service.${run.actionLabel.slice(1)}`, { ns: "commands" })
                  : run?.actionLabel || t("command");
                const service =
                  "runtimes" in data
                    ? data.services?.find((service) => service.id === run?.serviceId)
                    : undefined;
                const label = service?.name
                  ? `${service.name} · ${actionLabel}`
                  : actionLabel;
                const managed = systemdService(service);
                const confirmClose = !!run && (commandActive(run) ||
                  (service?.revision === run.serviceRevision &&
                    managed?.startId === run.actionId && run.phase === "succeeded"));
                return (
                  <div className="terminal-tab-entry" key={id}>
                    <TabsTrigger value={id} title={label}>
                      <span className="terminal-tab-label">{label}</span>
                    </TabsTrigger>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("closeOutput")}
                      aria-haspopup={confirmClose ? "dialog" : undefined}
                      disabled={terminatingCommands.includes(id)}
                      onClick={() => {
                        if (confirmClose) {
                          setError("");
                          setCommandClose({ id });
                        } else removeCommandTab(id);
                      }}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </TabsList>
            <div className="terminal-view-area">
              <TerminalSplitPanels
                groups={groups}
                preview={drag.preview}
                label={(key) => sessionsByKey.get(key)!.label}
                resizeLabel={(axis) =>
                  t(axis === "horizontal" ? "resizeWidth" : "resize")
                }
                renderPane={(key, group) => {
                  const session = sessionsByKey.get(key)!;
                  const grouped = typeof group.tree !== "string";
                  const visible = activeTab === group.tab;
                  const active = expanded && selectedSession?.id === session.id;
                  const preview = drag.preview?.drop;
                  const profile = unsubmittedPreset(
                    session,
                    data.services || [],
                  );
                  return (
                    <section
                      className={
                        grouped
                          ? "terminal-session-panel themed-surface workspace-pane-card"
                          : "terminal-session-panel"
                      }
                      data-terminal-pane={key}
                      data-active={active}
                      data-grouped={grouped}
                      aria-label={session.label}
                      data-drop={
                        preview &&
                        preview !== "tabs" &&
                        preview.scope === "pane" &&
                        preview.target === key
                          ? preview.side
                          : undefined
                      }
                      hidden={!visible}
                      onPointerDownCapture={() => setSelected(session.id)}
                      onFocusCapture={(event) => {
                        if (event.currentTarget.contains(event.target))
                          setSelected(session.id);
                      }}
                    >
                      <PaneIdentity
                        session={session}
                        busy={busy}
                        retryProfile={!!profile}
                        reachableAt={session.phase === "running" && session.serviceId && session.serviceRevision && "runtimes" in data
                          ? serviceForwardReachableAt(data, { ...session, serviceId: session.serviceId, serviceRevision: session.serviceRevision }, session.ruleId)
                          : undefined}
                        reconnect={() => {
                          if (session.local) void connectLocal(session.id);
                          else if (!profile)
                            void connectHost(session.hostId, session.id);
                          else {
                            setDraft({
                              hostId: session.hostId,
                              noEnvironment: profile.service.noLocalEnvironment,
                              fallback: terminalNeedsCredentials(
                                session,
                                data.hosts,
                              ),
                              replaceId: session.id,
                              profile,
                            });
                            setSecrets({});
                            setRemember({});
                          }
                        }}
                        grip={
                          grouped && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="terminal-pane-grip"
                              {...drag.handle(key, true)}
                              title={t("detachPane")}
                              aria-label={
                                t("detachPane") + " · " + session.label
                              }
                              onClick={() => place(key, "tabs")}
                            >
                              <GripVerticalIcon />
                            </Button>
                          )
                        }
                        closeButton={grouped && closeButton(session)}
                      />
                      <Suspense
                        fallback={<p className="muted">{t("loading")}</p>}
                      >
                        {session.clientId === clientId ? (
                          <TerminalView
                            key={session.id}
                            controls={tabControls.current}
                            session={session}
                            clientId={clientId}
                            active={active}
                            visible={expanded && visible}
                            onError={fail}
                          />
                        ) : (
                          <div className="terminal-ended-screen" />
                        )}
                      </Suspense>
                    </section>
                  );
                }}
              />
              {"runtimes" in data &&
                selectedCommand &&
                commandTabs.includes(selectedCommand.id) && (
                  <div className="terminal-command-panel">
                    <CommandResult
                      key={selectedCommand.id}
                      data={data}
                      autoPromptCredentials={automaticCommandAuth.current.has(
                        selectedCommand.id,
                      )}
                      onCredentialsPrompt={() =>
                        automaticCommandAuth.current.delete(selectedCommand.id)
                      }
                      onRerun={showCommand}
                      onRetry={commandRetry.current ?? undefined}
                      run={selectedCommand}
                      terminating={terminatingCommands.includes(selectedCommand.id)}
                      accept={acceptCommand}
                      onError={fail}
                      onCancel={() => terminateCommand(selectedCommand.id)}
                    />
                  </div>
                )}
            </div>
          </Tabs>
        ) : (
          <TerminalTargets hosts={targets} choose={chooseTarget} busy={busy} />
        )}
      </TerminalPanel>
      <AnimatePresence onExitComplete={() => focusActiveTerminal()}>
        {commandClose && closingCommand && (
          <Modal
            key="close-command"
            title={t("closeOutput")}
            description={t(managedClose ? "managedCommandCloseHint" : "foregroundCommandCloseHint")}
            initialFocus={keepCommandFocus}
            close={() => {
              if (!commandClose.choice) setCommandClose(null);
            }}
          >
            <code>{closingCommand.endpoint}</code>
            <ModalActions>
              <Button ref={keepCommandFocus} type="button" variant="ghost" disabled={!!commandClose.choice} onClick={() => setCommandClose(null)}>
                {t("cancel", { ns: "commands" })}
              </Button>
              <Button type="button" variant="destructive" disabled={!!commandClose.choice} onClick={() => {
                setCommandClose({ id: closingCommand.id, choice: "terminate" });
                if (commandActive(closingCommand)) terminateCommand(closingCommand.id);
              }}>
                {commandClose.choice === "terminate" ? t("terminating") : managedClose ? t("terminateService") : t("terminateCommand", { ns: "commands" })}
              </Button>
              <Button type="button" variant="primary-soft" disabled={!managedClose || !!commandClose.choice} onClick={() => {
                setCommandClose({ id: closingCommand.id, choice: "background" });
              }}>
                {t(commandClose.choice === "background" ? "waitingForCommand" : "continueInBackground")}
              </Button>
            </ModalActions>
          </Modal>
        )}
        {draft && (
          <Modal
            key="connect"
            title={t("authForHost", { ns: "tunnel", name: route?.name || "" })}
            close={() => {
              setDraft(null);
              setSecrets({});
              setRemember({});
            }}
          >
            <form
              id="open-terminal-form"
              onSubmit={(e) => {
                e.preventDefault();
                void launch(
                  draft.hostId,
                  draft.noEnvironment,
                  secrets,
                  Object.keys(remember).filter((id) => remember[id]),
                  draft.profile,
                  {
                    replaceId: draft.replaceId,
                    automatic: true,
                    loginId: draft.loginId,
                  },
                ).catch(() => {});
              }}
            >
              {draft.profile && (
                <>
                  <code>
                    {route?.user}@{route?.address}:{route?.port}
                  </code>
                  <pre className="preset-script" data-selectable="true">
                    {draft.profile.action.command}
                  </pre>
                </>
              )}
              {!draft.profile && route && (
                <code>
                  {route.user}@{route.address}:{route.port}
                </code>
              )}
              {!draft.profile &&
                route?.unsupportedSessionOptions?.includes("SendEnv") && (
                  <p className="muted">{t("noEnvironmentHint")}</p>
                )}
              {error && (
                <p role="alert" className="inline-error">
                  {formatUiError(error, t)}
                </p>
              )}
              {routeHosts
                .filter((h) =>
                  draft.fallback
                    ? h.authMethod !== "agent"
                    : h.authMethod === "password",
                )
                .map((host) => (
                  <AuthenticationField
                    key={host.id}
                    host={host}
                    value={secrets[host.id] || ""}
                    onChange={(value) =>
                      setSecrets((s) => ({ ...s, [host.id]: value }))
                    }
                    remember={!!remember[host.id]}
                    onRemember={(value) =>
                      setRemember((s) => ({ ...s, [host.id]: value }))
                    }
                  />
                ))}
              <ModalActions>
                {(!viewer || draft.hostId) && (
                  <Button
                    type="submit"
                    form="open-terminal-form"
                    variant="primary-soft"
                    disabled={busy || !route || !!route.diagnostics.length}
                  >
                    {draft.profile
                      ? t("execute", { ns: "commands" })
                      : t("connect")}
                  </Button>
                )}
              </ModalActions>
            </form>
          </Modal>
        )}
        {closing && closingSessions.length > 0 && (
          <Modal
            key="close"
            title={t(closing.group ? "closeGroup" : "closeTab")}
            description={
              closing.group
                ? t("groupCloseHint", { count: closingSessions.length })
                : t("foregroundCloseHint")
            }
            close={() => {
              if (!submitting.current) setClosing(null);
            }}
          >
            {closing.group ? (
              <ul>
                {closingSessions.map((session) => (
                  <li key={session.id}>
                    {session.label} · <code>{session.endpoint}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <code>{closingSessions[0].endpoint}</code>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {formatUiError(error, t)}
              </p>
            )}
            <ModalActions>
              <Button
                type="button"
                variant="ghost"
                autoFocus
                disabled={busy}
                onClick={() => setClosing(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void close(closingSessions)}
              >
                {t(closing.group ? "closeGroup" : "closeTab")}
              </Button>
            </ModalActions>
          </Modal>
        )}
        {trust && (
          <Modal
            key="trust"
            title={t("trust")}
            description={t("trustHint")}
            close={() => void bridge.closeTerminal(trust.id, trust.clientId)}
          >
            <strong>{trust.verificationEndpoint}</strong>
            <code className="fingerprint">{trust.fingerprint}</code>
            <ModalActions>
              <Button
                type="button"
                variant="destructive"
                onClick={() =>
                  void bridge.closeTerminal(trust.id, trust.clientId)
                }
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void bridge
                    .trustHost(trust.id, trust.id, trust.fingerprint!)
                    .catch((e) => setError(String(e)))
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
  return (
    <SavedCommandsProvider active={expanded || commandSettingsActive}>{workspace}</SavedCommandsProvider>
  );
}
