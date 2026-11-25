export type ApplicationIconPreference = "system" | "light" | "dark" | "mono";
export type ResolvedApplicationIcon = Exclude<ApplicationIconPreference, "system">;

export interface WindowAppearance {
  opacity: number;
  blurRadius: number;
  cornerRadius: number;
}
export interface UpdateSnapshot {
  revision: number;
  currentVersion: string;
  phase: "idle" | "checking" | "upToDate" | "available" | "downloading" | "verifying" | "ready" | "preparing" | "installing" | "error";
  unavailable: "notConfigured" | "development" | "unsupported" | null;
  autoCheck: boolean;
  preferenceError: boolean;
  release: { version: string; notes: string } | null;
  downloaded: number;
  total: number | null;
  error: "check" | "download" | "install" | "cleanup" | "activityChanged" | null;
  canDownload: boolean;
  canInstall: boolean;
}
export interface LoginIdentity {
  id: string; label?: string; user: string;
  authMethod: Host["authMethod"]; identityFiles: string[];
}
export interface Host {
  logins?: LoginIdentity[];
  credentialIds?: string[];
  credentialOnly?: boolean;
  primaryLoginLabel?: string;
  defaultLoginId?: string | null;
  activeLoginId?: string;
  appearance?: { icon: RuleIcon | null; color: string | null } | null;
  id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  identityFiles: string[];
  source: string;
  sourceFile?: string;
  diagnostics: string[];
  connection: ConnectionOptions;
  authMethod: "auto" | "password" | "privateKey" | "agent";
  tags: string[];
  hidden: boolean;
  identityAgent: string | null;
  identitiesOnly: boolean;
  proxyJump: string | null;
  algorithms?: {
    ciphers: string | null;
    kexAlgorithms: string | null;
    macs: string | null;
  };
  fieldSources: Record<string, string>;
  configuredForwards: string[];
  unsupportedSessionOptions?: string[];
}
export interface ConnectionOptions {
  connectTimeoutSecs: number;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
}
export type ServiceProtocol = "http" | "https" | "vnc";
export type DirectProtocol = ServiceProtocol | "postgresql" | "mysql" | "mongodb" | "redis" | "rediss";
export type RuleIcon = { kind: "builtin" | "emoji"; value: string };
export interface Rule {
  loginIdentityId?: string | null;
  icon: RuleIcon | null;
  serviceProtocol: ServiceProtocol | null;
  id: string;
  name: string;
  color: string | null;
  hostId: string;
  bindAddress: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
  kind: "L" | "R" | "D";
  connection: ConnectionOptions | null;
  noRemoteCommand: boolean;
  remoteCommand: string;
  background: boolean;
  reconnect: {
    enabled: boolean;
    maxAttempts: number;
    initialDelaySecs: number;
    maxDelaySecs: number;
  };
  autoConnect: boolean;
  repeatCommandOnReconnect: boolean;
}
export type ForwardRoute = Pick<Rule, "kind" | "hostId" | "bindAddress" | "bindPort" | "targetHost" | "targetPort">;

export interface Runtime {
  activeRoute?: ForwardRoute | null;
  boundAddress?: string | null;
  boundPort?: number | null;
  ruleId: string;
  runId: string;
  status: string;
  message: string;
  fingerprint?: string;
  sent: number;
  received: number;
  connections: number;
  configurationChanged: boolean;
  hostSnapshot?: Host;
  verificationEndpoint?: string;
  errorKind?: string;
  authMethodUsed?: Host["authMethod"];
  desiredRunning: boolean;
  retryCount: number;
  retryAt?: number;
  uptimeSecs: number;
  sentPerSecond?: number;
  receivedPerSecond?: number;
  targetHealth: {
    state?: string;
    checkedAt?: number;
    side?: string;
    method?: string;
  };
  history: {
    timestamp: number;
    sentPerSecond: number;
    receivedPerSecond: number;
  }[];
}
export interface ActivityRecord {
  hostId?: string; loginIdentityId?: string; username?: string; serviceIds?: string[];
  timestamp: number;
  ruleId: string;
  runId: string;
  event: string;
  errorKind?: string;
  retryCount: number;
  level: string;
}
export interface BatchResult {
  id: string;
  accepted: boolean;
  error?: string;
}
export interface ImportPreview {
  // The preview contains only the Rust-validated allowlist, never the input document.
  token: string;
  fileName: string;
  version?: number;
  selectedHostIds?: string[];
  services?: ImportServicePreview[];
  hosts: {
    id: string;
    name: string;
    endpoint: string;
    conflict: boolean;
    keyPathsOmitted: boolean;
    keyPaths: string[];
    proxyJump?: string;
    blocked: boolean;
    logins?: { id: string; label: string; user: string }[];
  }[];
  rules: {
    id: string;
    name: string;
    hostId: string;
    path: string;
    conflict: boolean;
    listenerConflict: boolean;
    commandOmitted: boolean;
  }[];
}
export type ImportSource =
  | { kind: "upload"; fileName: string; content: string }
  | { kind: "path"; path: string };
export interface ImportChoices {
  hostIds?: string[];
  ruleIds: string[];
  serviceIds?: string[];
  reuseHosts: Record<string, string>;
  reuseLogins?: Record<string, Record<string, string>>;
  forwardOnly: boolean;
}
export type ConfigExportMode = "migration" | "share";
export interface ConfigExportSelection {
  hostIds: string[];
  ruleIds: string[];
  serviceIds: string[];
  includeServiceCommands: boolean;
}
export interface ConfigExportPreview {
  fingerprint: string;
  hosts: { id: string; name: string; endpoint: string; dependency: boolean }[];
  serviceCount: number;
  ruleCount: number;
  logins: { id: string; label: string; user: string }[];
}
export interface Snapshot {
  services?: RemoteService[];
  loginCredentials?: LoginIdentity[];
  passwordStorageSupported?: boolean;
  hosts: Host[];
  addedHostIds?: string[];
  rules: Rule[];
  runtimes: Runtime[];
  diagnostics: string[];
  revision: number;
  closeToTray: boolean;
  agentSupported: boolean;
  sourceFiles: string[];
  autoSyncHosts: boolean;
  activity: ActivityRecord[];
  hostUndoCount: number;
  forwardUndoCount: number;
  autostart: boolean;
  autostartSupported: boolean;
  autostartError?: string;
}

export interface HostDeletionImpact {
  rules: Rule[];
  services: { id: string; name: string; revision: string; remove: boolean }[];
  active: boolean;
}

export type CommandKind = "start" | "stop" | "restart" | "status" | "logs" | "custom";
export interface CommandArgument { name: string; value: string | null }
export interface CommandEnvironment { name: string; value: string }
export interface CommandInvocation { executable: string; arguments: CommandArgument[]; environment?: CommandEnvironment[]; script?: string }
export interface ServiceLink { id: string; revision: string; selected: boolean }
export interface PresetAction {
  systemdLaunch?: { unit: string; mode: "persistent" | "transient" };
  servicePortVariable?: boolean;
  invocation?: CommandInvocation | null;
  mode?: "command" | "terminal";
  id: string; kind: CommandKind; label: string; command: string;
  timeoutSecs: number; successCodes: number[]; confirm: boolean;
}
export interface RemoteService {
  loginByHost?: Record<string, string>;
  directProtocol?: DirectProtocol | null;
  hostIds?: string[];
  port?: number | null;
  category?: string | null;
  color?: string | null; icon?: RuleIcon | null;
  id: string; name: string; executionHostId?: string; ruleIds: string[];
  revision: string; noLocalEnvironment: boolean; actions: PresetAction[]; control?: ServiceControl; executionEnabled?: boolean;
}
export interface CommandRun {
  loginId?: string;

  id: string; requestId: string; serviceId: string; actionId: string; serviceRevision: string;
  hostId: string; hostName: string; endpoint: string; actionLabel: string;
  phase: string; submitted: boolean; exitCode: number | null; exitSignal: string | null;
  error: string | null; startedAt: number; finishedAt: number | null;
  fingerprint: string | null; verificationEndpoint: string | null; revision: number; truncated: boolean;
  outputBytes?:number; discardedBytes?:number;
  steps?: ServiceStep[]; workflowRuleId?: string | null; workflowForwardCreated?: boolean; workflowForwardRunId?: string | null;
}
export interface CommandOutput { sequence: number; stream: "stdout" | "stderr"; bytes: number[] }
export interface CommandEvent { run: CommandRun; output: CommandOutput[]; reset: boolean }

export interface TerminalSession {
  serviceRevision?: string;
  loginId?: string;

  local?: boolean;
  ruleId?:string|null;
  routeHostIds: string[];
  id: string; requestId: string; clientId: string; hostId: string; hostName: string; endpoint: string;
  serviceId: string | null; actionId: string | null; label: string; phase: string; revision: number;
  startedAt: number; finishedAt: number | null; submitted: boolean; exitCode: number | null; exitSignal: string | null; error: string | null;
  fingerprint: string | null; verificationEndpoint: string | null; cols: number; rows: number;
}
export interface TerminalFrame { powerShellEditor: boolean; id: string; sequence: number; bytes: number[] }
export interface OpenTerminalRequest {
  loginId?: string;

  hostId: string; requestId: string; clientId: string; cols: number; rows: number; noLocalEnvironment: boolean;
  serviceId?: string; actionId?: string; ruleId?:string; revision?: string; confirmed: boolean;
  secrets: Record<string, string>; rememberHostIds: string[];
}

export interface ServiceControl {
  statusProbe: {actionId:string;mode:"output"|"exitCode"|"json"|"vncSessions";runningCodes:number[];stoppedCodes:number[];failedCodes:number[]}|null;
  healthProbe: {command:string;readyCodes:number[];notReadyCodes:number[];repeatable:boolean;timeoutSecs:number;intervalSecs:number;budgetSecs:number}|null;
  startActionId:string|null;checkAfterActions:boolean;ttlSecs:number;
}
export interface ServiceFact {value:string;checkedAt:number|null;validUntil:number|null;sourceRunId:string|null;expired:boolean}
export interface ServiceObservation {loginId?:string;hostId?:string|null;ruleId?:string|null;serviceId:string;serviceRevision:string;hostIdentity:string;status:ServiceFact;health:ServiceFact;revision:number}
export interface ServiceStep {kind:string;phase:string;attempt:number;exitCode:number|null;error:string|null;startedAt:number;finishedAt:number|null}
export type ServiceOperation = "action"|"checkStatus"|"checkHealth"|"connect";
export interface StartServiceRequest {
  loginId?: string;
serviceId:string;revision:string;requestId:string;operation:ServiceOperation;actionId?:string;ruleId?:string;confirmed:boolean;secrets:Record<string,string>;rememberHostIds:string[]}

export interface ImportServicePreview {
  id:string;name:string;executionHostId:string;endpoint:string;ruleIds:string[];noLocalEnvironment:boolean;actions:PresetAction[];control:ServiceControl;conflict:boolean;
  hostIds?: string[];
  loginByHost?: Record<string, string>;
}
export interface ServiceTemplate {category?:string|null;name?:string;color?:string;icon?:RuleIcon;port?:number;actions:PresetAction[];control:ServiceControl;resource:string;shell:string}
