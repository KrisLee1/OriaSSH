import {
  catalogs,
  commandNames,
  commonPowerShellOptions,
  tools,
  type CommandSpec,
} from "./completion-catalog";
import type { completionWord, CompletionProfile } from "./shell-editor";

type Word = ReturnType<typeof completionWord>;
type Option = CommandSpec["options"][number];
type OptionValue = NonNullable<Option["value"]>;
type Kind = Word["kind"];

export const completionListLimit = 100;
export const completionInputLimit = 8192;

const commandPrefixes = new Map<string, Map<string, string[]>>();

function matchingCommandNames(profile: CompletionProfile, prefix: string) {
  const key = profile.shell + ":" + profile.platform;
  const powershell = profile.shell === "powershell";
  let index = commandPrefixes.get(key);
  if (!index) {
    const names = powershell
      ? commandNames.powershell
      : [
          ...(profile.shell === "posix" ? [] : catalogs[profile.shell].keys()),
          ...(profile.platform === "unknown"
            ? []
            : catalogs[profile.platform].keys()),
          ...commandNames.posix,
        ];
    index = new Map([["", names]]);
    for (const name of names) {
      const initial = powershell ? name[0].toLowerCase() : name[0];
      const bucket = index.get(initial);
      if (bucket) bucket.push(name);
      else index.set(initial, [name]);
    }
    commandPrefixes.set(key, index);
  }
  const initial = powershell
    ? prefix.charAt(0).toLowerCase()
    : prefix.charAt(0);
  return (index.get(initial) ?? []).filter((name) =>
    startsWith(name, prefix, powershell),
  );
}

function startsWith(value: string, prefix: string, ignoreCase: boolean) {
  return ignoreCase
    ? value.toLowerCase().startsWith(prefix.toLowerCase())
    : value.startsWith(prefix);
}

export function completionPlan(
  word: Word,
  profile: CompletionProfile,
  explicit: boolean,
) {
  const { prefix, powershell } = word;
  const result: { word: Word; leader: string; names: string[]; query?: Kind } =
    {
      word,
      leader: "",
      names: [],
    };
  if (word.comment) return result;
  if (word.command) {
    if (word.kind === "commands" && (prefix || explicit))
      result.names = matchingCommandNames(profile, prefix);
    if (prefix || explicit) result.query = word.kind;
    return result;
  }
  if (word.redirect) {
    if (prefix || explicit) result.query = "files";
    return result;
  }

  const [invocation, ...args] = word.words;
  const basename = invocation.split(powershell ? /[\\/]/u : "/").at(-1) ?? "";
  const nativeName = powershell ? basename.toLowerCase() : basename;
  const toolName = powershell
    ? nativeName.replace(/\.(?:exe|cmd|bat|ps1)$/u, "")
    : nativeName;
  const cmdlet = powershell ? catalogs.powershell.get(nativeName) : undefined;
  const windows = powershell
    ? (catalogs.windows.get(nativeName) ?? catalogs.windows.get(toolName))
    : undefined;
  const platform =
    !powershell && profile.platform !== "unknown"
      ? catalogs[profile.platform].get(nativeName)
      : undefined;
  const root = powershell
    ? (cmdlet ??
      windows ??
      (["curl", "wget"].includes(toolName) ? undefined : tools.get(toolName)))
    : (platform ??
      catalogs[profile.shell].get(toolName) ??
      catalogs.posix.get(toolName) ??
      tools.get(toolName));

  const ignoreCase = !!(cmdlet || windows);
  const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
  const globals = cmdlet
    ? commonPowerShellOptions
    : ["kubectl", "helm", "oc", "aws", "az", "gcloud", "gh", "winget"].includes(
          toolName,
        )
      ? (root?.options ?? [])
      : [];
  let current = root;
  let positionals = 0;
  let optionsEnded = false;
  let waiting: { name: string; value: OptionValue } | undefined;
  let used = new Set<string>();
  const options = () =>
    current === root && !cmdlet
      ? (current?.options ?? [])
      : [...(current?.options ?? []), ...globals];
  const option = (name: string) =>
    options().find((entry) => normalize(entry.name) === normalize(name));
  const splitOption = (name: string) => {
    const separator = name.search(
      cmdlet || (windows && name.startsWith("/")) ? /[:=]/u : /=/u,
    );
    return separator > 0
      ? ([name.slice(0, separator), name.slice(separator + 1)] as const)
      : ([name, undefined] as const);
  };
  const flags = (value: string) =>
    value.startsWith("-") ||
    (windows &&
      value.startsWith("/") &&
      options().some(({ name }) => name.startsWith("/"))) ||
    (options().some(({ name }) => name.startsWith("+")) &&
      value.startsWith("+"));
  const enter = (child: string) => {
    current = current?.children.get(child);
    positionals = 0;
    used = new Set();
  };
  const optionValue = (name: string, value: string) => {
    const child = name + " " + value;
    if (current?.children.has(child)) enter(child);
  };
  for (const arg of args) {
    if (waiting) {
      optionValue(waiting.name, arg);
      waiting = undefined;
    } else if (!optionsEnded && arg === "--") optionsEnded = true;
    else if (!optionsEnded && flags(arg)) {
      const [name, value] = splitOption(arg);
      const found = option(name);
      used.add(normalize(name));
      if (found?.value) {
        if (value === undefined)
          waiting = { name: found.name, value: found.value };
        else optionValue(found.name, value);
      }
    } else if (positionals === 0 && current?.children.has(arg)) enter(arg);
    else positionals++;
  }

  const values = (prefix: string, value: OptionValue) => {
    if (value === "value" || (!prefix && !explicit)) return;
    if (value === "dir" || value === "path") {
      result.query = value === "dir" ? "dirs" : "files";
    } else {
      result.names = value.filter((name) =>
        startsWith(name, prefix, ignoreCase),
      );
    }
  };
  if (waiting) {
    values(prefix, waiting.value);
    return result;
  }
  if (word.wrapperValue) return result;
  if (!optionsEnded && flags(prefix)) {
    const [name, value] = splitOption(prefix);
    const found = option(name);
    if (value !== undefined) {
      if (found?.value) {
        result.leader = prefix.slice(0, name.length + 1);
        result.word = { ...word, prefix: value };
        values(value, found.value);
      }
    } else {
      result.names = options()
        .filter(
          (entry) =>
            !used.has(normalize(entry.name)) &&
            startsWith(entry.name, prefix, ignoreCase),
        )
        .map((entry) => entry.name);
    }
    return result;
  }
  if (!prefix && !explicit) return result;

  const children =
    optionsEnded || positionals
      ? []
      : [...(current?.children.keys() ?? [])].filter(
          (name) => !name.includes(" ") && startsWith(name, prefix, ignoreCase),
        );
  result.names = children;
  const positional = current?.positional;
  if (positional && Array.isArray(positional)) {
    if (!positionals) values(prefix, positional);
  } else if (!children.length) {
    result.query = positional === "dir" ? "dirs" : word.kind;
  }
  if (!prefix && explicit && !optionsEnded) {
    result.names.push(
      ...options()
        .filter((entry) => !used.has(normalize(entry.name)))
        .map((entry) => entry.name),
    );
  }
  return result;
}
