export const servicePortToken = "{{service.port}}";
const portAlias = "${PORT}";

export function hasServicePort(text?: string | null) {
  return text?.includes(servicePortToken) ?? false;
}

export function portText(raw: string, label?: string) {
  const tokens: { start: number; end: number; offset: number }[] = [];
  if (label === undefined) return { raw, text: raw, tokens };
  let text = "";
  let offset = 0;
  for (
    let match = raw.indexOf(servicePortToken);
    match >= 0;
    match = raw.indexOf(servicePortToken, offset)
  ) {
    text += raw.slice(offset, match);
    tokens.push({
      start: text.length,
      end: text.length + label.length,
      offset: match,
    });
    text += label;
    offset = match + servicePortToken.length;
  }
  return { raw, text: text + raw.slice(offset), tokens };
}

type Selection = { start: number; end: number };

export function editPortText(
  view: ReturnType<typeof portText>,
  { start, end }: Selection,
  inserted: string,
) {
  const rawOffset = (index: number, side: "start" | "end") => {
    let offset = index;
    for (const token of view.tokens) {
      if (index <= token.start) break;
      if (index < token.end)
        return token.offset + (side === "end" ? servicePortToken.length : 0);
      offset += servicePortToken.length - (token.end - token.start);
    }
    return offset;
  };
  return (
    view.raw.slice(0, rawOffset(start, "start")) +
    inserted +
    view.raw.slice(rawOffset(end, "end"))
  );
}

export function textEdit(
  before: string,
  after: string,
  cursor: number,
  selection?: Selection,
) {
  let start = selection?.start ?? 0;
  let end = selection?.end ?? start;
  if (
    start <= cursor &&
    before.slice(0, start) === after.slice(0, start) &&
    before.slice(end) === after.slice(cursor)
  ) {
    return { start, end, inserted: after.slice(start, cursor) };
  }
  // Anchor the edit at the new caret so adjacent equal digits cannot steal a token.
  const unchangedTail = after.slice(cursor);
  end = before.endsWith(unchangedTail)
    ? before.length - unchangedTail.length
    : before.length;
  const limit = Math.min(cursor, end);
  start = 0;
  while (start < limit && before[start] === after[start]) start++;
  if (!before.endsWith(unchangedTail)) {
    let right = after.length;
    while (
      end > start &&
      right > cursor &&
      before[end - 1] === after[right - 1]
    ) {
      end--;
      right--;
    }
    return { start, end, inserted: after.slice(start, right) };
  }
  return { start, end, inserted: after.slice(start, cursor) };
}

export function variableOffer(text: string, cursor: number) {
  const before = text.slice(0, cursor);
  const match = /\$([A-Za-z.]*)$/.exec(before);
  if (!match || !"service.port".startsWith(match[1].toLowerCase())) return null;
  const start = match.index;
  return before[start - 1] === "$" || isEscaped(before, start)
    ? null
    : { start, end: cursor };
}

export function completedPortAlias(text: string, cursor: number) {
  const start = cursor - portAlias.length;
  return start >= 0 &&
    text.slice(start, cursor) === portAlias &&
    text[start - 1] !== "$" &&
    !isEscaped(text, start)
    ? start
    : null;
}

function isEscaped(text: string, start: number) {
  let escapes = 0;
  for (let i = start - 1; text[i] === "\\"; i--) escapes++;
  return escapes % 2 !== 0;
}
