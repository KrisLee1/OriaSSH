import { useTranslation } from "react-i18next";
import { useId, type ReactNode } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { CommandVariableField } from "./command-variable-field";
import { portText, servicePortToken } from "./command-variable-model";
import type {
  CommandInvocation,
  CommandEnvironment,
  PresetAction,
} from "@/types";

// Empty editor values mean a flag; entirely blank draft rows are omitted on save.
// Keep renderInvocation literal so previously saved explicit empty words still read.
export function normalizeInvocation(
  value: CommandInvocation,
): CommandInvocation {
  return {
    ...value,
    arguments: value.arguments
      .map((arg) => ({ ...arg, value: arg.value === "" ? null : arg.value }))
      .filter((arg) => arg.name !== "" || arg.value !== null),
    environment: value.environment?.filter(
      (entry) => entry.name !== "" || entry.value !== "",
    ),
  };
}

const quoteShellWord = (word: string) => `'${word.replaceAll("'", `'"'"'`)}'`;

// Each execution word is literal POSIX-shell data, including empty values and embedded quotes.
export function renderInvocation(value: CommandInvocation) {
  const environment = value.environment || [];
  const assignments = environment
    .map(({ name, value }) => `${name}=${quoteShellWord(value)}`)
    .join(" ");
  if (value.script !== undefined) {
    return assignments
      ? `export ${assignments}\n${value.script}`
      : value.script;
  }
  const managed = value.executable.split("/").at(-1) === "systemd-run";
  const command = [
    value.executable,
    ...(managed
      ? environment.map(({ name, value }) => `--setenv=${name}=${value}`)
      : []),
    ...value.arguments.flatMap((arg) => [
      ...(arg.name ? [arg.name] : []),
      ...(arg.value !== null ? [arg.value] : []),
    ]),
  ]
    .map(quoteShellWord)
    .join(" ");
  return !managed && environment.length ? `${assignments} ${command}` : command;
}

const shellKeywords = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "case",
  "esac",
  "while",
  "until",
  "for",
  "in",
  "function",
  "select",
  "time",
  "coproc",
]);

function displayShellWord(word: string, index: number, variable: boolean) {
  const literal = variable ? word.replaceAll(servicePortToken, "0") : word;
  return /^[A-Za-z0-9_./:@%+,=-]+$/.test(literal) &&
    (index > 0 || (!literal.includes("=") && !shellKeywords.has(literal)))
    ? word
    : quoteShellWord(word);
}

// Decode only the exact single-line form emitted by the literal-word compiler.
// Shell syntax in hand-written scripts is displayed verbatim.
export function literalShellWords(source: string, variable = false) {
  const quotedWord = /'(?:[^']|'"'"')*'/y;
  const words: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    quotedWord.lastIndex = offset;
    const match = quotedWord.exec(source);
    if (!match) return undefined;
    let word = match[0].slice(1, -1).replaceAll(`'"'"'`, "'");
    offset = quotedWord.lastIndex;
    if (variable && source.startsWith(servicePortToken, offset)) {
      word += servicePortToken;
      offset += servicePortToken.length;
    }
    words.push(word);
    if (offset === source.length) break;
    if (source[offset] !== " " || offset + 1 === source.length) return undefined;
    offset++;
  }
  return words;
}

export function readableShellSource(source: string, variable: boolean) {
  if (source.includes("\n")) return source;
  const words = literalShellWords(source, variable);
  if (!words) return source;
  return words.map((word, index) => displayShellWord(word, index, variable)).join(" ");
}

export function readableActionPreview(action: PresetAction, resolved: string) {
  const invocation = action.invocation;
  if (invocation?.script !== undefined) return resolved;
  if (
    !invocation?.environment?.length ||
    invocation.executable.split("/").at(-1) === "systemd-run"
  )
    return readableShellSource(resolved, false);

  // Only remove quotes from the exact assignment prefix supplied by the compiler.
  const { environment } = invocation;
  const prefix =
    environment
      .map(({ name, value }) => `${name}=${quoteShellWord(value)}`)
      .join(" ") + " ";
  if (!resolved.startsWith(prefix)) return resolved;
  const assignments = environment
    .map(({ name, value }) => `${name}=${displayShellWord(value, 1, false)}`)
    .join(" ");
  return `${assignments} ${readableShellSource(resolved.slice(prefix.length), false)}`;
}

function shellBodyIndex(value: CommandInvocation) {
  if (!["sh", "/bin/sh"].includes(value.executable)) return -1;
  const [first, second] = value.arguments;
  if (value.arguments.length === 1 && first.name === "-c") return 0;
  return value.arguments.length === 2 &&
    first.name === "" &&
    first.value === "-c" &&
    second.name === ""
    ? 1
    : -1;
}

export function displayInvocation(
  value: CommandInvocation,
  variable: boolean,
  portLabel?: string,
) {
  const scriptIndex = shellBodyIndex(value);
  const words = value.arguments.flatMap(({ name, value }, index) => [
    ...(name ? [displayShellWord(name, 1, false)] : []),
    ...(value !== null
      ? [
          displayShellWord(
            index === scriptIndex
              ? readableShellSource(value, variable)
              : value,
            1,
            variable,
          ),
        ]
      : []),
  ]);
  const executable = displayShellWord(value.executable, 0, false);
  if (!words.length) return portText(executable);
  // Environment values and the executable are literal even when argument variables are enabled.
  const prefix = executable + " ";
  const args = portText(words.join(" "), variable ? portLabel : undefined);
  return {
    raw: prefix + args.raw,
    text: prefix + args.text,
    tokens: args.tokens.map(({ start, end, offset }) => ({
      start: start + prefix.length,
      end: end + prefix.length,
      offset: offset + prefix.length,
    })),
  };
}

function CommandEntryGroup({
  title,
  help,
  addLabel,
  addDisabled,
  onAdd,
  disabled,
  children,
}: {
  title: string;
  help?: string;
  addLabel: string;
  addDisabled: boolean;
  onAdd: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="command-entry-group" disabled={disabled}>
      <legend className="sr-only">{title}</legend>
      <div className="command-section-heading">
        <div className="parameter-title">
          <h4>{title}</h4>
          {help && <InfoTooltip label={title} description={help} />}
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={addDisabled}
          onClick={onAdd}
        >
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      {children}
    </fieldset>
  );
}

export function CommandInvocationEditor({
  value,
  onChange,
  disabled = false,
  maxArguments = 128,
  variables,
}: {
  value: CommandInvocation;
  onChange: (value: CommandInvocation, insertedVariable?: boolean) => void;
  disabled?: boolean;
  maxArguments?: number;
  variables?: { port: number | null | undefined; active: boolean };
}) {
  const { t } = useTranslation("commands");
  const scriptIndex = shellBodyIndex(value);
  const variableHelpId = useId();
  const variableHelp = variables ? t("commandVariableHint") : "";
  return (
    <fieldset className="command-invocation" disabled={disabled}>
      <legend className="sr-only">{t("builder.title")}</legend>
      <label className="field">
        <span>{t("builder.executable")}</span>
        <Input
          required
          maxLength={4096}
          value={value.executable}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => onChange({ ...value, executable: e.target.value })}
        />
      </label>
      <CommandEntryGroup
        title={t("builder.arguments")}
        help={[t("builder.hint"), variableHelp].filter(Boolean).join(" ")}
        addLabel={t("builder.add")}
        addDisabled={value.arguments.length >= maxArguments}
        onAdd={() =>
          onChange({
            ...value,
            arguments: [...value.arguments, { name: "", value: null }],
          })
        }
      >
        {variableHelp && (
          <span id={variableHelpId} className="sr-only">
            {variableHelp}
          </span>
        )}
        {value.arguments.map((arg, index) => (
          <div className="command-entry-row" key={index}>
            <label className="field">
              <span className={index ? "sr-only" : undefined}>
                {t("builder.parameter")}
              </span>
              <Input
                value={arg.name}
                maxLength={128}
                pattern="(-[A-Za-z0-9_.-]*)?"
                spellCheck={false}
                onChange={(e) =>
                  onChange({
                    ...value,
                    arguments: value.arguments.map((a, i) =>
                      i === index ? { ...a, name: e.target.value } : a,
                    ),
                  })
                }
              />
            </label>
            <div className="field">
              <span className={index ? "sr-only" : undefined}>
                {t("builder.value")}
              </span>
              {variables ? (
                <CommandVariableField
                  label={t("builder.value")}
                  description={variableHelpId}
                  port={variables.port}
                  active={variables.active}
                  disabled={disabled}
                  value={arg.value ?? ""}
                  format={
                    index === scriptIndex
                      ? (text) => readableShellSource(text, variables.active)
                      : undefined
                  }
                  onChange={(text, inserted) =>
                    onChange(
                      {
                        ...value,
                        arguments: value.arguments.map((a, i) =>
                          i === index ? { ...a, value: text || null } : a,
                        ),
                      },
                      inserted,
                    )
                  }
                />
              ) : (
                <Input
                  aria-label={t("builder.value")}
                  value={arg.value ?? ""}
                  maxLength={4096}
                  spellCheck={false}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      arguments: value.arguments.map((a, i) =>
                        i === index
                          ? { ...a, value: e.target.value || null }
                          : a,
                      ),
                    })
                  }
                />
              )}
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="destructive"
              aria-label={`${t("builder.remove")} ${index + 1}`}
              onClick={() =>
                onChange({
                  ...value,
                  arguments: value.arguments.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
        ))}
      </CommandEntryGroup>
    </fieldset>
  );
}

export function CommandEnvironmentEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: CommandEnvironment[];
  onChange: (value: CommandEnvironment[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("commands");
  return (
    <CommandEntryGroup
      title={t("builder.environment")}
      addLabel={t("builder.environmentAdd")}
      addDisabled={value.length >= 64}
      onAdd={() => onChange([...value, { name: "", value: "" }])}
      disabled={disabled}
    >
      {value.map((entry, index) => (
        <div className="command-entry-row" key={index}>
          <label className="field">
            <span className={index ? "sr-only" : undefined}>
              {t("builder.environmentName")}
            </span>
            <Input
              value={entry.name}
              required={entry.value !== ""}
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              maxLength={128}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <label className="field">
            <span className={index ? "sr-only" : undefined}>
              {t("builder.environmentValue")}
            </span>
            <Input
              value={entry.value}
              maxLength={4096}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <Button
            type="button"
            size="icon-xs"
            variant="destructive"
            aria-label={`${t("builder.environmentRemove")} ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      ))}
    </CommandEntryGroup>
  );
}

export function isStructuredCommand(action: PresetAction) {
  return !!action.invocation && action.invocation.script === undefined;
}
export function actionScript(action: PresetAction) {
  return action.invocation?.script ?? action.command;
}
export function editActionScript(
  action: PresetAction,
  script: string,
  environment = action.invocation?.environment || [],
): PresetAction {
  if (!environment.length)
    return { ...action, invocation: null, command: script };
  const invocation: CommandInvocation = {
    executable: "sh",
    arguments: [],
    script,
    environment,
  };
  return {
    ...action,
    invocation,
    command: renderInvocation(normalizeInvocation(invocation)),
  };
}
export function editActionEnvironment(
  action: PresetAction,
  environment: CommandEnvironment[],
): PresetAction {
  if (!isStructuredCommand(action))
    return editActionScript(action, actionScript(action), environment);
  const invocation = { ...action.invocation!, environment };
  return {
    ...action,
    invocation,
    command: renderInvocation(normalizeInvocation(invocation)),
  };
}
export function switchActionFormat(
  action: PresetAction,
  format: "script" | "command",
  previousInvocation?: CommandInvocation,
): PresetAction {
  const environment = action.invocation?.environment;
  if (format === "script") {
    if (!isStructuredCommand(action)) return action;
    return editActionScript(
      action,
      invocationScript(action.invocation!),
      environment,
    );
  }
  if (isStructuredCommand(action)) return action;
  const script = actionScript(action);
  const invocation: CommandInvocation =
    previousInvocation && script === invocationScript(previousInvocation)
      ? { ...previousInvocation, environment }
      : {
          executable: script ? "sh" : "",
          arguments: script
            ? [
                { name: "", value: "-c" },
                { name: "", value: script },
              ]
            : [],
          environment,
        };
  return {
    ...action,
    invocation,
    command: renderInvocation(normalizeInvocation(invocation)),
  };
}

function invocationScript(invocation: CommandInvocation) {
  const args = invocation.arguments;
  return ["sh", "/bin/sh"].includes(invocation.executable) &&
    args.length === 2 &&
    args[0].name === "" &&
    args[0].value === "-c" &&
    args[1].name === "" &&
    args[1].value !== null
    ? args[1].value
    : renderInvocation({ ...invocation, environment: [] });
}
