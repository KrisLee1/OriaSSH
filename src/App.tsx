import { FileTransferEdge, FileTransferPorts } from "./features/files/transfer-edge";
import { FileTransferStatus, useFileActivities } from "./features/files/transfer-state";
import { projectFileEdges } from "./features/files/transfer-graph";
import { useFileEdgePresence } from "./features/files/use-file-edge-presence";
import { wireTravelMs } from "./features/tunnels/wire-power";
import { FileWorkspaceProvider, OpenFilesButton } from "./features/files/file-workspace";
import { NativeLanguageSync } from "@/components/language/native-language-sync";
import { mergeSnapshot } from "@/lib/snapshot-state";
import { FirstUsePreferences } from "@/components/settings/first-use-preferences";
import { formatNativeMessage, nativeMessageKey } from "@/lib/native-message";
import { ConfigExportDialog } from "@/features/tunnels/config-export";
import {
  TerminalWorkspaceProvider,
  OpenTerminalButton,
} from "./features/terminal/terminal-workspace";
import {
  PresetCommandProvider,
  HostServices, AddHostService,
} from "./features/commands/preset-commands";
import {
  createContext, useContext,
  useCallback,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { shallow } from "zustand/shallow";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { useEntranceMotion } from "./components/ui/motion";
import { PageEmptyState } from "./components/page-empty-state";
import {
  ReactFlow,
  Background,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useNodesInitialized,
  useUpdateNodeInternals,
  applyNodeChanges,
  type NodeChange,
  type NodeProps,
  type Node,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import {
  ScrollTextIcon, EllipsisIcon,
  BoltIcon,
  ServerPlusIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  NetworkIcon,
  Settings2Icon,
  MonitorIcon,
  ServerIcon,
  PlayIcon,
  SquareIcon,
  MaximizeIcon,
  ZoomInIcon,
  ZoomOutIcon,
  GraphStarIcon,
  ShieldCheckIcon,
  InfoIcon,
  CopyPlusIcon,
  Trash2Icon,
} from "lucide-react";
import { WindowHeader } from "./components/window/window-header";
import { Button } from "./components/ui/button";
import { Toaster, toast } from "./components/ui/toast";
import { Input } from "./components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { CanvasFind, type CanvasMatch } from "./features/tunnels/canvas-find";
import { ForwardIcon } from "./features/tunnels/forward-icon";
import { UndoDeleteItems, UndoDeleteMenu } from "./features/tunnels/undo-delete-menu";
import { Modal, ModalActions } from "./components/tunnel-form";
import { RuleEditor } from "./features/tunnels/rule-editor";
import { HostTestButton } from "./features/hosts/host-test-button";
import { AuthenticationField } from "./features/hosts/authentication-field";
import { resolvedDefaultLogin, resolvedLogin, credentialKey, primaryLogin } from "./features/hosts/login-identities";
import { CredentialManager } from "./features/hosts/credential-manager";
import { HostCredentialMenu } from "./features/hosts/host-credential-menu";
import { HostEditorFields } from "./features/hosts/host-editor-fields";
import { HostDeleteDialog } from "./features/hosts/host-delete-dialog";
import { HostDiscovery } from "./features/hosts/host-discovery";
import {
  hostAuthLabels,
  hostAuthMethod,
  passwordsToRequest,
  automaticAuthOutcome,
  type AutomaticAttempt,
} from "./features/hosts/host-auth";
import { addedHosts, copyHostDraft } from "./features/hosts/host-collection";
import { serviceHostIds } from "./features/commands/service-target";
import { OpenServiceButton } from "./features/tunnels/service-protocol";
import { SettingsDialog, type SettingsCategory } from "./components/settings/settings-dialog";
import {
  OpenProxyBrowserButton,
  ProxyServiceButtons,
} from "./features/tunnels/proxy-browser";
import { RuleActions } from "./features/tunnels/rule-actions";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "./components/ui/context-menu";
import { AboutButton, AboutDialog } from "./components/settings/about-dialog";
import { useApplicationUpdate } from "./lib/application-update";
import { RuntimeDetails } from "./features/tunnels/runtime-details";
import { bytes } from "./features/tunnels/runtime-format";
import { runtimeStatus } from "./features/tunnels/runtime-status";
import { ActivityView } from "./features/tunnels/activity-view";
import { WorkspaceActions } from "./features/tunnels/workspace-actions";
import { ImportConfig } from "./features/tunnels/import-config";
import { ConnectionIcon } from "./features/tunnels/connection-icon";
import { ConnectionEdge } from "./features/tunnels/connection-edge";
import {
  projectCardRuntimes,
  projectCanvasRoutes,
  projectCanvasEdges,
  type CardRuntime,
} from "./features/tunnels/canvas-runtime";
import { EndpointCards, EndpointRoute } from "./features/tunnels/endpoint-card";
import { CanvasLinks, CardEdge } from "./features/tunnels/canvas-link";
import { ConnectionPort } from "./features/tunnels/connection-port";
import { LocalPortHandle } from "./features/tunnels/local-port-handle";
import {
  hostForwardDraft,
  serviceLocalForward,
  localForwardServiceIds,
  oppositeSide,
  serviceEndpointSide,
  availableHostPosition,
  type CanvasPoint,
  type HostPlacement,
} from "./features/tunnels/canvas-creation";
import {
  PORT_LAYOUT_KEY,
  readPortPlacements,
  type PortPlacement,
} from "./features/tunnels/port-placement";
import {
  canvasLayout,
  readCanvasLayout,
  canvasPortId,
  canvasPortSize,
  localPortSide,
  localCardSize,
  localPortOffsets,
  reconcileCanvasNodes,
} from "./features/tunnels/canvas-state";
import { connectionPorts } from "./features/tunnels/connection-visual";
import {
  emptyHost,
  endpoint,
  displayedRoute,
  jumpHosts,
} from "./features/tunnels/rule-model";
import * as bridge from "./lib/bridge";
import type { Host, HostDeletionImpact, RemoteService, Rule, Runtime, Snapshot, BatchResult, ConfigExportMode } from "./types";
import i18n from "./i18n";
import {
  canvasHostGroups,
  groupPositions,
} from "./features/tunnels/rule-groups";

const initial: Snapshot = {
  hosts: [],
  rules: [],
  runtimes: [],
  diagnostics: [],
  revision: -1,
  closeToTray: true,
  agentSupported: false,
  sourceFiles: [],
  autoSyncHosts: true,
  activity: [],
  hostUndoCount: 0,
  forwardUndoCount: 0,
  autostart: false,
  autostartSupported: false,
};
function Status({
  runtime,
}: {
  runtime?: Pick<
    Runtime,
    "status" | "errorKind" | "configurationChanged" | "message"
  >;
}) {
  const { t } = useTranslation("tunnel");
  const status = runtimeStatus(runtime);
  return (
    <span
      className={`status ${runtime?.status || "stopped"} tone-${status.tone}`}
      title={
        runtime?.message
          ? formatNativeMessage(runtime.message)
          : t(status.label)
      }
    >
      <i />
      {t(status.label)}
    </span>
  );
}
function useSnapshot() {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const accept = useCallback(
    (next: Snapshot) => setData((prev) => mergeSnapshot(prev, next)),
    [],
  );
  useEffect(() => {
    let disposed = false;
    const sub = bridge.desktop
      ? listen<Snapshot>("tunnel://snapshot", (e) => {
          if (!disposed) accept(e.payload);
        })
      : Promise.resolve(() => {});
    void sub
      .then(() => bridge.snapshot())
      .then((next) => {
        if (!disposed) accept(next);
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      void sub.then((stop) => stop());
    };
  }, [accept]);
  return { data, accept, error, setError };
}

const saveHostProfile = (host: Host) =>
  host.source === "config" ? bridge.saveHostMetadata(host) : bridge.saveHost(host);

const CanvasNavigation = createContext<{
  logs: (host: string) => void;
  details: (id: string) => void;
  copyHost: (host: Host) => void;
  setDefaultLogin: (host: Host, loginId: string | null) => void;
  removeHost: (host: Host) => void;
} | null>(null);
export function App() {
  const { t } = useTranslation("tunnel");
  const [about, setAbout] = useState(false);
  const openAbout = useCallback(() => setAbout(true), []);
  const updates = useApplicationUpdate(openAbout);
  useEffect(() => {
    if (!bridge.desktop) return;
    const subscription = listen("tunnel://open-about", openAbout);
    return () => {
      void subscription.then((off) => off()).catch(() => {});
    };
  }, [openAbout]);
  const { data, accept, error, setError } = useSnapshot();
  const [logHost, setLogHost] = useState<string | null>(null);
  const [canvasMatch, setCanvasMatch] = useState<CanvasMatch>();
  const clearCanvasMatch = useCallback(() => setCanvasMatch(undefined), []);
  const [settings, setSettings] = useState<SettingsCategory | null>(null);
  const [managingHostCredentials, setManagingHostCredentials] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Rule[] | null>(null);
  const [selectedHost, setSelectedHost] = useState("");
  const [hostDeletion, setHostDeletion] = useState<{
    host: Host;
    impact: HostDeletionImpact;
    error: string;
    stale: boolean;
  } | null>(null);
  const pendingHostDeletion = useRef<{ id: string } | null>(null);
  const requestHostDeletion = useCallback(async (host: Host) => {
    if (pendingHostDeletion.current?.id === host.id) return;
    const request = { id: host.id };
    pendingHostDeletion.current = request;
    try {
      const impact = await bridge.previewHostDeletion(host.id);
      if (pendingHostDeletion.current !== request) return;
      setSelectedHost((id) => id === host.id ? "" : id);
      setHostDeletion({ host, impact, error: "", stale: false });
    } catch (error) {
      if (pendingHostDeletion.current === request) setError(String(error));
    } finally {
      if (pendingHostDeletion.current === request) pendingHostDeletion.current = null;
    }
  }, [setError]);

  const [hostDraft, setHostDraft] = useState<Host | null>(null);
  const newHostOrigin = useRef<CanvasPoint | null>(null);
  const [hostPlacement, setHostPlacement] = useState<HostPlacement | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [addedInSession, setAddedInSession] = useState<string[]>([]);
  const portFocus = useRef<"bind" | "target" | null>(null);
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null);
  const [ruleServiceSelection, setRuleServiceSelection] = useState<{
    draft: Rule;
    ids: string[];
  } | null>(null);
  const [focusRuleId, setFocusRuleId] = useState("");
  const [hostFromRule, setHostFromRule] = useState(false);
  const [authHostId, setAuthHostId] = useState<string | null>(null);
  const [authLogin, setAuthLogin] = useState<string>();
  const [authId, setAuthId] = useState<string | null>(null);
  const automaticAttempts = useRef(new Map<string, AutomaticAttempt>());
  const passwordChecks = useRef(new Map<string, symbol>());
  const [authFallback, setAuthFallback] = useState(false);
  const [requestedPasswords, setRequestedPasswords] = useState<string[]>([]);
  const [jumpSecrets, setJumpSecrets] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState("");
  const [batchAuth, setBatchAuth] = useState<string[] | null>(null);
  const [batchPasswordKeys, setBatchPasswordKeys] = useState<string[]>([]);
  const [batchSecrets, setBatchSecrets] = useState<Record<string, string>>({});
  const [rememberPasswords, setRememberPasswords] = useState<
    Record<string, boolean>
  >({});
  useEffect(() => {
    setRememberPasswords({});
  }, [authId, batchAuth]);
  useEffect(() => {
    if (!bridge.desktop) return;
    const unlisten = listen<string>("tunnel://password-error", (e) =>
      setError(e.payload),
    );
    return () => {
      void unlisten.then((off) => off()).catch(() => {});
    };
  }, [setError]);
  useEffect(() => {
    if (!error) {
      toast.close("app-error");
      return;
    }
    toast.add({
      id: "app-error",
      title:
        error === "updateInstalling"
          ? i18n.t("phase.installing", { ns: "updater" })
          : formatNativeMessage(
              i18n.t(`error.${error}`, { ns: "terminal", defaultValue: error }),
            ),
      type: "error",
      priority: "high",
      timeout: 0,
      onClose: () => setError((current) => (current === error ? "" : current)),
    });
  }, [error, setError, t]);
  const notifyBatch = (results: BatchResult[], operation: "start" | "stop") => {
    const accepted = results.filter((result) => result.accepted).length;
    const rejected = results.length - accepted;
    toast.add({
      title: t(rejected ? "batchRequestPartial" : "batchRequestSubmitted", {
        action: t(operation),
        count: accepted,
        rejected,
      }),
      description:
        formatNativeMessage(
          results.find((result) => !result.accepted)?.error || "",
        ) || (rejected ? t("batchRequestFailed") : undefined),
      type: rejected ? "warning" : "info",
      timeout: rejected ? 6000 : 4000,
    });
  };
  const [exporting, setExporting] = useState<ConfigExportMode | null>(null);
  const action = useCallback(
    async (fn: () => Promise<unknown>, onError: (message: string) => void = setError) => {
      setBusy(true);
      setError("");
      try {
        const result = await fn();
        if (result && typeof result === "object" && "revision" in result)
          accept(result as Snapshot);
        return true;
      } catch (e) {
        onError(String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accept, setError],
  );
  const undoDelete = (kind: "host" | "forward") =>
    void action(() => bridge.undoDelete(kind));
  const canvasNavigation = useMemo(
    () => ({
      logs: (host: string) => setLogHost(host),
      details: (id: string) => {
        setSelectedHost(id);
      },
      copyHost: (host: Host) => setHostDraft(copyHostDraft(host, t("copyName", { name: host.name }))),
      setDefaultLogin: (host: Host, loginId: string | null) => {
        void action(() => saveHostProfile({ ...host, defaultLoginId: loginId }));
      },
      removeHost: requestHostDeletion,
    }),
    [action, requestHostDeletion, t],
  );
  const refresh = () => action(bridge.refreshHosts);
  const managedHosts = addedHosts(data, addedInSession);
  const managedHostIds = new Set(managedHosts.map((host) => host.id));
  const openHostDiscovery = (fromRule = false, origin: CanvasPoint | null = null) => {
    newHostOrigin.current = origin;
    setHostFromRule(fromRule);
    setDiscovering(true);
    void refresh();
  };
  useEffect(() => {
    if (!bridge.desktop) return;
    const focus = () => {
      void bridge
        .syncHosts()
        .then(accept)
        .catch((e) => setError(String(e)));
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [accept, setError]);
  const copyRule = (rule: Rule) => {
    setRuleDraft({
      ...rule,
      id: "",
      name: t("copyName", { name: rule.name }),
      bindPort: 0,
      autoConnect: false,
    });
  };
  const createServiceForward = async (hostId: string, serviceId: string) => {
    if (busy || !bridge.desktop) return;
    const host = managedHosts.find((item) => item.id === hostId);
    const service = data.services?.find((item) => item.id === serviceId);
    if (!host || host.diagnostics.length || !service || !serviceHostIds(service, data).includes(hostId)) return;
    const draft = serviceLocalForward(hostId, service, data.rules);
    if (!draft) return;
    const rule = { ...draft, id: crypto.randomUUID() };
    const ok = await action(() => bridge.saveRule(rule, [{
      id: service.id, revision: service.revision, selected: true,
    }]));
    if (ok) return rule.id;
  };
  const linkForwardHost = (ruleId: string, hostId: string) => {
    if (busy || !bridge.desktop) return;
    const rule = data.rules.find((item) => item.id === ruleId);
    const host = managedHosts.find((item) => item.id === hostId);
    if (!rule || rule.kind === "L" || !host || host.diagnostics.length || rule.hostId === hostId) return;
    setRuleDraft({ ...rule, hostId });
  };
  const saveDraft = async (
    launch: boolean,
    serviceLinks?: import("@/types").ServiceLink[],
  ) => {
    if (!ruleDraft) return;
    const rule = {
      ...ruleDraft,
      serviceProtocol: ruleDraft.kind === "D" ? null : ruleDraft.serviceProtocol,
      id: ruleDraft.id || crypto.randomUUID(),
    };
    const running = data.runtimes.some(
      (r) =>
        r.ruleId === rule.id &&
        !["failed", "stopped", "needs-attention"].includes(r.status),
    );
    let savedHost: Host | undefined;
    const ok = await action(async () => {
      let result = await bridge.saveRule(rule, serviceLinks);
      if (running && launch) await bridge.stopRule(rule.id);
      if (launch) {
        if (running) result = await bridge.snapshot();
        savedHost = result.hosts.find((host) => host.id === rule.hostId);
      }
      return result;
    });
    if (ok) {
      setRuleDraft(null);

      setFocusRuleId(rule.id);
      if (launch) void beginConnection(rule.id, resolvedDefaultLogin(savedHost));
    }
  };
  const stop = (id: string) => {
    passwordChecks.current.delete(id);
    automaticAttempts.current.delete(id);
    return action(() => bridge.stopRule(id));
  };
  const beginConnection = async (id: string, host?: Host, test = false) => {
    const check = Symbol();
    passwordChecks.current.set(id, check);
    const route = host ? [...jumpHosts(data.hosts, host), host] : [];
    const withoutPasswords = await passwordsToRequest(route);
    if (passwordChecks.current.get(id) !== check) return;
    passwordChecks.current.delete(id);
    setSecret("");
    setJumpSecrets({});
    setAuthFallback(false);
    setAuthLogin(host && (host.activeLoginId || primaryLogin(host)));
    if (!host || withoutPasswords.length) {
      setRequestedPasswords(withoutPasswords.map(credentialKey));
      setAuthHostId(test ? (host?.id ?? id.slice("host-test:".length)) : null);
      setAuthId(id);
      return;
    }
    automaticAttempts.current.set(id, {
      previousRunId: data.runtimes.find((runtime) => runtime.ruleId === id)
        ?.runId,
      hostId: test ? host.id : undefined,
    });
    void action(() =>
      test ? bridge.testHost(host.id, "", {}, [],host.activeLoginId) : bridge.startRule(id, "",{},[],host.activeLoginId || primaryLogin(host)),
    ).then((ok) => {
      if (!ok) automaticAttempts.current.delete(id);
    });
  };
  const start = (id: string) => {
    const rule = data.rules.find((rule) => rule.id === id);
    const host = data.hosts.find((host) => host.id === rule?.hostId);
    void beginConnection(id, resolvedDefaultLogin(host));
  };
  const startHost = (id: string, saved?: Host) =>
    void beginConnection(
      "host-test:" + id,
      resolvedLogin(
        saved || data.hosts.find((h) => h.id === id),
        (saved || data.hosts.find((h) => h.id === id))?.defaultLoginId,
      ),
      true,
    );
  useEffect(() => {
    for (const [id, attempt] of automaticAttempts.current) {
      const outcome = automaticAuthOutcome(
        attempt,
        data.runtimes.find((runtime) => runtime.ruleId === id),
      );
      if (outcome === "waiting" || (outcome === "prompt" && authId)) continue;
      automaticAttempts.current.delete(id);
      const rule = data.rules.find(r => r.id === id);
      const frozen = data.runtimes.find(r => r.ruleId === id)?.hostSnapshot;
      const loginId = frozen
        ? frozen.activeLoginId ?? primaryLogin(frozen)
        : rule?.loginIdentityId;
      const host = resolvedLogin(
        data.hosts.find((h) => h.id === (attempt.hostId || rule?.hostId)),
        loginId,
      );

      if (
        outcome !== "prompt" ||
        !host ||
        (!attempt.hostId && (!rule || (rule.loginIdentityId ?? primaryLogin(host)) !==
          (loginId ?? primaryLogin(host)))) ||
        [...jumpHosts(data.hosts, host), host].every(
          (hop) => hop.authMethod === "agent",
        )
      )
        continue;
      setAuthLogin(host.activeLoginId || primaryLogin(host));
      setAuthHostId(attempt.hostId || null);
      setAuthId(id);
      setAuthFallback(true);
      setSecret("");
      setJumpSecrets({});
      break;
    }
  }, [data.runtimes, data.hosts, data.rules, authId]);
  const closeHost = () => {
    setManagingHostCredentials(false);
    setHostDraft(null);
    setHostFromRule(false);
  };
  const hostNeedsCredential = hostDraft?.credentialOnly && (
    !hostDraft.defaultLoginId ||
    !hostDraft.credentialIds?.includes(hostDraft.defaultLoginId) ||
    !data.loginCredentials?.some(({ id }) => id === hostDraft.defaultLoginId)
  );
  const saveHostDraft = async (test: boolean) => {
    if (!hostDraft || hostNeedsCredential) return;
    const host = { ...hostDraft, id: hostDraft.id || crypto.randomUUID() };
    let saved: Host | undefined;
    const ok = await action(async () => {
      const snapshot = await saveHostProfile(host);
      saved = snapshot.hosts.find((item) => item.id === host.id);
      return snapshot;
    });
    if (ok) {
      if (hostFromRule && ruleDraft) {
        const next = { ...ruleDraft, hostId: host.id };
        if (ruleServiceSelection?.draft === ruleDraft)
          setRuleServiceSelection({ ...ruleServiceSelection, draft: next });
        setRuleDraft(next);
      }
      if (!hostDraft.id && !hostFromRule) {
        setHostPlacement({ ids: [host.id], origin: newHostOrigin.current });
      }
      closeHost();
      if (test && saved) startHost(host.id, saved);
    }
  };
  const authRule = data.rules.find((r) => r.id === authId);
  const authTarget = resolvedLogin(
    data.hosts.find((h) => h.id === (authHostId || authRule?.hostId)),
    authLogin,
  );
  const authPromptHosts = authTarget
    ? [...jumpHosts(data.hosts, authTarget), authTarget].filter((host) =>
        authFallback
          ? host.authMethod !== "agent"
          : requestedPasswords.includes(credentialKey(host)),
      )
    : [];
  const batchRouteHosts = (ids: string[]) => {
    const hosts = new Map<string, Host>();
    for (const id of ids) {
      const rule = data.rules.find((r) => r.id === id);
      const target = resolvedLogin(
        data.hosts.find((h) => h.id === rule?.hostId),
        rule?.loginIdentityId,
      );
      if (target)
        for (const h of [...jumpHosts(data.hosts, target), target])
          hosts.set(credentialKey(h), h);
    }
    return [...hosts.values()];
  };
  const runBatch = (
    ids: string[],
    credentials: Record<string, string>,
    remember: string[],
    fromTray = false,
  ) => {
    setBatchSecrets({});
    setBatchAuth(null);
    for (const id of ids)
      automaticAttempts.current.set(id, {
        previousRunId: data.runtimes.find((r) => r.ruleId === id)?.runId,
      });
    void action(async () => {
      const results = await bridge.startBatch(ids, credentials, remember);
      for (const result of results)
        if (!result.accepted) automaticAttempts.current.delete(result.id);
      notifyBatch(results, "start");
      if (fromTray && results.some((result) => !result.accepted))
        void bridge.showMainWindow();
    }).then((ok) => {
      if (!ok) {
        for (const id of ids) automaticAttempts.current.delete(id);
        if (fromTray) void bridge.showMainWindow();
      }
    });
  };
  const startMany = async (ids: string[], fromTray = false) => {
    const check = Symbol();
    for (const id of ids) passwordChecks.current.set(id, check);
    setBatchSecrets({});
    const missing = await passwordsToRequest(batchRouteHosts(ids));
    const current = ids.filter((id) => passwordChecks.current.get(id) === check);
    if (!current.length) return;
    for (const id of current) passwordChecks.current.delete(id);
    if (missing.length) {
      const keys = new Set(batchRouteHosts(current).map(credentialKey));
      const requested = missing.map(credentialKey).filter((key) => keys.has(key));
      if (requested.length) {
        setBatchPasswordKeys(requested);
        setBatchAuth(current);
        return;
      }
    }
    runBatch(current, {}, [], fromTray);
  };
  const trayStart = useRef(startMany);
  useLayoutEffect(() => {
    trayStart.current = startMany;
  });
  useEffect(() => {
    if (!bridge.desktop) return;
    let disposed = false;
    const subscription = listen<string[]>(
      "tunnel://tray-start",
      ({ payload }) => {
        if (!disposed) trayStart.current(payload, true);
      },
    );
    return () => {
      disposed = true;
      void subscription.then((off) => off()).catch(() => {});
    };
  }, []);
  const draftUser = hostDraft && (
    (hostDraft.credentialIds?.includes(hostDraft.defaultLoginId ?? "")
      ? data.loginCredentials?.find(({ id }) => id === hostDraft.defaultLoginId)?.user
      : resolvedLogin(hostDraft, hostDraft.defaultLoginId)?.user)
    ?? hostDraft.user
  );
  const duplicateHost =
    hostDraft?.source === "manual" &&
    managedHosts.find(
      (h) =>
        h.id !== hostDraft.id &&
        h.address === hostDraft.address &&
        h.port === hostDraft.port &&
        h.user === draftUser,
    );
  const savedEditingRule = data.rules.find(rule => rule.id === ruleDraft?.id);
  const editingRuntime = ruleDraft?.id ? data.runtimes.find((runtime) =>
    runtime.ruleId === ruleDraft.id && !["failed", "stopped", "needs-attention"].includes(runtime.status),
  ) : undefined;
  const pending = data.runtimes.find((r) => r.status === "verifying-host");
  const needsInput = Boolean(authId || batchAuth || pending);
  useEffect(() => {
    if (bridge.desktop && needsInput) void bridge.showMainWindow();
  }, [needsInput]);
  const batchHosts = batchRouteHosts(batchAuth || []).filter(
    (host) => batchPasswordKeys.includes(credentialKey(host)),
  );
  const inspected = data.rules.find((r) => r.id === inspecting);
  const inspectedHost = inspected && data.hosts.find((host) => host.id === inspected.hostId);
  const inspectedLogin = inspected && resolvedLogin(inspectedHost, inspected.loginIdentityId);
  const inspectedServices = inspected?.kind === "L" && inspectedHost
    ? (data.services ?? []).filter(service => serviceHostIds(service, data).includes(inspectedHost.id))
    : [];
  const inspectedServiceId = inspected && inspectedHost && inspectedServices.length
    ? localForwardServiceIds(inspectedHost, [inspected], inspectedServices).get(inspected.id)
    : undefined;
  const inspectedName = inspectedServices.find(service => service.id === inspectedServiceId)?.name || inspected?.name;
  const active = data.runtimes.filter(
    (r) =>
      !r.ruleId.startsWith("host-test:") &&
      !["failed", "stopped", "tested", "needs-attention"].includes(r.status),
  ).length;
  return (
    <TerminalWorkspaceProvider
      data={data}
      commandSettingsActive={settings === "terminal"}
      openCommandSettings={() => setSettings("terminal")}
    ><FileWorkspaceProvider data={data}>
      <NativeLanguageSync />
      <FirstUsePreferences ready={data.revision >= 0} />
      <PresetCommandProvider
        data={data}
        onSnapshot={accept}
      >
        <div className="app-shell tunnel-app">
          <WindowHeader
            fixedLeftActions={<>
              <Button variant="ghost" size="icon-sm" aria-label={t("addHost")} title={t("addHost")}
                disabled={!bridge.desktop} onClick={() => openHostDiscovery()}><ServerPlusIcon /></Button>
              <CanvasFind data={data} locate={setCanvasMatch} />
              <UndoDeleteMenu history={data} disabled={busy || !bridge.desktop} onUndo={undoDelete} />
            </>}
            fixedRightActions={
              <>
                <WorkspaceActions
                  count={data.rules.length}
                  busy={busy}
                  available={bridge.desktop}
                  onStartAll={() => startMany(data.rules.map((r) => r.id))}
                  onStopAll={() => {
                    for (const rule of data.rules) {
                      passwordChecks.current.delete(rule.id);
                      automaticAttempts.current.delete(rule.id);
                    }
                    void action(async () =>
                      notifyBatch(
                        await bridge.stopBatch(data.rules.map((r) => r.id)),
                        "stop",
                      ),
                    );
                  }}
                />
              </>
            }
          >
            <OpenFilesButton/><OpenTerminalButton workspace />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings")}
              title={t("settings")}
              aria-haspopup="dialog"
              onClick={() => setSettings("general")}
            >
              <BoltIcon aria-hidden="true" />
            </Button>
            <AboutButton snapshot={updates.snapshot} onClick={openAbout} />
          </WindowHeader>
          <main>
            <CanvasNavigation.Provider value={canvasNavigation}>
              <ReactFlowProvider>
              <TunnelCanvas highlight={canvasMatch} onHighlightDone={clearCanvasMatch} detailsOpen={!!inspected || managedHostIds.has(selectedHost)}
                onAddHost={(point) => openHostDiscovery(false, point)}
                onUndoDelete={undoDelete}
                hostPlacement={hostPlacement}
                onHostsPlaced={() => setHostPlacement(null)}
                data={data}
                onEditPort={(rule, side) => {
                  portFocus.current = (side === "local") === (rule.kind === "R") ? "target" : "bind";

                  setRuleDraft(rule);
                }}
                onHostEdit={setHostDraft}
                onHostAddForward={(id, kind) => setRuleDraft(hostForwardDraft(id, kind))}
                onCreateServiceForward={createServiceForward}
                onLinkForwardHost={linkForwardHost}
                canAdd={!busy && bridge.desktop}
                onStart={start}
                onOpenService={(id, internalVnc) =>
                  void action(() => bridge.openService(id, internalVnc))
                }
                onOpenProxyBrowser={(id, browser, serviceId) =>
                  void action(() =>
                    bridge.openProxyBrowser(id, browser, serviceId),
                  )
                }
                onStop={stop}
                onDetails={(rule) => setInspecting(rule.id)}
                onCopy={copyRule}
                onDelete={(rule) => setDeleting([rule])}
                onEdit={(rule) => {

                  setRuleDraft(rule);
                }}
                focusRuleId={focusRuleId}
                onFocusDone={() => setFocusRuleId("")}
              />
              </ReactFlowProvider>
            </CanvasNavigation.Provider>
            {!hostDeletion && (
              <HostDetails
                data={{ ...data, hosts: managedHosts }}
                busy={busy}
                selected={selectedHost}
                setSelected={setSelectedHost}
                onTest={startHost}
                onStopTest={(id) => void stop("host-test:" + id)}
              />
            )}
          </main>
          <div className="app-footnote">
            <GraphStarIcon size={13} />
            <span>{t("activeCount", { count: active })}</span>
            <span className="footnote-divider" />
            <span>OriaSSH</span>
          </div>
          {!!data.diagnostics.length && (
            <div className="diagnostics overlay">
              {data.diagnostics.map((d, i) => (
                <div key={i}>
                  {d === "browserPreview" ? t(d) : formatNativeMessage(d)}
                </div>
              ))}
            </div>
          )}
          <Toaster closeLabel={t("cancel")} />
          {hostDeletion && (
            <HostDeleteDialog
              host={hostDeletion.host}
              impact={hostDeletion.impact}
              busy={busy}
              canConfirm={!hostDeletion.stale}
              close={() => {
                if (!busy) setHostDeletion(null);
              }}
              error={hostDeletion.error ? formatNativeMessage(t(hostDeletion.error, {
                ns: "files",
                defaultValue: t(`error.${hostDeletion.error}`, { ns: "terminal", defaultValue: hostDeletion.error }),
              })) : ""}
              confirm={() => {
                const { host, impact } = hostDeletion;
                setHostDeletion({ ...hostDeletion, error: "" });
                void action(() => bridge.deleteHost(host.id, impact, impact.active), (error) => {
                  const key = nativeMessageKey(error);
                  if (["hostUsedByFiles", "hostUsedByTerminal", "hostUsedByService"].includes(error) && !impact.active) {
                    setHostDeletion({ ...hostDeletion, error: "", impact: { ...impact, active: true } });
                  } else {
                    setHostDeletion({
                      ...hostDeletion,
                      error,
                      stale: key === "hostRulesChanged" || key === "hostServicesChanged",
                    });
                  }
                }).then((ok) => {
                  if (!ok) return;
                  setAddedInSession((items) => items.filter((id) => id !== host.id));
                  setSelectedHost((id) => (id === host.id ? "" : id));
                  setHostDeletion(null);
                });
              }}
            />
          )}
          <AnimatePresence>
            {deleting && (
              <Modal
                key="delete-rules"
                title={t("confirmDelete")}
                close={() => {
                  if (!busy) setDeleting(null);
                }}
              >
                <p className="muted">
                  {t("deleteRulesHint", { count: deleting.length })}
                </p>
                <ul className="delete-targets">
                  {deleting.map((rule) => (
                    <li key={rule.id}>{rule.name}</li>
                  ))}
                </ul>
                <ModalActions>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDeleting(null)}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        deleting.length === 1
                          ? bridge.deleteRule(deleting[0].id)
                          : bridge.deleteRules(deleting.map((r) => r.id)),
                      ).then((ok) => {
                        if (ok) {
                          setDeleting(null);
                        }
                      })
                    }
                  >
                    {t("delete")}
                  </Button>
                </ModalActions>
              </Modal>
            )}
            {importing && (
              <ImportConfig
                key="import"
                previewFile={bridge.previewImport}
                cancelPreview={bridge.cancelImport}
                hosts={data.hosts}
                addedHostIds={data.addedHostIds}
                busy={busy}
                close={() => {
                  if (!busy) {
                    setImporting(false);
                    void bridge
                      .cancelImport()
                      .catch((e) => setError(String(e)));
                  }
                }}
                submit={async (token, choices) => {
                  const ok = await action(() =>
                    bridge.commitImport(token, choices),
                  );
                  if (ok) setImporting(false);
                  return ok;
                }}
              />
            )}
            {about && (
              <AboutDialog
                key="about"
                updates={updates}
                close={() => setAbout(false)}
              />
            )}
            {settings && (
              <SettingsDialog
                key="settings"
                data={data}
                category={settings}
                onCategoryChange={setSettings}
                busy={busy}
                close={() => setSettings(null)}
                onSnapshot={accept}
                runAction={action}
                onImport={() => {
                  setSettings(null);
                  setImporting(true);
                }}
                onExport={(mode) => {
                  setSettings(null);
                  setExporting(mode);
                }}
              />
            )}
            {logHost && (
              <Modal
                title={data.hosts.find((host) => host.id === logHost)?.name || logHost}
                close={() => setLogHost(null)}
                className="activity-modal sm:max-w-3xl"
              >
                <div className="activity-modal-timeline">
                  <ActivityView data={data} scope={logHost} />
                </div>
              </Modal>
            )}
            {inspected && (
              <Modal
                key="runtime-details"
                title={inspectedName ? t("forwardDetailsTitle", { name: inspectedName }) : t("tunnels")}
                close={() => setInspecting("")}
                className="max-w-md sm:max-w-md"
              >
                <RuntimeDetails
                  rule={inspected}
                  runtime={data.runtimes.find((r) => r.ruleId === inspected.id)}
                  savedLogin={inspectedLogin}
                  hostName={inspectedHost?.name || t("sourceMissing")}
                />
              </Modal>
            )}
            {batchAuth && (
              <Modal
                key="batch-auth"
                title={t("batchStartTitle", { count: batchAuth.length })}
                description={t("batchAuthHint")}
                close={() => {
                  setBatchAuth(null);
                  setBatchSecrets({});
                }}
              >
                <form
                  id="batch-auth-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const keys = batchHosts.map(credentialKey);
                    runBatch(
                      batchAuth,
                      Object.fromEntries(keys.filter((key) => batchSecrets[key])
                        .map((key) => [key, batchSecrets[key]])),
                      keys.filter((key) => rememberPasswords[key]),
                    );
                  }}
                >
                  {batchHosts.map((host) => (
                    <AuthenticationField
                      key={credentialKey(host)}
                      host={host}
                      value={batchSecrets[credentialKey(host)] || ""}
                      onChange={(value) =>
                        setBatchSecrets({ ...batchSecrets, [credentialKey(host)]: value })
                      }
                      remember={!!rememberPasswords[credentialKey(host)]}
                      onRemember={(value) =>
                        setRememberPasswords((old) => ({
                          ...old,
                          [credentialKey(host)]: value,
                        }))
                      }
                    />
                  ))}
                  <ModalActions>
                    <Button
                      type="submit"
                      form="batch-auth-form"
                      variant="primary-soft"
                      disabled={busy}
                    >
                      {t("startSelected")}
                    </Button>
                  </ModalActions>
                </form>
              </Modal>
            )}
            {exporting && (
              <ConfigExportDialog
                key="export"
                data={data}
                mode={exporting}
                close={() => {
                  setExporting(null);
                  setSettings("configuration");
                }}
              />
            )}
            {ruleDraft && (
              <Modal
                key="rule-editor"
                title={t(ruleDraft.id ? "editForward" : "add")}
                close={() => setRuleDraft(null)}
                disablePointerDismissal
              >
                <RuleEditor
                  key={ruleDraft.id || "new"}
                  draft={ruleDraft}
                  portFocus={portFocus}
                  hosts={managedHosts}
                  services={data.services}
                  selectedServiceIds={
                    ruleServiceSelection?.draft === ruleDraft
                      ? ruleServiceSelection.ids
                      : undefined
                  }
                  onServicesChange={(ids) =>
                    setRuleServiceSelection({ draft: ruleDraft, ids })
                  }
                  busy={busy}
                  savedRule={savedEditingRule}
                  activeRule={editingRuntime ? savedEditingRule : undefined}
                  reconnect={!!editingRuntime?.configurationChanged}
                  onChange={(next) => {
                    if (ruleServiceSelection?.draft === ruleDraft)
                      setRuleServiceSelection({
                        ...ruleServiceSelection,
                        draft: next,
                      });
                    setRuleDraft(next);
                  }}
                  onCancel={() => setRuleDraft(null)}
                  onAddHost={() => openHostDiscovery(true)}
                  onSave={(launch, links) => void saveDraft(launch, links)}
                />
              </Modal>
            )}
            {discovering && (
              <HostDiscovery
                key="discovery"
                hosts={data.hosts.filter(
                  (host) => !managedHostIds.has(host.id),
                )}
                diagnostics={data.diagnostics}
                busy={busy}
                available={bridge.desktop}
                close={() => {
                  if (!busy) {
                    setDiscovering(false);
                    setHostFromRule(false);
                  }
                }}
                refresh={() => void refresh()}
                manual={() => {
                  setDiscovering(false);
                  setHostDraft({ ...emptyHost(), credentialOnly: true });
                }}
                select={async (ids) => {
                  if (!ids.length || busy) return;
                  const ok = await action(() => bridge.addDiscoveredHosts(ids));
                  if (!ok) return;
                  setAddedInSession((current) => [
                    ...new Set([...current, ...ids]),
                  ]);
                  if (hostFromRule && ruleDraft)
                    setRuleDraft(
                      (current) => current && { ...current, hostId: ids[0] },
                    );
                  else setHostPlacement({ ids, origin: newHostOrigin.current });
                  setDiscovering(false);
                  setHostFromRule(false);
                }}
              />
            )}
            {hostDraft && (
              <Modal
                key="host-editor"
                title={t(hostDraft.id ? "editSshHost" : "newHost")}
                close={closeHost}
                disablePointerDismissal
              >
                <form
                  id="host-editor-form"
                  className="host-editor-form"
                  aria-label={t(hostDraft.id ? "editSshHost" : "newHost")}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveHostDraft(false);
                  }}
                >
                  <HostEditorFields
                    host={hostDraft}
                    hosts={managedHosts}
                    credentials={data.loginCredentials ?? []}
                    busy={busy}
                    change={(patch) => setHostDraft((draft) => draft && { ...draft, ...patch })}
                    manageCredentials={() => setManagingHostCredentials(true)}
                  />
                  {duplicateHost && (
                    <div className="path-preview">
                      <p className="muted">
                        {t("duplicateHost")} {duplicateHost.name}
                      </p>
                      {hostFromRule && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            if (ruleDraft)
                              setRuleDraft({
                                ...ruleDraft,
                                hostId: duplicateHost.id,
                              });
                            closeHost();
                          }}
                        >
                          {t("useExistingHost")}
                        </Button>
                      )}
                    </div>
                  )}
                  <ModalActions>
                    <Button type="button" variant="ghost" onClick={closeHost}>
                      {t("cancel")}
                    </Button>
                    <Button
                      type="submit"
                      form="host-editor-form"
                      variant="primary-soft"
                      disabled={busy || hostNeedsCredential}
                      onClick={(e) => {
                        if (e.currentTarget.form?.reportValidity()) {
                          e.preventDefault();
                          void saveHostDraft(true);
                        }
                      }}
                    >
                      {t("saveTest")}
                    </Button>
                    <Button
                      type="submit"
                      form="host-editor-form"
                      disabled={busy || hostNeedsCredential}
                    >
                      {t("save")}
                    </Button>
                  </ModalActions>
                </form>
                {managingHostCredentials && (
                  <CredentialManager
                    data={data}
                    close={() => setManagingHostCredentials(false)}
                    onSnapshot={(snapshot) => {
                      accept(snapshot);
                      setHostDraft((draft) => {
                        if (!draft) return draft;
                        const catalog = new Set(snapshot.loginCredentials?.map(({ id }) => id));
                        const credentialIds = draft.credentialIds?.filter((id) => catalog.has(id));
                        const defaultRemoved = draft.defaultLoginId &&
                          draft.credentialIds?.includes(draft.defaultLoginId) &&
                          !credentialIds?.includes(draft.defaultLoginId);
                        const saved = snapshot.hosts.find((host) => host.id === draft.id);
                        return {
                          ...draft,
                          credentialIds,
                          defaultLoginId: defaultRemoved
                            ? (draft.credentialOnly ? credentialIds?.[0] ?? null : null)
                            : draft.defaultLoginId,
                          ...(saved && {
                            user: saved.user,
                            authMethod: saved.authMethod,
                            primaryLoginLabel: saved.primaryLoginLabel,
                            identityFiles: saved.identityFiles,
                            logins: saved.logins?.filter(({ id }) => !saved.credentialIds?.includes(id)),
                          }),
                        };
                      });
                    }}
                  />
                )}
              </Modal>
            )}
            {authId && (
              <Modal
                key="authentication"
                className="authentication-modal max-w-lg sm:max-w-lg"
                title={
                  authTarget
                    ? t("authForHost", { name: authTarget.name })
                    : t("auth")
                }
                description={t(authFallback
                  ? authPromptHosts.length && authPromptHosts.every((host) => host.authMethod === "password")
                    ? "passwordRetryHint" : "authFallbackHelp"
                  : "authHelp")}
                close={() => {
                  setAuthId(null);
                  setSecret("");
                  setJumpSecrets({});
                }}
              >
                <form
                  id="authentication-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const id = authId;
                    const once = secret;
                    const hops = authPromptHosts.filter((host) => host.id !== authTarget?.id);
                    const jumps = Object.fromEntries(hops.map((host) =>
                      [host.id, jumpSecrets[credentialKey(host)] ?? ""],
                    ));
                    const remember = authPromptHosts
                      .filter((host) => rememberPasswords[credentialKey(host)])
                      .map((host) => host.id);
                    if (authTarget) {
                      automaticAttempts.current.set(id, {
                        previousRunId: data.runtimes.find(
                          (r) => r.ruleId === id,
                        )?.runId,
                        hostId: authHostId || undefined,
                      });
                    }
                    setJumpSecrets({});
                    setSecret("");
                    setAuthId(null);
                    void action(() =>
                      authHostId
                        ? bridge.testHost(authHostId, once, jumps, remember, authLogin)
                        : bridge.startRule(id, once, jumps, remember, authLogin),
                    ).then((ok) => {
                      if (!ok) automaticAttempts.current.delete(id);
                    });
                  }}
                >
                  {authPromptHosts
                    .filter((host) => host.id !== authTarget?.id)
                    .map((h) => (
                      <AuthenticationField
                        key={credentialKey(h)}
                        host={h}
                        value={jumpSecrets[credentialKey(h)] || ""}
                        onChange={(value) =>
                          setJumpSecrets({ ...jumpSecrets, [credentialKey(h)]: value })
                        }
                        remember={!!rememberPasswords[credentialKey(h)]}
                        onRemember={(value) =>
                          setRememberPasswords((old) => ({
                            ...old,
                            [credentialKey(h)]: value,
                          }))
                        }
                      />
                    ))}
                  {authTarget &&
                  authPromptHosts.some((host) => host.id === authTarget.id) ? (
                    <AuthenticationField
                      host={authTarget}
                      labelContext="account"
                      value={secret}
                      onChange={setSecret}
                      remember={!!rememberPasswords[credentialKey(authTarget)]}
                      onRemember={(value) =>
                        setRememberPasswords((old) => ({
                          ...old,
                          [credentialKey(authTarget)]: value,
                        }))
                      }
                      actions={
                        <Button
                          type="submit"
                          form="authentication-form"
                          variant="primary-soft"
                        >
                          {t("connect")}
                        </Button>
                      }
                    />
                  ) : (
                    <ModalActions>
                      <Button
                        type="submit"
                        form="authentication-form"
                        variant="primary-soft"
                      >
                        {t("connect")}
                      </Button>
                    </ModalActions>
                  )}
                </form>
              </Modal>
            )}
            {pending && (
              <Modal
                key="trust"
                className="trust-modal max-w-lg sm:max-w-lg"
                title={
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheckIcon
                      className="size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    {t("trust")}
                  </span>
                }
                description={t("trustHelp")}
                close={() => void stop(pending.ruleId)}
              >
                <div className="trust-details">
                  <strong className="trust-host">
                    {pending.verificationEndpoint}
                  </strong>
                  <code className="fingerprint">{pending.fingerprint}</code>
                </div>
                <ModalActions className="trust-actions">
                  <Button
                    variant="destructive"
                    onClick={() => void stop(pending.ruleId)}
                  >
                    {t("trustReject")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        bridge.trustHost(
                          pending.ruleId,
                          pending.runId,
                          pending.fingerprint!,
                        ),
                      )
                    }
                  >
                    {t("trustAccept")}
                  </Button>
                </ModalActions>
              </Modal>
            )}
          </AnimatePresence>
        </div>
      </PresetCommandProvider>
    </FileWorkspaceProvider></TerminalWorkspaceProvider>
  );
}

function ForwardRunButton({
  runtime,
  start,
  stop,
}: {
  runtime?: Pick<Runtime, "status">;
  start: () => void;
  stop: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const active =
    runtime &&
    !["stopped", "failed", "needs-attention"].includes(runtime.status);
  const label = t(active ? "stop" : "forwardAction");
  return (
    <Button
      className="nodrag nopan"
      variant={active ? "destructive" : "primary-soft"}
      size="sm"
      onClick={active ? stop : start}
      aria-label={label}
    >
      {active ? <SquareIcon size={14} /> : <PlayIcon size={14} />}
      {label}
    </Button>
  );
}
function HostDetails({
  data,
  busy,
  selected,
  setSelected,
  onTest,
  onStopTest,
}: {
  data: Snapshot;
  busy: boolean;
  selected: string;
  setSelected: (s: string) => void;
  onTest: (id: string) => void;
  onStopTest: (id: string) => void;
}) {
  const { t } = useTranslation("tunnel");
  const savedHost = data.hosts.find((item) => item.id === selected);
  const host = resolvedDefaultLogin(savedHost) ?? savedHost;
  const testRuntime = data.runtimes.find((runtime) => runtime.ruleId === "host-test:" + selected);
  const fieldSources = Object.entries(host?.fieldSources ?? {});

  return (
    <AnimatePresence>
      {host && (
        <Modal key={host.id} title={host.name} close={() => setSelected("")}
          className="max-w-md sm:max-w-md">
          <div className="host-detail">
            <section className="host-detail-section">
              <div className="host-detail-heading">
                <h3>{t("connectionInfo")}</h3>
                {testRuntime ? <Status runtime={testRuntime} /> : (
                  <span className="status"><i aria-hidden="true" />{t("untested")}</span>
                )}
              </div>
              <dl className="detail-facts host-connection-facts">
                <div><dt>{t("address")}</dt><dd><code>{endpoint(host.address, host.port)}</code></dd></div>
                <div><dt>{t("user")}</dt><dd>{host.user}</dd></div>
                <div>
                  <dt>{t("authMethod")}</dt>
                  <dd>{t(hostAuthLabels[hostAuthMethod(host, testRuntime)])}</dd>
                </div>
                <div>
                  <dt>{t("proxyJump")}</dt>
                  <dd>{jumpHosts(data.hosts, host).map((jump) => jump.name).join(" → ") ||
                    host.proxyJump || t("directConnection")}</dd>
                </div>
                {!!host.tags.length && <div><dt>{t("tags")}</dt><dd>{host.tags.join(", ")}</dd></div>}
              </dl>
              {testRuntime?.message && (
                <p className={testRuntime.status === "tested" ? "host-test-success" : "inline-error"}>
                  {formatNativeMessage(testRuntime.message)}
                </p>
              )}
            </section>
            {host.sourceFile && (
              <section className="host-detail-section">
                <h3>{t("source")}</h3>
                <code className="host-detail-source">{host.sourceFile}</code>
              </section>
            )}
            <details className="host-detail-disclosure">
              <summary>{t("advanced")}</summary>
              <dl className="detail-facts host-connection-facts">
                <div><dt>{t("identityAgentTitle")}</dt><dd>{host.identityAgent || t("systemDefault")}</dd></div>
                <div><dt>{t("connectTimeout")}</dt><dd>{host.connection.connectTimeoutSecs}</dd></div>
                <div><dt>{t("keepaliveInterval")}</dt><dd>{host.connection.keepaliveIntervalSecs}</dd></div>
                <div><dt>{t("keepaliveMax")}</dt><dd>{host.connection.keepaliveMax}</dd></div>
                {!!host.identityFiles.length && (
                  <div className="host-detail-key-paths">
                    <dt>{t("identity")}</dt><dd>{host.identityFiles.join("\n")}</dd>
                  </div>
                )}
              </dl>
            </details>
            {!!fieldSources.length && (
              <details className="host-detail-disclosure">
                <summary>{t("fieldSources")}</summary>
                <dl className="detail-facts host-connection-facts">
                  {fieldSources.map(([field, source]) => (
                    <div key={field}><dt>{field}</dt><dd>{source}</dd></div>
                  ))}
                </dl>
              </details>
            )}
            {!!host.configuredForwards?.length && (
              <details className="host-detail-disclosure">
                <summary>{t("sourceForwards")}</summary>
                <ul className="host-detail-source">
                  {host.configuredForwards.map((forward, index) => <li key={index}><code>{forward}</code></li>)}
                </ul>
              </details>
            )}
            {!!host.unsupportedSessionOptions?.length && (
              <p className="muted">
                {t("sessionOptionsHint", { options: host.unsupportedSessionOptions.join(", ") })}
              </p>
            )}
            {host.diagnostics.map((message, index) => (
              <p className="inline-error" key={index}>{formatNativeMessage(message)}</p>
            ))}
          </div>
          <ModalActions>
            <HostTestButton hostName={host.name} runtime={testRuntime}
              disabled={busy || !bridge.desktop || !!host.diagnostics.length}
              onTest={() => onTest(host.id)} onStop={() => onStopTest(host.id)} />
          </ModalActions>
        </Modal>
      )}
    </AnimatePresence>
  );
}

type CardData = {
  listeningPorts?: string[];
  runtimes?: CardRuntime[];
  onOpenService: (id: string, internalVnc?: boolean) => void;
  onHostEdit: (host: Host) => void;
  onHostAddForward: (id: string, kind: "R" | "D") => void;
  onOpenProxyBrowser: (id: string, browser: bridge.ProxyBrowser, serviceId?: string) => void;
  canAdd: boolean;
  onPortMove: (
    id: string,
    value: PortPlacement | null,
    commit: boolean,
  ) => void;
  local: boolean;
  ports: CardPort[];
  rules?: Rule[];
  host?: Host;
  services?: Snapshot["services"];
  count?: number;
};
type CardNode = Node<CardData, "card">;
type CardPort = {
  custom?: PortPlacement;
  serviceId?: string;
  ruleId: string;
  side: Position;
  type: "source" | "target";
  label: string;
  name: string;
  color: string;
};
function CardPorts({
  ports,
  listeningPorts,
  localOffsets,
  labels = true,
  onMove,
  onDragChange,
}: {
  ports: CardPort[];
  listeningPorts: ReadonlySet<string>;
  localOffsets?: number[];
  labels?: boolean;
  onMove?: CardData["onPortMove"];
  onDragChange?: (dragging: boolean) => void;
}) {
  return ports.map((port, portIndex) => {
    if (localOffsets && onMove && onDragChange)
      return (
        <LocalPortHandle
          key={port.ruleId}
          port={port}
          listening={listeningPorts.has(port.ruleId)}
          offset={localOffsets[portIndex]}
          onChange={onMove}
          onDragChange={onDragChange}
        />
      );
    const peers = ports.filter((item) => item.side === port.side);
    const index = peers.indexOf(port);
    const horizontal =
      port.side === Position.Top || port.side === Position.Bottom;
    const offset = `${((index + 1) / (peers.length + 1)) * 100}%`;
    const placement: CSSProperties = horizontal
      ? { left: offset }
      : { top: offset };
    return (
      <ConnectionPort
        key={port.ruleId}
        id={canvasPortId(port.ruleId, port.type)}
        type={port.type}
        position={port.side}
        className="connection-port nodrag nopan nokey"
        listening={listeningPorts.has(port.ruleId)}
        data-rule-endpoint={port.ruleId}
        aria-label={`${port.name} · ${port.label}`} aria-haspopup="dialog" role="button" tabIndex={0}
        title={`${port.name} · ${port.label}`}
        style={
          {
            ...placement,
            "--connection-color": port.color,
          } as CSSProperties
        }
      >
        {labels && <span className="connection-port-label">{port.label}</span>}
      </ConnectionPort>
    );
  });
}
function Card({ id, data: d }: NodeProps<CardNode>) {
  return <CardContent id={id} data={d} />;
}
// React Flow updates node coordinates on every pointer move. Only these props
// affect the card contents; moving a host must not rebuild all of its menus.
const CardContent = memo(function CardContent({
  id,
  data: d,
}: Pick<NodeProps<CardNode>, "id" | "data">) {
  const { t } = useTranslation("tunnel");
  const nav = useContext(CanvasNavigation);
  const listeningPorts = useMemo(() => new Set(d.listeningPorts), [d.listeningPorts]);
  const hostUser = resolvedDefaultLogin(d.host)?.user ?? d.host?.user;
  // Opacity only: transforms belong to React Flow and port measurement.
  const entrance = useEntranceMotion(0);
  const updateInternals = useUpdateNodeInternals();
  const [portDragSize, setPortDragSize] = useState<ReturnType<
    typeof localCardSize
  > | null>(null);
  const portLayout = d.ports
    .map(
      (port) =>
        `${port.ruleId}:${port.type}:${port.side}:${port.serviceId ?? ""}:${port.custom?.offset ?? "auto"}`,
    )
    .join("|");
  const idealSize = localCardSize(d.ports);
  const localSize = portDragSize ? {
    width: Math.max(portDragSize.width, idealSize.width),
    height: Math.max(portDragSize.height, idealSize.height),
  } : idealSize;
  useLayoutEffect(() => {
    updateInternals(id);
  }, [id, portLayout, localSize.width, localSize.height, d.services, d.rules, updateInternals]);
  if (d.local)
    return (
      <motion.article
        className="tunnel-card themed-surface local-card"
        {...entrance}
        style={localSize}
        aria-label={`${t("local")} · ${t("forwardCount", { count: d.count || 0 })}`}
      >
        <CardPorts listeningPorts={listeningPorts}
          ports={d.ports}
          localOffsets={localPortOffsets(d.ports, localSize)}
          onMove={d.onPortMove}
          onDragChange={(dragging) =>
            setPortDragSize(dragging ? idealSize : null)
          }
        />
        <div className="local-computer" aria-hidden="true">
          <MonitorIcon />
          <strong>{d.count || 0}</strong>
        </div>
        <FileTransferPorts /><FileTransferStatus nodeId="local" className="files-local-status" />
        <div className="local-card-heading">
          <span className="local-card-title">{t("local")}</span>
        </div>
        <CardEdge source={{ type: "local" }} disabled={!d.canAdd} />
      </motion.article>
    );
  const renderPorts = (rules: Rule[]) => {
    const ids = new Set(rules.map(rule => rule.id));
    const ports = d.ports.filter(port => ids.has(port.ruleId) &&
      (port.side === Position.Left || port.side === Position.Right));
    if (!ports.length) return null;
    const leftCount = ports.filter(port => port.side === Position.Left).length;
    const slots = Math.max(leftCount, ports.length - leftCount);
    return <div className="canvas-port-rail" style={{ minHeight: (slots + 1) * 16 }}>
      <CardPorts listeningPorts={listeningPorts} ports={ports} labels={false} />
    </div>;
  };
  const rules = d.rules ?? [];
  const localForwards = rules.filter(rule => rule.kind === "L");
  const otherForwards = rules.filter(rule => rule.kind !== "L");
  const serviceForRule = new Map(d.ports.filter(port => port.serviceId).map(port => [port.ruleId, port.serviceId]));
  return (
    <motion.article
      data-link-host={d.host?.id} aria-label={d.host?.name}
      data-link-target={d.host && !d.host.diagnostics.length ? "" : undefined}
      className="tunnel-card themed-surface host-card"
      style={{ "--canvas-focus-color": d.host?.appearance?.color } as CSSProperties}
      {...entrance}
    >
      <CardPorts listeningPorts={listeningPorts}
        ports={d.ports.filter(
          (port) => port.side === Position.Top || port.side === Position.Bottom,
        )}
        labels={false}
      />
      <div className="host-card-file-anchor">
        <FileTransferPorts host />
        {!d.host && renderPorts(d.rules ?? [])}
        <div className="card-heading">
          <span className="card-icon" style={{ color: d.host?.appearance?.color ?? undefined }}>
            {d.host?.appearance?.icon
              ? <ConnectionIcon icon={d.host.appearance.icon} color={d.host.appearance.color} />
              : <ServerIcon size={21} aria-hidden="true" />}
          </span>
          <div className="host-card-heading-content">
            <h2 title={d.host?.name || t("sourceMissing")}>{d.host?.name || t("sourceMissing")}</h2>
            {d.host && <code title={`${hostUser}@${endpoint(d.host.address, d.host.port)}`}>
              {hostUser}@{endpoint(d.host.address, d.host.port)}
            </code>}
          </div>
          {d.host && <div className="host-quick-actions nodrag nopan nokey">
            <FileTransferStatus nodeId={`host:${d.host.id}`} />
            <OpenFilesButton hostId={d.host.id} disabled={!d.canAdd} />
            <OpenTerminalButton hostId={d.host.id} disabled={!d.canAdd} />
            {nav && <HostCredentialMenu host={d.host} disabled={!d.canAdd}
              onSelect={(loginId) => nav.setDefaultLogin(d.host!, loginId)} />}
            <AddHostService hostId={d.host.id} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost"
                disabled={!d.canAdd || !!d.host.diagnostics.length}
                aria-label={t("add")} title={t("add")} />}>
                <ForwardIcon add />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="host-actions-menu">
                <DropdownMenuItem onClick={() => d.onHostAddForward(d.host!.id, "R")}>
                  <ArrowUpRightIcon aria-hidden="true" />{t("typeRShort")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => d.onHostAddForward(d.host!.id, "D")}>
                  <NetworkIcon aria-hidden="true" />{t("typeDShort")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost"
                aria-label={`${t("management")} · ${d.host.name}`} title={t("management")} />}>
                <EllipsisIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="host-actions-menu">
                <DropdownMenuItem onClick={() => nav?.logs(d.host!.id)}>
                  <ScrollTextIcon aria-hidden="true" />{t("activity")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => nav?.details(d.host!.id)}>
                  <InfoIcon aria-hidden="true" />{t("details")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => d.onHostEdit(d.host!)}>
                  <Settings2Icon aria-hidden="true" />{t("edit")}
                </DropdownMenuItem>
                {nav && d.host.source === "config" && (
                  <DropdownMenuItem
                    disabled={!d.canAdd || d.host.diagnostics.some(message => nativeMessageKey(message) !== "hostSourceLost")}
                    onClick={() => nav.copyHost(d.host!)}
                  >
                    <CopyPlusIcon aria-hidden="true" />{t("copyHost")}
                  </DropdownMenuItem>
                )}
                {nav && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={!bridge.desktop}
                      onClick={() => nav.removeHost(d.host!)}>
                      <Trash2Icon aria-hidden="true" />{t("deleteHost")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>}
        </div>
      </div>
      {d.host && <>
        <HostServices
          host={d.host}
          canLink={d.canAdd}
          forwardsFor={serviceId => localForwards.filter(rule => serviceForRule.get(rule.id) === serviceId)}
          renderPorts={renderPorts}
          forwardControls={rule => {
            const runtime = d.runtimes?.find(item => item.ruleId === rule.id);
            return {
              runtime,
              traffic: `↑ ${bytes(runtime?.sent ?? 0)}　↓ ${bytes(runtime?.received ?? 0)}`,
              open: <OpenServiceButton rule={rule} runtime={runtime} desktop={bridge.desktop} onOpen={d.onOpenService} />,
            };
          }}
          standaloneForwards={localForwards.filter(rule => !serviceForRule.has(rule.id))
            .map(rule => <CanvasForwardRow key={rule.id} rule={rule} data={d} listeningPorts={listeningPorts} />)}
        />
        {!!otherForwards.length && <section className="host-card-group host-card-rules">
          <h3 className="host-card-group-title">{t("tunnels")}</h3>
          {otherForwards.map(rule => <CanvasForwardRow key={rule.id} rule={rule} data={d} listeningPorts={listeningPorts} />)}
        </section>}
      </>}
    </motion.article>
  );
});
function CanvasForwardRow({ rule, data: d, listeningPorts }: {
  listeningPorts: ReadonlySet<string>;
  rule: Rule;
  data: CardData;
}) {
  const { t } = useTranslation("tunnel");
  const runtime = d.runtimes?.find((item) => item.ruleId === rule.id);
  const type = t(`type${rule.kind}`);
  const remote = rule.kind === "R";
  const protocol = rule.kind === "D" ? "SOCKS5" : rule.serviceProtocol?.toUpperCase();
  const bind = endpoint(rule.bindAddress, remote ? rule.bindPort : rule.bindPort || t("autoPort"));
  const target = endpoint(rule.targetHost, rule.targetPort);
  const listenerAddress = remote ? (
    <code className="canvas-path-address" title={bind}>
      <span>{endpoint(rule.bindAddress, "")}</span>
      <button type="button" className="connection-port-number nodrag nopan nokey"
        data-edit-port={rule.id} data-port-side="host" aria-label={`${t("edit")} · ${bind}`}>
        {rule.bindPort}
      </button>
    </code>
  ) : <code title={bind}>{bind}</code>;
  const targetAddress = rule.kind === "D" ? (
    <code className="canvas-path-address">
      <span>SSH&nbsp;</span>
      <span className="connection-port-number">{d.host?.port || 22}</span>
    </code>
  ) : (
    <code className="canvas-path-address" title={target}>
      <span>{endpoint(rule.targetHost, "")}</span>
      {rule.kind === "L" ? (
        <button type="button" className="connection-port-number nodrag nopan nokey"
          data-edit-port={rule.id} data-port-side="host" aria-label={`${t("edit")} · ${target}`}>
          {rule.targetPort}
        </button>
      ) : <span>{rule.targetPort}</span>}
    </code>
  );
  const DirectionIcon = remote ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <section
      className="host-card-rule"
      data-canvas-rules={rule.id}
      aria-label={rule.name}
      style={
        {
          "--connection-color":
            rule.color || "var(--oria-color-accent)",
        } as CSSProperties
      }
    >
      {rule.kind !== "L" && <CardEdge source={{
        type: "forward", hostId: rule.hostId, ruleId: rule.id, name: rule.name,
      }} disabled={!d.canAdd} />}
      <div className="host-rule-heading">
        <h4 className="rule-name">
          <ConnectionIcon icon={rule.icon} color={rule.color} />
          <span title={rule.name}>{rule.name}</span>
        </h4>
        <Status runtime={runtime} />
      </div>
      <div className="host-rule-meta">
        <button type="button" className="host-rule-type nodrag nopan nokey"
          data-rule-endpoint={rule.id} aria-haspopup="dialog"
          aria-label={`${type} · ${rule.name}`} title={type}>
          {type}
        </button>
        <small className="host-rule-traffic">
          ↑ {bytes(runtime?.sent ?? 0)}　↓{" "}
          {bytes(runtime?.received ?? 0)}
        </small>
      </div>
      <div className="port-path">
        <CardPorts listeningPorts={listeningPorts}
          ports={d.ports.filter(
            (p) =>
              p.ruleId === rule.id &&
              p.side !== Position.Top &&
              p.side !== Position.Bottom,
          )}
          labels={false}
        />
        {protocol && <div className="canvas-path-access">
          <span className="canvas-path-type">{protocol}</span>
          {rule.kind === "D" ? (
            <OpenProxyBrowserButton
              rule={rule}
              runtime={runtime}
              desktop={bridge.desktop}
              onOpen={d.onOpenProxyBrowser}
            />
          ) : (
            <OpenServiceButton
              rule={rule}
              runtime={runtime}
              desktop={bridge.desktop}
              onOpen={d.onOpenService}
            />
          )}
        </div>}
        <div className="canvas-path-route">
          {remote ? targetAddress : listenerAddress}
          <DirectionIcon aria-hidden="true" />
          {remote ? listenerAddress : targetAddress}
        </div>
      </div>
      <ProxyServiceButtons
        rule={rule}
        runtime={runtime}
        services={d.services}
        desktop={bridge.desktop}
        onOpen={d.onOpenProxyBrowser}
        expandable
      />
      {runtime?.configurationChanged && (
        <p className="muted">{t("configUpdated")}</p>
      )}
      {runtime?.message && (
        <p className="inline-error">
          {formatNativeMessage(runtime.message)}
        </p>
      )}
    </section>
  );
}
const nodeTypes = { card: Card };
const edgeTypes = { connection: ConnectionEdge, "file-transfer": FileTransferEdge };
const CanvasFlow = memo(ReactFlow<CardNode>);
const canvasProOptions = { hideAttribution: true };
const hostCardShortcuts = { "aria-keyshortcuts": "Backspace Delete" } as const;
const canvasFitOptions = { padding: { x: "4%", top: "48px", bottom: "80px" }, maxZoom: 1 } as const;
const canvasStyle = { "--canvas-port-size": `${canvasPortSize}px`, "--wire-travel": `${wireTravelMs}ms` } as CSSProperties;
const canvasBackground = <Background gap={24} size={1} />;
type CardActions = Pick<CardData, "onHostEdit" | "onHostAddForward" | "onOpenProxyBrowser" | "onOpenService">;
function useCardActions(actions: CardActions) {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  return useMemo<CardActions>(
    () => ({
      onOpenService: (id, internal) => latest.current.onOpenService(id, internal),
      onHostEdit: (host) => latest.current.onHostEdit(host),
      onHostAddForward: (id, kind) => latest.current.onHostAddForward(id, kind),
      onOpenProxyBrowser: (id, browser, serviceId) => latest.current.onOpenProxyBrowser(id, browser, serviceId),
    }),
    [],
  );
}
function TunnelCanvas({
  highlight,
  onHighlightDone,
  detailsOpen,
  data,
  onAddHost,
  onUndoDelete,
  onEditPort,
  hostPlacement,
  onHostsPlaced,
  onHostEdit,
  onHostAddForward,
  onCreateServiceForward,
  onLinkForwardHost,
  canAdd,
  onOpenService,
  onOpenProxyBrowser,
  onStart,
  onStop,
  onEdit,
  onDetails,
  onCopy,
  onDelete,
  focusRuleId,
  onFocusDone,
}: {
  highlight?: CanvasMatch;
  onHighlightDone: () => void;
  detailsOpen: boolean;
  data: Snapshot;
  onAddHost: (point: CanvasPoint | null) => void;
  onUndoDelete: (kind: "host" | "forward") => void;
  onEditPort: (rule: Rule, side: "local" | "host") => void;
  hostPlacement: HostPlacement | null;
  onHostsPlaced: () => void;
  onHostEdit: (host: Host) => void;
  onHostAddForward: CardData["onHostAddForward"];
  onCreateServiceForward: (hostId: string, serviceId: string) => Promise<string | undefined>;
  onLinkForwardHost: (ruleId: string, hostId: string) => void;
  canAdd: boolean;
  onOpenService: (id: string, internalVnc?: boolean) => void;
  onOpenProxyBrowser: (
    id: string,
    browser: bridge.ProxyBrowser,
    serviceId?: string,
  ) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => unknown;
  onEdit: (rule: Rule) => void;
  onDetails: (rule: Rule) => void;
  onCopy: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  focusRuleId: string;
  onFocusDone: () => void;
}) {
  const navigation = useContext(CanvasNavigation);
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuPoint = useRef<CanvasPoint | null>(null);
  const fileActivities = useFileActivities();
  const { t } = useTranslation("tunnel");
  const hasUndoHistory = data.hostUndoCount > 0 || data.forwardUndoCount > 0;
  const flow = useReactFlow<CardNode>();
  const nodesReady = useNodesInitialized();
  useEffect(() => {
    if (!highlight || !nodesReady) return;
    const host = canvasRef.current?.querySelector(`[data-id="${CSS.escape("host:" + highlight.hostId)}"]`);
    if (!host) return;
    const detail = highlight.serviceId ? host.querySelector(`[data-canvas-service="${CSS.escape(highlight.serviceId)}"]`) :
      highlight.ruleId ? host.querySelector(`[data-canvas-rules~="${CSS.escape(highlight.ruleId)}"]`) : null;
    const card = detail ?? host.querySelector(".tunnel-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const center = flow.screenToFlowPosition({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    void flow.setCenter(center.x, center.y, { zoom: 1 });
    card.classList.add("canvas-search-match");
    const canvas = canvasRef.current;
    const timeout = window.setTimeout(onHighlightDone, 1500);
    canvas?.addEventListener("pointerdown", onHighlightDone, { capture: true, once: true });
    return () => {
      window.clearTimeout(timeout);
      canvas?.removeEventListener("pointerdown", onHighlightDone, true);
      card.classList.remove("canvas-search-match");
    };
  }, [highlight, nodesReady, flow, onHighlightDone]);

  const cardActions = useCardActions({
    onHostEdit, onHostAddForward, onOpenProxyBrowser, onOpenService,
  });
  useEffect(() => {
    if (
      focusRuleId &&
      nodesReady &&
      data.rules.some((r) => r.id === focusRuleId)
    ) {
      void flow
        .fitView({
          nodes: [
            { id: "local" },
            {
              id: `host:${data.rules.find((r) => r.id === focusRuleId)!.hostId}`,
            },
          ],
          padding: 0.5,
          maxZoom: 1,
          duration: 200,
        })
        .then(onFocusDone);
    }
  }, [focusRuleId, nodesReady, data.rules, flow, onFocusDone]);
  const [initialViewport] = useState<Viewport | undefined>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("oria-tunnel-viewport") || "null",
      );
      return value &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        Number.isFinite(value.zoom) &&
        value.zoom >= 0.2 &&
        value.zoom <= 2
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >(() => {
    try {
      return readCanvasLayout(localStorage.getItem("oria-tunnel-layout"));
    } catch {
      return {};
    }
  });
  useLayoutEffect(() => {
    if (!hostPlacement || !nodesReady || !canvasRef.current) return;
    const cards = flow.getNodes();
    const ids = new Set(hostPlacement.ids.map((id) => `host:${id}`));
    const added = cards.filter((card) => ids.has(card.id));
    if (
      added.length !== ids.size ||
      added.some((card) => !card.measured?.width || !card.measured.height)
    )
      return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const center = flow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    const occupied = cards
      .filter((card) => !ids.has(card.id) || positions[card.id])
      .map((card) => ({
        ...(positions[card.id] ?? card.position),
        width: card.measured?.width ?? 360,
        height: card.measured?.height ?? 224,
      }));
    const next = { ...positions };
    for (const card of added) {
      if (next[card.id]) continue;
      const size = { width: card.measured!.width!, height: card.measured!.height! };
      const origin = hostPlacement.origin ?? {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
      };
      const point = availableHostPosition(origin, size, occupied);
      next[card.id] = point;
      occupied.push({ ...point, ...size });
    }
    setPositions(next);
    try {
      localStorage.setItem("oria-tunnel-layout", JSON.stringify(next));
    } catch (error) {
      console.error("Unable to save host layout", error);
    }
    const first = added[0];
    const point = next[first.id];
    void flow.setCenter(
      point.x + first.measured!.width! / 2,
      point.y + first.measured!.height! / 2,
      {
        zoom: Math.min(
          flow.getZoom(),
          bounds.width / (first.measured!.width! + 64),
          bounds.height / (first.measured!.height! + 128),
        ),
      },
    );
    onHostsPlaced();
  }, [hostPlacement, nodesReady, flow, positions, onHostsPlaced, data.hosts]);
  const [portPlacements, setPortPlacements] = useState(() => {
    try {
      return readPortPlacements(localStorage.getItem(PORT_LAYOUT_KEY));
    } catch {
      return {};
    }
  });
  const latestPortPlacements = useRef(portPlacements);
  const onPortMove = useCallback<CardData["onPortMove"]>(
    (id, value, commit) => {
      const next = { ...latestPortPlacements.current };
      if (value) next[id] = value;
      else delete next[id];
      latestPortPlacements.current = next;
      setPortPlacements(next);
      if (commit) {
        try {
          localStorage.setItem(PORT_LAYOUT_KEY, JSON.stringify(next));
        } catch (error) {
          console.error("Unable to save local port layout", error);
        }
      }
    },
    [],
  );
  const previousRoutes = useRef<Rule[]>([]);
  const routes = useMemo(() => projectCanvasRoutes(data.rules, data.runtimes, previousRoutes.current), [data.rules, data.runtimes]);
  useLayoutEffect(() => { previousRoutes.current = routes; }, [routes]);
  const groups = useMemo(() => canvasHostGroups(routes, addedHosts(data)), [
    routes, data.hosts, data.rules, data.addedHostIds,
  ]);
  const localServices = useMemo(() => {
    const matches = new Map<string, RemoteService>();
    for (const { host, rules } of groups) {
      if (!host || !rules.some(rule => rule.kind === "L")) continue;
      const services = (data.services ?? []).filter(
        service => serviceHostIds(service, data).includes(host.id),
      );
      const byId = new Map(services.map(service => [service.id, service]));
      for (const [ruleId, serviceId] of localForwardServiceIds(host, rules, services)) {
        const service = byId.get(serviceId);
        if (service) matches.set(ruleId, service);
      }
    }
    return matches;
  }, [groups, data.rules, data.services]);
  const projectedNodes = useMemo<CardNode[]>(() => {
    const layout = groupPositions(groups, positions, data.services);
    const local = positions.local || { x: 0, y: 0 };
    const localPorts: CardPort[] = [];
    const hostPorts: Record<string, CardPort[]> = {};
    for (const group of groups) {
      hostPorts[group.id] = group.rules.map((rule) => {
        const labels = connectionPorts(rule, group.host?.port, t("autoPort"));
        const service = localServices.get(rule.id);
        const color = (service ?? rule).color || "var(--oria-color-accent)";
        const hostPosition = layout[group.id];
        const side = portPlacements[rule.id]?.side || localPortSide(local, hostPosition);
        const serviceId = service?.id;
        localPorts.push({
          custom: portPlacements[rule.id],
          ruleId: rule.id,
          name: rule.name,
          label: labels.local,
          color,
          side,
          type: rule.kind === "R" ? "target" : "source",
        });
        return {
          ruleId: rule.id,
          serviceId,
          name: rule.name,
          label: labels.host,
          color,
          side: serviceId ? serviceEndpointSide(local.x, hostPosition.x) : oppositeSide(side),
          type: rule.kind === "R" ? "source" : "target",
        };
      });
    }
    return [
      {
        id: "local",
        type: "card",
        position: local,
        data: {
          local: true,
          ...cardActions,
          canAdd,
          onPortMove,
          ports: localPorts,
          count: data.rules.length,
        },
      },
      ...groups.map((group) => ({
        id: group.id,
        type: "card" as const,
        ariaLabel: group.host?.name,
        domAttributes: group.host ? hostCardShortcuts : undefined,
        position: layout[group.id],
        data: {
          local: false,
          ...cardActions,
          canAdd,
          onPortMove,
          ports: hostPorts[group.id],
          rules: group.rules,
          host: group.host,
          services: data.services,
        },
      })),
    ];
  }, [
    groups, t,
    localServices,
    data.services,
    cardActions,
    canAdd,
    positions,
    portPlacements,
    onPortMove,
  ]);
  const previousRuntimes = useRef<CardRuntime[]>([]);
  const cardRuntimes = useMemo(
    () => projectCardRuntimes(data.runtimes, previousRuntimes.current),
    [data.runtimes],
  );
  const runtimeByRule = useMemo(
    () => new Map(cardRuntimes.map((runtime) => [runtime.ruleId, runtime])),
    [cardRuntimes],
  );
  useLayoutEffect(() => {
    previousRuntimes.current = cardRuntimes;
  }, [cardRuntimes]);
  const liveNodes = useMemo(() => projectedNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      listeningPorts: node.data.ports.filter(port => runtimeByRule.get(port.ruleId)?.status === "listening")
        .map(port => port.ruleId),
      runtimes: node.data.rules?.flatMap(rule => runtimeByRule.get(rule.id) ?? []),
    },
  })), [projectedNodes, runtimeByRule]);
  const [nodes, setNodes] = useState<CardNode[]>(liveNodes);
  useLayoutEffect(() => {
    setNodes(current => reconcileCanvasNodes(current, liveNodes));
  }, [liveNodes]);
  const previousEdges = useRef<Edge[]>([]);
  const styledRoutes = useMemo(() => routes.map(rule => {
    const service = localServices.get(rule.id);
    return service ? { ...rule, color: service.color ?? null } : rule;
  }), [routes, localServices]);
  const tunnelEdges = useMemo(() => {
    const live = new Map(data.runtimes.map(runtime => [runtime.ruleId, runtime]));
    return projectCanvasEdges(styledRoutes, live, previousEdges.current);
  }, [styledRoutes, data.runtimes]);
  const previousFileEdges = useRef<Edge[]>([]);
  const fileEdges = useMemo(() => projectFileEdges(fileActivities, nodes, previousFileEdges.current), [fileActivities, nodes]);
  const visibleFileEdges = useFileEdgePresence(fileEdges);
  useLayoutEffect(() => { previousEdges.current = tunnelEdges; previousFileEdges.current = fileEdges; }, [tunnelEdges, fileEdges]);
  // Adding a rule renders two new handles before React Flow measures them.
  // Subscribe to handle bounds only so panning and metrics keep the same edges.
  const bounds = useStore((state) => Array.from(state.nodeLookup.values(), (node) => node.internals.handleBounds), shallow);
  const readyHandles = useMemo(() => {
    const handles = new Map<string, Set<string>>();
    for (const pair of bounds) {
      if (!pair) continue;
      for (const handle of [...(pair.source ?? []), ...(pair.target ?? [])]) {
        if (!handle.id) continue;
        let ids = handles.get(handle.nodeId);
        if (!ids) handles.set(handle.nodeId, ids = new Set());
        ids.add(handle.id);
      }
    }
    return handles;
  }, [bounds]);
  const edges = useMemo(() => [
    ...tunnelEdges.filter((edge) => readyHandles.get(edge.source)?.has(edge.sourceHandle!) && readyHandles.get(edge.target)?.has(edge.targetHandle!)),
    ...visibleFileEdges.filter(edge => !edge.data?.leaving || (readyHandles.has(edge.source) && readyHandles.has(edge.target))),
  ], [tunnelEdges, visibleFileEdges, readyHandles]);
  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    try {
      localStorage.setItem("oria-tunnel-viewport", JSON.stringify(viewport));
    } catch (error) {
      console.error("Unable to save canvas viewport", error);
    }
  }, []);
  const onNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      if (
        changes.some(
          (change) =>
            change.type === "position" && change.position && !change.dragging,
        )
      ) {
        const next = canvasLayout(
          applyNodeChanges(changes, flow.getNodes()),
          positions,
        );
        setPositions(next);
        try {
          localStorage.setItem("oria-tunnel-layout", JSON.stringify(next));
        } catch (error) {
          console.error("Unable to save canvas layout", error);
        }
      }
    },
    [flow, positions],
  );
  const onNodeClick = useCallback((event: React.MouseEvent, node: CardNode) => {
    if (
      !node.data.host || !(event.target instanceof Element) ||
      event.target.closest(".nodrag, .nokey, button, a, input, textarea, select, [contenteditable]")
    ) return;
    event.target.closest<HTMLElement>(".react-flow__node")?.focus({ preventScroll: true });
  }, []);
  const onCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      !canAdd || !navigation || event.defaultPrevented || event.repeat ||
      event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.key !== "Backspace" && event.key !== "Delete") ||
      !(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__node")
    ) return;
    const selected = flow.getNodes().filter((node) => node.selected);
    if (selected.length !== 1 || selected[0].id !== event.target.dataset.id || !selected[0].data.host) return;
    event.preventDefault();
    navigation.removeHost(selected[0].data.host);
  };
  const onNodeDoubleClick = useCallback(
    (_: unknown, node: CardNode) => {
      void flow.fitView({
        nodes: [{ id: node.id }],
        padding: 0.5,
        duration: 200,
        maxZoom: 1,
      });
    },
    [flow],
  );
  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).classList.contains("react-flow__pane"))
        void flow.fitView({ ...canvasFitOptions, duration: 200 });
    },
    [flow],
  );
  return (
    <div className="canvas" style={canvasStyle} ref={canvasRef} onKeyDown={onCanvasKeyDown}>
      {nodes.length === 1 && (
        <PageEmptyState compact className="canvas-hint w-fit" icon={<GraphStarIcon />} title={t("empty")} />
      )}
      <ContextMenu>
        <ContextMenuTrigger className="canvas-mask"
          onContextMenu={(e) => {
            if (!(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) {
              e.preventBaseUIHandler();
              return;
            }
            menuPoint.current = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          }}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (e.touches.length !== 1 || !(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) {
              e.preventBaseUIHandler();
              return;
            }
            menuPoint.current = flow.screenToFlowPosition({ x: touch.clientX, y: touch.clientY });
          }}
        >
          <EndpointCards disabled={detailsOpen} onEdit={(id, side) => {
            const saved = data.rules.find((r) => r.id === id);
            if (saved) onEditPort(saved, side);
          }} render={(id, close) => {
            const rule = data.rules.find((r) => r.id === id);
            if (!rule) return null;
            const appearance = localServices.get(id) ?? rule;
            const runtime = data.runtimes.find((r) => r.ruleId === id);
            const active = displayedRoute(rule, runtime);
            const savedHostName = data.hosts.find((host) => host.id === rule.hostId)?.name;
            const hostName = (runtime?.desiredRunning ? runtime.hostSnapshot?.name : undefined) ??
              data.hosts.find((host) => host.id === active.hostId)?.name;
            const pending = runtime?.configurationChanged && runtime.desiredRunning;
            const editPort = (side: "local" | "host") => { close(); onEditPort(rule, side); };
            return <>
              <div className="canvas-service-heading">
                <strong className="rule-name"><ConnectionIcon icon={appearance.icon ?? null} color={appearance.color ?? null} /><span title={rule.name}>{rule.name}</span></strong>
                <Status runtime={runtime} />
              </div>
              <div className="canvas-service-meta">
                <span>{t(`type${active.kind}`)}</span>
                <small>↑ {bytes(runtime?.sent ?? 0)}　↓ {bytes(runtime?.received ?? 0)}</small>
              </div>
              <EndpointRoute route={active} hostName={hostName} editPort={pending ? undefined : editPort} />
              {pending && <section className="endpoint-pending">
                <strong>{t("nextStart")}</strong>
                <EndpointRoute route={rule} hostName={savedHostName} editPort={editPort} />
              </section>}
              {runtime?.message && <p className="inline-error">{formatNativeMessage(runtime.message)}</p>}
              <div className="endpoint-actions">
                <RuleActions rule={rule} onEdit={() => {close(); onEdit(rule);}} onDetails={() => {close(); onDetails(rule);}}
                  onCopy={() => {close(); onCopy(rule);}}
                  onDelete={() => {close(); onDelete(rule);}}>
                  <ForwardRunButton runtime={runtime} start={() => {close(); onStart(id);}} stop={() => void onStop(id)}/>
                </RuleActions>
              </div>
            </>;
          }}>
          <CanvasLinks onConnect={(link) => {
            if (link.type === "forward") {
              onLinkForwardHost(link.ruleId, link.hostId);
              return;
            }
            void onCreateServiceForward(link.hostId, link.serviceId).then((id) => {
              if (id && link.placement) onPortMove(id, link.placement, true);
            });
          }}>
          <CanvasFlow
            nodes={nodes}
            defaultViewport={initialViewport}
            onMoveEnd={onMoveEnd}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            zoomOnDoubleClick={false}
            onDoubleClick={onCanvasDoubleClick}
            nodesConnectable={false}
            proOptions={canvasProOptions}
            deleteKeyCode={null}
            minZoom={0.2}
            maxZoom={2}
            fitView={!initialViewport}
            fitViewOptions={canvasFitOptions}
          >
            {canvasBackground}
          </CanvasFlow>
          </CanvasLinks>
          </EndpointCards>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={!canAdd} onClick={() => onAddHost(menuPoint.current)}>
            <ServerPlusIcon aria-hidden="true" />{t("addHost")}
          </ContextMenuItem>
          {hasUndoHistory && (
            <>
              <ContextMenuSeparator />
              <UndoDeleteItems history={data} disabled={!canAdd} onUndo={onUndoDelete} />
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <div className="canvas-controls overlay">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("zoomOut")}
          onClick={() => void flow.zoomOut()}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("fit")}
          onClick={() => void flow.fitView(canvasFitOptions)}
        >
          <MaximizeIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("zoomIn")}
          onClick={() => void flow.zoomIn()}
        >
          <ZoomInIcon />
        </Button>
      </div>
    </div>
  );
}
