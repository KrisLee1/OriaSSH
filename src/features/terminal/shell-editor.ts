// The PTY carries both ordinary output and private OSC replies scoped to one session.
export function editorRequest(action: string, sequence: number, value = "") {
  let bytes = "";
  for (const byte of new TextEncoder().encode(value))
    bytes += String.fromCharCode(byte);
  return `#oria ${action} ${sequence} ${btoa(bytes)}\n`;
}

export function editorReply(data: string, sessionId: string) {
  const [id, kind, revision, payload] = data.split(";");
  if (
    id !== sessionId ||
    !kind ||
    !/^\d+$/.test(revision) ||
    payload === undefined ||
    payload.length > 1024 * 1024
  )
    return;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const fields = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .split("\0");
    fields.pop();
    return { kind, revision: Number(revision), fields };
  } catch {
    return;
  }
}

export function environmentNames(fields: string[]) {
  return [
    ...new Set(
      fields
        .map((field) =>
          field
            .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
            .replace(/[\x00-\x1f\x7f]/gu, "")
            .trim()
            .replace(/^\((.*)\)$/u, "$1")
            .trim(),
        )
        .filter((name) => name && name !== "base"),
    ),
  ];
}
export type ShellQuery = (
  operation: string,
  value: string,
) => Promise<string[]>;

export type Prompt = {
  cwd: string;
  home: string;
  environments?: string[];
  powershell?: boolean;
  completionProfile?: CompletionProfile;
};
export type CommandBlock = Prompt & {
  id: number;
  command: string;
  output: string;
  runs?: import("./terminal-output").OutputRun[];
};
export type ArchivedBlock = CommandBlock & { outputLines: number };
export type TerminalCopyText = { command: string; output: string };
export function promptSymbol(powershell = false) {
  return powershell ? ">" : "$";
}
export function commandTranscript(
  { command, output }: TerminalCopyText,
  powershell = false,
) {
  if (!command) return output;
  const heading = promptSymbol(powershell) + " " + command;
  return output ? heading + "\n" + output : heading;
}
// The PTY screen includes the native prompt and submitted command.
export function commandOutput(command: string, screen: string) {
  if (!command) return screen;
  const echo = "$ " + command;
  return screen === echo
    ? ""
    : screen.startsWith(echo + "\n")
      ? screen.slice(echo.length + 1)
      : screen;
}
// CSS applies min(18lh, 46cqh) to the preview's border box.
export function exceedsPreviewHeight(
  height: number,
  paneHeight: number,
  lineHeight: number,
) {
  return height > Math.round(Math.min(18 * lineHeight, paneHeight * 0.46));
}

// The PTY retains 5,000 physical rows per command. Budget the transcript
// separately so the next long command can coexist with earlier previews.
export function retainBlocks(blocks: ArchivedBlock[], block: CommandBlock) {
  let outputLines = 1;
  for (
    let at = block.output.indexOf("\n");
    at >= 0;
    at = block.output.indexOf("\n", at + 1)
  )
    outputLines++;
  const result: ArchivedBlock[] = [{ ...block, outputLines }];
  let characters = block.output.length + block.command.length;
  let lines = outputLines;
  let styles = block.runs?.length ?? 0;
  for (let i = blocks.length - 1; i >= 0 && result.length < 500; i--) {
    const previous = blocks[i];
    characters += previous.output.length + previous.command.length;
    lines += previous.outputLines;
    styles += previous.runs?.length ?? 0;
    if (characters > 2_000_000 || lines > 50_000 || styles > 65_536) break;
    result.push(previous);
  }
  return result.reverse();
}

export type CompletionProfile = {
  shell: "bash" | "zsh" | "powershell" | "posix";
  platform: "linux" | "macos" | "windows" | "bsd" | "unknown";
};

export function completionProfile(
  powershell = false,
  shell?: string,
  os = "",
): CompletionProfile {
  if (powershell) return { shell: "powershell", platform: "windows" };
  const platform = os.startsWith("linux")
    ? "linux"
    : os.startsWith("darwin")
      ? "macos"
      : /^(?:free|open|net|dragonfly)bsd/u.test(os)
        ? "bsd"
        : /^(?:msys|cygwin|mingw|win32)/u.test(os)
          ? "windows"
          : "unknown";
  return {
    shell: shell === "bash" || shell === "zsh" ? shell : "posix",
    platform,
  };
}

const boundary = /[\s|;&()<>]/u;

function readWord(
  line: string,
  start: number,
  powershell: boolean,
  stop = line.length,
) {
  const escape = powershell ? "`" : "\\";
  let value = "";
  let quote = "";
  let end = start;
  for (; end < stop; end++) {
    const char = line[end];
    const next = end + 1 < stop ? line[end + 1] : "";
    if (!quote && boundary.test(char)) break;
    if (!quote && (char === "'" || char === '"')) quote = char;
    else if (quote && char === quote) {
      if (powershell && next === quote) {
        value += char;
        end++;
      } else quote = "";
    } else if (
      char === escape &&
      next &&
      (!quote || (quote === '"' && (powershell || /["$`\\\n]/u.test(next))))
    ) {
      if (next !== "\n") value += next;
      end++;
    } else value += char;
  }
  return { value, end };
}

const wrappers = new Map<string, ReadonlySet<string>>([
  [
    "sudo",
    new Set([
      "-u",
      "--user",
      "-g",
      "--group",
      "-h",
      "--host",
      "-p",
      "--prompt",
      "-C",
      "--close-from",
      "-R",
      "--chroot",
      "-D",
      "--chdir",
      "-T",
      "--command-timeout",
    ]),
  ],
  ["doas", new Set(["-u", "-C"])],
  ["env", new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["stdbuf", new Set(["-i", "-o", "-e", "--input", "--output", "--error"])],
  ...["command", "builtin", "exec", "nohup", "time"].map(
    (name) => [name, new Set<string>()] as const,
  ),
]);

function commandWords(words: string[], prefix: string) {
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (/^[a-z_]\w*=/iu.test(word)) {
      i++;
      continue;
    }
    const options = wrappers.get(word);
    if (!options) break;
    const wrapperStart = i++;
    while (i < words.length && words[i].startsWith("-") && words[i] !== "-") {
      const option = words[i++];
      if (option === "--") break;
      if (options.has(option)) {
        if (i === words.length)
          return { words: words.slice(wrapperStart, i), wrapperValue: true };
        i++;
      }
    }
    if (i === words.length && prefix.startsWith("-"))
      return { words: words.slice(wrapperStart, i), wrapperValue: false };
  }
  return { words: words.slice(i), wrapperValue: false };
}

export function completionWord(
  line: string,
  cursor: number,
  powershell = false,
) {
  let from = cursor;
  let to = cursor;
  let prefix = "";
  let redirect = false;
  let comment = false;
  let words: string[] = [];
  for (let i = 0; i <= cursor && i < line.length; ) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "#") {
      const newline = line.indexOf("\n", i);
      if (newline < 0 || newline >= cursor) {
        comment = true;
        break;
      }
      i = newline;
      continue;
    }
    if (!boundary.test(char)) {
      const token = readWord(line, i, powershell);
      if (token.end >= cursor) {
        from = i;
        to = token.end;
        prefix = readWord(line, i, powershell, cursor).value;
        break;
      }
      if (redirect) redirect = false;
      else if (
        !(
          /[<>]/u.test(line[token.end] ?? "") &&
          /^(?:\d+|\*)$/u.test(token.value)
        )
      )
        words.push(token.value);
      i = token.end;
      continue;
    }
    if (i === cursor) break;
    if (char === ">" || char === "<" || (char === "&" && next === ">")) {
      redirect = true;
      i +=
        next === char || (char === "&" && next === ">") || next === "&" ? 2 : 1;
    } else {
      if (/[\n;|&()]/u.test(char)) {
        redirect = false;
        words = [];
        if (
          (char === "|" && /[|&]/u.test(next ?? "")) ||
          (char === "&" && next === "&")
        )
          i++;
      }
      i++;
    }
  }
  let wrapperValue = false;
  if (!powershell) ({ words, wrapperValue } = commandWords(words, prefix));
  const command = !words.length && !redirect && !wrapperValue;
  const head = powershell ? words[0]?.toLowerCase() : words[0];
  const directory =
    !redirect &&
    (powershell
      ? [
          "cd",
          "sl",
          "chdir",
          "set-location",
          "pushd",
          "push-location",
        ].includes(head ?? "")
      : head === "cd" || head === "pushd");
  const kind: "commands" | "dirs" | "files" =
    command && !pathPrefixLength(prefix, powershell)
      ? "commands"
      : directory
        ? "dirs"
        : "files";
  return {
    from,
    to,
    prefix,
    kind,
    powershell,
    command,
    words,
    redirect,
    comment,
    wrapperValue,
  };
}

export function pathPrefixLength(prefix: string, powershell = false) {
  return Math.max(
    prefix.lastIndexOf("/") + 1,
    powershell ? prefix.lastIndexOf("\\") + 1 : 0,
    powershell && /^[a-z]:/iu.test(prefix) ? 2 : 0,
  );
}

export function insertCandidate(
  line: string,
  word: ReturnType<typeof completionWord>,
  name: string,
  leader = "",
) {
  const parent =
    word.kind === "commands"
      ? 0
      : pathPrefixLength(word.prefix, word.powershell);
  const value = word.prefix.slice(0, parent) + name;
  let escaped: string;
  if (word.powershell) {
    escaped = value;
    if (!/^[\p{L}\p{N}_./~:\\-]+$/u.test(value)) {
      escaped = "'" + value.replace(/['\u2018-\u201b]/gu, "$&$&") + "'";
      if (word.command && !/&\s*$/u.test(line.slice(0, word.from)))
        escaped = "& " + escaped;
    }
  } else {
    escaped = /[\n\r]/u.test(value)
      ? "'" + value.replaceAll("'", "'\\''") + "'"
      : value
          .replace(/[^\p{L}\p{N}\-_.~/:]/gu, (c) => "\\" + c)
          .replace(/^~/u, parent && word.prefix.startsWith("~/") ? "~" : "\\~");
  }
  const insertion = leader + escaped;
  return {
    line: line.slice(0, word.from) + insertion + line.slice(word.to),
    cursor: word.from + insertion.length,
  };
}
