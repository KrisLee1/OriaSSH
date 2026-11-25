import { useEffect, useMemo, useState } from "react";
import { pathPrefixLength, type ShellQuery } from "./shell-editor";

type Kind = "commands" | "files" | "dirs";
type MatchSet = {
  kind: Kind;
  prefix: string;
  names: string[];
  complete: boolean;
  expires: number;
};
const empty: string[] = [];

function split(prefix: string, powershell: boolean) {
  const index = pathPrefixLength(prefix, powershell);
  return [prefix.slice(0, index), prefix.slice(index)] as const;
}

function cachedMatches(
  cache: MatchSet[],
  kind: Kind,
  prefix: string,
  powershell: boolean,
) {
  const now = Date.now();
  const fold = (value: string) => (powershell ? value.toLowerCase() : value);
  const [dir, leaf] = split(fold(prefix), powershell);
  for (const entry of cache) {
    if (entry.kind !== kind || entry.expires <= now) continue;
    if (entry.prefix === prefix) return entry.names;
    if (!entry.complete) continue;
    const [base, prior] = split(fold(entry.prefix), powershell);
    if (base === dir && leaf.startsWith(prior)) {
      return entry.names.filter((name) => fold(name).startsWith(leaf));
    }
  }
}

export function useShellMatches(
  query: ShellQuery,
  cwd: string,
  kind: Kind | undefined,
  prefix: string,
  explicit: boolean,
  powershell: boolean,
) {
  const scope = useMemo<{ cache: MatchSet[]; pending?: Promise<void> }>(
    () => ({ cache: [] }),
    [query, cwd, powershell],
  );
  const [result, setResult] = useState<{
    scope: typeof scope;
    kind: Kind;
    prefix: string;
    names: string[];
  }>();
  useEffect(() => {
    if (!kind) return;
    let live = true;
    const timer = setTimeout(
      async () => {
        const cache = () =>
          cachedMatches(scope.cache, kind, prefix, powershell);
        if (!cache() && scope.pending) await scope.pending;
        if (!live) return;
        const cached = cache();
        if (cached) {
          setResult({ scope, kind, prefix, names: cached });
          return;
        }
        scope.pending = query(kind, prefix)
          .then(
            (raw) => {
              const names = [...new Set(raw.filter(Boolean))];
              if (powershell && kind === "commands")
                names.sort((a, b) => a.length - b.length || a.localeCompare(b));
              else names.sort();
              scope.cache.unshift({
                kind,
                prefix,
                names,
                complete: raw.length < (kind === "commands" ? 256 : 512),
                expires: Date.now() + 2500,
              });
              if (scope.cache.length > 16) scope.cache.pop();
              if (live) setResult({ scope, kind, prefix, names });
            },
            () => {},
          )
          .finally(() => {
            scope.pending = undefined;
          });
      },
      explicit ? 0 : 85,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [scope, query, kind, prefix, powershell, explicit]);

  return result &&
    result.scope === scope &&
    result.kind === kind &&
    result.prefix === prefix
    ? result.names
    : empty;
}
