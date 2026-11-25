import { memo } from "react";
import { ChevronDownIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commandKinds } from "./command-model";

const formattedTailSize = 24 * 1024;
const stepKinds = new Set<string>([...commandKinds, "health", "forward"]);
const stepMarker = /^\[([a-z]+)\][ \t]*$/;
const sourceLocation = /^(?:file:\/\/\/|\/|[A-Z]:\\).+:\d+(?::\d+)?[ \t]*$/;
const sourcePointer = /^[ \t]*~*\^[~^]*[ \t]*$/;
const stackFrame =
  /^[ \t]+at\s+.+(?:\([^)]*\)|:\d+|<anonymous>)(?: \{)?[ \t]*$/;
const omittedFrames =
  /^[ \t]*\.\.\. \d+ (?:more|lines? matching cause stack trace \.\.\.)[ \t]*$/;
const nodeVersion = /^Node\.js v\d[\w.+-]*[ \t]*$/;
const errorProperty = /^[ \t]+(?:\[cause\]|[\w$]+):[ \t]/;
const objectOpen = / \{[ \t]*$/;
const objectClose = /^[ \t]*\},?[ \t]*$/;
const diagnosticLine =
  /^[ \t]*([\w.$]*(?:Error|Exception)|Warning|Caused by)(?: \[([\w-]+)\])?:[ \t]*(\S.*)$/;
const codedMessage = /^(?:(\S+) )?(E[A-Z][A-Z0-9_]{2,}):[ \t]+(.+)$/s;
const severityLine =
  /^[ \t]*(WARN(?:ING)?|ERROR|FATAL|CRITICAL):[ \t]*(\S.*)$/i;
const bracketedSeverity =
  /^[ \t]*\[(WARN(?:ING)?|ERROR|FATAL|CRITICAL)\][ \t]+(\S.*)$/i;
const sectionHeading = /^[\p{L}][^:\r\n]{0,79}[:：]$/u;
const columnSeparator = /[ \t]*\t[ \t]*| {2,}/;
const columnLabel = /^(?:\p{L}[\p{L}\p{N} _/#%().-]{0,47}|#)$/u;
const columnRule = /^[-=]+(?:[ \t]+[-=]+)*$/;
const numericCell = /^[+-]?\d+(?:[.,]\d+)?%?$/;
// Older TigerVNC uses a single gap even though these headers contain spaces.
const vncColumns = /^(X DISPLAY #)[ \t]+(PROCESS ID(?: #)?)$/i;
const vncRow = /^(:\d+(?:\.\d+)?)[ \t]+(\d+)$/;

interface Diagnostic {
  name: string;
  code?: string;
  message: string;
  tone: "warning" | "error";
}

type OutputTable = {
  kind: "table";
  caption?: string;
  headers: string[];
  rows: string[][];
};
type OutputBlock =
  | { kind: "text"; text: string }
  | { kind: "step"; text: string }
  | { kind: "heading"; text: string }
  | OutputTable
  | { kind: "diagnostic"; diagnostic: Diagnostic; details: string };

function readDiagnostic(line?: string): Diagnostic | undefined {
  const match = line?.match(diagnosticLine);
  if (match) {
    return {
      name: match[1],
      code: match[2],
      message: match[3],
      tone: match[1] === "Warning" ? "warning" : "error",
    };
  }
  const severity = line?.match(severityLine) ?? line?.match(bracketedSeverity);
  if (severity) {
    return {
      name: severity[1],
      message: severity[2],
      tone: /^warn/i.test(severity[1]) ? "warning" : "error",
    };
  }
}

function readTable(lines: string[], start: number, caption?: string) {
  const line = lines[start]?.trim();
  if (!line) return;
  const vnc = line.match(vncColumns);
  const headers = vnc ? vnc.slice(1) : line.split(columnSeparator);
  if (
    headers.length < 2 ||
    headers.length > 12 ||
    !headers.every((cell) => columnLabel.test(cell))
  )
    return;

  const rule = columnRule.test(lines[start + 1]?.trim() ?? "");
  const explicit =
    vnc ||
    rule ||
    line.includes("\t") ||
    headers.length > 2 ||
    line === line.toUpperCase();
  if (!explicit && !caption) return;

  const rows: string[][] = [];
  let end = start + (rule ? 2 : 1);
  while (end < lines.length) {
    const body = lines[end].trim();
    if (
      !body ||
      readDiagnostic(body) ||
      stepMarker.test(body) ||
      sectionHeading.test(body)
    )
      break;
    const cells =
      (vnc ? body.match(vncRow)?.slice(1) : undefined) ??
      body.split(columnSeparator);
    if (cells.length !== headers.length || cells.some((cell) => !cell)) break;
    rows.push(cells);
    end++;
  }
  if (!rows.length || (!explicit && rows.length < 2)) return;
  const block: OutputTable = { kind: "table", caption, headers, rows };
  return { block, end };
}

function diagnosticAfterSource(lines: string[], start: number) {
  if (!sourceLocation.test(lines[start])) return start;
  let pointer = false;
  for (let next = start + 1; next < Math.min(start + 8, lines.length); next++) {
    if (readDiagnostic(lines[next])) return pointer ? next : start;
    if (stepMarker.test(lines[next]) || (pointer && lines[next].trim())) break;
    pointer ||= sourcePointer.test(lines[next]);
  }
  return start;
}

function formatOutput(text: string): OutputBlock[] {
  const cut =
    text.length > formattedTailSize
      ? text.indexOf("\n", text.length - formattedTailSize) + 1
      : 0;
  if (text.length > formattedTailSize && !cut) return [{ kind: "text", text }];

  const blocks: OutputBlock[] = cut
    ? [{ kind: "text", text: text.slice(0, cut) }]
    : [];
  const lines = text.slice(cut).split(/\r?\n/);
  function addText(start: number, end: number) {
    const text = lines
      .slice(start, end)
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
    if (text) blocks.push({ kind: "text", text });
  }

  let textStart = 0;
  for (let index = 0; index < lines.length; index++) {
    const step = lines[index].match(stepMarker)?.[1];
    if (step && stepKinds.has(step)) {
      addText(textStart, index);
      blocks.push({ kind: "step", text: step });
      textStart = index + 1;
      continue;
    }

    const heading = diagnosticAfterSource(lines, index);
    let diagnostic = readDiagnostic(lines[heading]);
    if (!diagnostic) {
      if (index !== textStart && lines[index - 1]?.trim()) continue;
      const line = lines[index].trimEnd();
      const caption = sectionHeading.test(line) ? line.slice(0, -1) : undefined;
      let dataStart = index;
      if (caption) {
        do {
          dataStart++;
        } while (dataStart < lines.length && !lines[dataStart].trim());
      }
      const table = readTable(lines, dataStart, caption);
      if (table) {
        addText(textStart, index);
        blocks.push(table.block);
        textStart = table.end;
        index = table.end - 1;
      } else if (caption && dataStart < lines.length) {
        addText(textStart, index);
        blocks.push({ kind: "heading", text: caption });
        textStart = index + 1;
      }
      continue;
    }

    addText(textStart, index);
    let end = heading + 1;
    let messageEnd = end;
    let errorObjects = 0;
    while (end < lines.length) {
      const line = lines[end];
      const inner = readDiagnostic(line);
      if (
        inner &&
        inner.name === diagnostic.name &&
        inner.code === diagnostic.code &&
        (diagnostic.message === inner.message ||
          diagnostic.message.endsWith(`: ${inner.message}`))
      ) {
        diagnostic = inner;
      } else if (
        stackFrame.test(line) ||
        (errorObjects && errorProperty.test(line))
      ) {
        // Node appends inspected properties and nested causes to the final stack frame.
        if (objectOpen.test(line)) errorObjects++;
      } else if (errorObjects && objectClose.test(line)) {
        errorObjects--;
      } else if (!omittedFrames.test(line) && !nodeVersion.test(line)) {
        const continuation = line.trim();
        if (
          diagnostic.tone === "warning" &&
          end === messageEnd &&
          continuation &&
          !inner &&
          !stepMarker.test(continuation) &&
          !sectionHeading.test(continuation) &&
          !columnSeparator.test(continuation) &&
          !sourceLocation.test(continuation)
        ) {
          diagnostic.message += `\n${continuation}`;
          messageEnd++;
        } else if (continuation || !nodeVersion.test(lines[end + 1] ?? "")) {
          break;
        }
      }
      end++;
    }

    const code = diagnostic.message.match(codedMessage);
    if (!diagnostic.code && code) {
      const [, operation, value, message] = code;
      diagnostic = {
        ...diagnostic,
        code: value,
        message: operation ? `${operation}: ${message}` : message,
      };
    }
    blocks.push({
      kind: "diagnostic",
      diagnostic,
      details:
        heading > index || end > messageEnd
          ? lines.slice(index, end).join("\n")
          : "",
    });
    textStart = end;
    index = end - 1;
  }
  addText(textStart, lines.length);
  return blocks.length ? blocks : [{ kind: "text", text }];
}

function CommandOutputTable({
  block,
  label,
}: {
  block: OutputTable;
  label: string;
}) {
  const numbers = block.headers.map((_, index) =>
    block.rows.every((row) => numericCell.test(row[index])),
  );
  return (
    <div
      className="command-log-table"
      role="region"
      aria-label={block.caption || label}
      tabIndex={0}
    >
      <table>
        {block.caption && (
          <caption className="command-log-section">{block.caption}</caption>
        )}
        <thead>
          <tr>
            {block.headers.map((header, index) => (
              <th
                key={index}
                scope="col"
                data-numeric={numbers[index] || undefined}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} data-numeric={numbers[column] || undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CommandOutputText = memo(function CommandOutputText({
  text,
}: {
  text: string;
}) {
  const { t } = useTranslation("commands");
  return (
    <div className="command-log">
      {formatOutput(text).map((block, index) => {
        if (block.kind === "text") {
          return (
            <pre className="command-log-text" key={index}>
              {block.text}
            </pre>
          );
        }
        if (block.kind === "heading") {
          return (
            <h4 className="command-log-section" key={index}>
              {block.text}
            </h4>
          );
        }
        if (block.kind === "table") {
          return (
            <CommandOutputTable key={index} block={block} label={t("output")} />
          );
        }
        if (block.kind === "step") {
          return (
            <h3 className="command-log-stage" key={index}>
              {t(`service.step.${block.text}`, {
                defaultValue: t(`kind.${block.text}`),
              })}
            </h3>
          );
        }
        const { diagnostic, details } = block;
        const Icon =
          diagnostic.tone === "warning" ? TriangleAlertIcon : CircleXIcon;
        return (
          <div
            className="command-log-diagnostic"
            data-tone={diagnostic.tone}
            key={index}
          >
            <div className="command-log-diagnostic-heading">
              <Icon size={14} aria-hidden="true" />
              <strong>{diagnostic.name}</strong>
              {diagnostic.code && <code>{diagnostic.code}</code>}
            </div>
            <p>{diagnostic.message}</p>
            {details && (
              <details className="editor-disclosure command-log-details">
                <summary>
                  {t("outputContentDetails")}
                  <ChevronDownIcon size={14} aria-hidden="true" />
                </summary>
                <pre className="command-log-text">{details}</pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
});
