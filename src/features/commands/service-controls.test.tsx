import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { CommandResult } from "./preset-commands";
import { CommandOutputText } from "./command-output";
import {
  ControlEditor,
  ServiceState,
  CredentialRetry,
  ServiceOperations,
  defaultControl,
  parseCodes,
} from "./service-controls";
import type {
  CommandRun,
  RemoteService,
  Snapshot,
  ServiceObservation,
} from "@/types";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
const host = {
  ...emptyHost(),
  id: "host",
  name: "isolated",
  address: "127.0.0.1",
  user: "tester",
};
const control = {
  ...defaultControl(),
  startActionId: "start",
  statusProbe: {
    actionId: "status",
    mode: "exitCode" as const,
    runningCodes: [0],
    stoppedCodes: [3],
    failedCodes: [],
  },
  healthProbe: {
    command: "<script>HEALTH_CANARY</script>",
    readyCodes: [0],
    notReadyCodes: [1],
    repeatable: false,
    timeoutSecs: 5,
    intervalSecs: 2,
    budgetSecs: 60,
  },
};
const service: RemoteService = {
  id: "service",
  name: "Model",
  executionHostId: "host",
  revision: "v1",
  noLocalEnvironment: true,
  ruleIds: ["linked"],
  control,
  actions: [
    {
      id: "status",
      kind: "status",
      label: "Status",
      command: "check",
      timeoutSecs: 5,
      successCodes: [0],
      confirm: false,
    },
    {
      id: "start",
      kind: "start",
      label: "Start",
      command: "start",
      timeoutSecs: 60,
      successCodes: [0],
      confirm: true,
    },
  ],
};
const data = {
  hosts: [host],
  services: [service],
  rules: [
    { ...emptyRule("host"), id: "linked", name: "Linked forward" },
    { ...emptyRule("host"), id: "unrelated", name: "Unrelated forward" },
  ],
} as Snapshot;
describe("service control UI", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  it("renders explicit probe settings and bounded wait fields with escaped scripts in all languages", async () => {
    const flatten = (value: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(value).flatMap(([key, v]) =>
        v && typeof v === "object"
          ? flatten(v as Record<string, unknown>, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    const baseKeys = (keys: string[]) =>
      [
        ...new Set(
          keys.map((key) => key.replace(/_(zero|one|two|few|many|other)$/, "")),
        ),
      ].sort();
    const expected = baseKeys(
      flatten(i18n.getResourceBundle("en", "commands")),
    );
    for (const lang of ["zh-CN", "zh-TW", "en", "ja", "ko", "de", "fr", "ru"]) {
      await i18n.changeLanguage(lang);
      const html = renderToStaticMarkup(
        <ControlEditor service={service} onChange={() => {}} />,
      );
      expect(html).toContain("&lt;script&gt;HEALTH_CANARY&lt;/script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).toContain('max="600"');
      expect(html).toContain('role="switch"');
      expect(html).not.toMatch(/>service\.[a-zA-Z]/);
      expect(
        baseKeys(flatten(i18n.getResourceBundle(lang, "commands"))),
      ).toEqual(expected);
    }
    await i18n.changeLanguage("zh-CN");
  });
  it("shows backend expiry and observation time without inferring readiness from process state", () => {
    const obs = {
      status: {
        value: "running",
        checkedAt: 1,
        validUntil: 2,
        sourceRunId: "run",
        expired: true,
      },
      health: { value: "unverified", checkedAt: null, expired: false },
    } as ServiceObservation;
    const html = renderToStaticMarkup(<ServiceState observation={obs} />);
    expect(html).toContain("运行中");
    expect(html).toContain("已过期");
    expect(html).not.toContain("未验证");
    expect(renderToStaticMarkup(<ServiceState />)).toBe("");
    expect(html).not.toContain("aria-live");
  });
  it("only offers linked forwards and never offers a whole-operation retry after any exec submission", () => {
    const html = renderToStaticMarkup(
      <ServiceOperations
        service={service}
        data={data}
        disabled={false}
        onOperation={() => {}}
      />,
    );
    expect(html).toContain("Linked forward");
    expect(html).not.toContain("Unrelated forward");
    const run = {
      id: "run",
      hostId: "host",
      workflowRuleId: "linked",
      finishedAt: 1,
      serviceId: "service",
      serviceRevision: "v1",
      error: "authentication",
      submitted: true,
      actionId: "$connect:linked",
    } as CommandRun;
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={data}
          run={run}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={data}
          run={{ ...run, submitted: false, error: "remoteUnknown" }}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={data}
          run={{ ...run, submitted: false }}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toContain("补充凭据后重试");
    for (const blocked of [
      { ...run, submitted: false, finishedAt: null },
      { ...run, submitted: false, workflowRuleId: "unrelated" },
      { ...run, submitted: false, serviceRevision: "stale" },
    ]) {
      expect(
        renderToStaticMarkup(
          <CredentialRetry
            data={data}
            run={blocked}
            autoPrompt
            onRun={() => {}}
            onError={() => {}}
          />,
        ),
      ).toBe("");
    }
    expect(
      renderToStaticMarkup(
        <CredentialRetry
          data={{
            ...data,
            services: [{ ...service, executionEnabled: false }],
          }}
          run={{ ...run, submitted: false }}
          onRun={() => {}}
          onError={() => {}}
        />,
      ),
    ).toBe("");
  });
  it("shows a timeout explanation once and leaves output space free of duplicate steps", () => {
    const run: CommandRun = {
      id: "run", requestId: "request", serviceId: "service", actionId: "start",
      serviceRevision: "v1", hostId: "host", hostName: "isolated", endpoint: "tester@127.0.0.1:22",
      actionLabel: "Start", phase: "timedOut", submitted: true, exitCode: 0,
      exitSignal: null, error: "remoteUnknown", startedAt: 1_000, finishedAt: 61_000,
      fingerprint: null, verificationEndpoint: null, revision: 1, truncated: false,
      outputBytes: 0, discardedBytes: 0,
      steps: [{ kind: "start", phase: "timedOut", attempt: 1, exitCode: 0,
        error: "remoteUnknown", startedAt: 1_000, finishedAt: 61_000 }],
    };
    const renderResult = (run: CommandRun) => renderToStaticMarkup(
      <CommandResult
        data={data}
        run={run}
        accept={() => {}}
        onCancel={() => {}}
        onError={() => {}}
        onRetry={() => {}}
      />,
    );
    const html = renderResult(run);
    expect(html.match(/本地已停止等待/g)).toHaveLength(1);
    expect(html).toContain("已超时");
    expect(html).toContain("60 秒");
    expect(html).not.toContain("退出码");
    expect(html).toContain('data-variant="soft"');
    expect(html).not.toContain("执行详情");
    expect(html).not.toContain("0 MiB");
    expect(html).not.toContain("重新执行");
    const terminated = renderResult({ ...run, phase: "cancelled", steps: [] });
    expect(terminated).toContain("已终止");
    expect(terminated).toContain("远端命令是否退出尚未确认。");
    expect(terminated).not.toContain('role="alert"');
    expect(renderResult({ ...run, phase: "cancelled", error: null, steps: [] }))
      .not.toContain("远端命令是否退出尚未确认。");

    const failed: CommandRun = {
      ...run,
      phase: "failed",
      error: "exitCode",
      exitCode: 1,
      workflowRuleId: "linked",
      steps: [{ ...run.steps![0], phase: "failed", error: "exitCode", exitCode: 1 }],
    };
    const failure = renderResult(failed);
    expect(failure.match(/退出码/g)).toHaveLength(1);
    expect(failure).toContain("退出码 1");
    expect(failure).toContain("重新执行");
    expect(renderResult({ ...failed, workflowRuleId: "unrelated" })).not.toContain("重新执行");
    expect(renderResult({ ...failed, serviceRevision: "stale" })).not.toContain("重新执行");
    expect(renderResult({ ...failed, exitCode: null })).not.toContain("重新执行");
    expect(renderResult({ ...failed, actionId: "$connect:linked" })).not.toContain("重新执行");
  });
  it("shows foreground execution and observed TCP reachability as distinct facts", () => {
    const run: CommandRun = {
      id: "run", requestId: "request", serviceId: "service", actionId: "start",
      serviceRevision: "v1", hostId: "host", hostName: "isolated", endpoint: "tester@127.0.0.1:22",
      actionLabel: "Start", phase: "foreground-running", submitted: true,
      exitCode: null, exitSignal: null, error: null, startedAt: 1000, finishedAt: null,
      fingerprint: null, verificationEndpoint: null, revision: 1, truncated: false,
      workflowRuleId: "linked",
    };
    const runtime = {
      ruleId: "linked", runId: "forward-run", status: "listening", message: "",
      sent: 0, received: 0, connections: 1, configurationChanged: false,
      desiredRunning: true, retryCount: 0, uptimeSecs: 1, history: [],
      targetHealth: { state: "reachable", method: "tcp-connect", checkedAt: 1200 },
    };
    const render = (checkedAt: number) => renderToStaticMarkup(
      <CommandResult
        data={{ ...data, runtimes: [{ ...runtime, targetHealth: { ...runtime.targetHealth, checkedAt } }] }}
        run={run} accept={() => {}} onCancel={() => {}} onError={() => {}}
      />,
    );
    expect(render(1200)).toContain("前台运行中");
    expect(render(1200)).toContain('class="terminal-tab-indicator" data-tone="success"');
    expect(render(1200)).toContain("目标 TCP 可达");
    expect(render(900)).not.toContain("目标 TCP 可达");
  });
  it("shows an actionable error and folds its original context and stack together", () => {
    const cause = "listen EADDRINUSE: address already in use 127.0.0.1:13081";
    const text = [
      "[start]",
      "Listening for work",
      "file:///isolated/boot.js:1187",
      "  throw new Error(message);",
      "        ^",
      "",
      `Error: plugin failed to load: ${cause}`,
      `Error: ${cause}`,
      "  at listen (node:net:1)",
      "  ... 3 lines matching cause stack trace ...",
      "  at async file:///isolated/bin.js:133:3 {",
      `  [cause]: Error: failed to apply loader: ${cause}`,
      "    at updateError (file:///isolated/loader.js:309:9) {",
      `    [cause]: Error: ${cause}`,
      "      at handleListen (node:net:20:8) {",
      "      code: 'EADDRINUSE',",
      "      port: 13081",
      "    }",
      "  }",
      "}",
      "",
      "Node.js v22.23.0",
      "  status: starting fallback listener",
      "Error: another failure",
      "  at noon",
      "<script>",
    ].join("\n");
    const html = renderToStaticMarkup(
      <CommandOutputText text={text} />,
    );
    expect(html).toContain('class="command-log-stage">启动</h3>');
    expect(html).toContain('class="command-log-text">Listening for work</pre>');
    expect(html).toContain("<code>EADDRINUSE</code>");
    expect(html).toContain("<p>listen: address already in use 127.0.0.1:13081</p>");
    expect(html).toContain("<p>another failure</p>");
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    const details = html.match(/<details[\s\S]*?<\/details>/)?.[0];
    expect(details).toContain("内容详情");
    expect(details).toContain("file:///isolated/boot.js:1187");
    expect(details).toContain("Error: plugin failed to load");
    expect(details).toContain("at listen (node:net:1)");
    expect(details).toContain("... 3 lines matching cause stack trace ...");
    expect(details).toContain("at async file:///isolated/bin.js:133:3 {");
    expect(details).toContain("[cause]: Error: failed to apply loader");
    expect(details).toContain("port: 13081\n    }\n  }\n}\n\nNode.js v22.23.0");
    expect(details).not.toContain("starting fallback listener");
    expect(details).not.toContain("at noon");
    expect(html).toContain('class="command-log-text">  status: starting fallback listener</pre>');
    expect(html).toContain("  at noon\n&lt;script&gt;</pre>");
  });
  it("formats the complete TigerVNC warning and aligns session identifiers under their source headers", () => {
    const text = [
      "[status]",
      "WARNING: vncserver has been replaced by a systemd unit.",
      "Please read /usr/share/doc/tigervnc/HOWTO.md for more information.",
      "",
      "TigerVNC server sessions:",
      "",
      "X DISPLAY # PROCESS ID",
      ":1 101",
      ":5\t\t202",
    ].join("\r\n");
    const html = renderToStaticMarkup(<CommandOutputText text={text} />);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain("<strong>WARNING</strong>");
    expect(html).toContain("<p>vncserver has been replaced by a systemd unit.\nPlease read /usr/share/doc/tigervnc/HOWTO.md for more information.</p>");
    expect(html).not.toContain("<details");
    expect(html).toContain('<caption class="command-log-section">TigerVNC server sessions</caption>');
    expect(html).toContain('<th scope="col">X DISPLAY #</th><th scope="col" data-numeric="true">PROCESS ID</th>');
    expect(html).toContain('<td>:1</td><td data-numeric="true">101</td>');
    expect(html).toContain('<td>:5</td><td data-numeric="true">202</td>');
  });
  it("uses explicit columns and keeps ambiguous spacing and markup as literal text", () => {
    const text = [
      "[FATAL] terminal probe failed",
      "Fallback output:",
      "",
      "Opened  first file",
      "Closed  first file",
      "",
      "USER\tCOMMAND\tPORT",
      "ops \t <script>\t5901",
      "invalid unaligned row",
    ].join("\n");
    const html = renderToStaticMarkup(<CommandOutputText text={text} />);
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('<h4 class="command-log-section">Fallback output</h4>');
    expect(html).toContain('class="command-log-text">Opened  first file\nClosed  first file</pre>');
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).toContain("<td>ops</td><td>&lt;script&gt;</td>");
    expect(html).toContain('class="command-log-text">invalid unaligned row</pre>');
  });
  it("keeps empty optional code lists distinct from invalid or ambiguous input", () => {
    expect(parseCodes("")).toEqual([]);
    expect(parseCodes("0, 3")).toEqual([0, 3]);
    expect(parseCodes("0,")[1]).toBeNaN();
    expect(parseCodes("error")[0]).toBeNaN();
  });
});
