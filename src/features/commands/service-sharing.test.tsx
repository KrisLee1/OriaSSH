import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ServiceEditor } from "./preset-commands";
import { ServiceReview, ServiceEnableDialog } from "./service-review";
import { reviewScript, OutputDecoder } from "./command-model";
import {
  ImportConfigReview,
  importDependencies,
} from "@/features/tunnels/import-config";
import { ConfigExportDialog } from "@/features/tunnels/config-export";
import type {
  ImportPreview,
  RemoteService,
  Snapshot,
  CommandRun,
} from "@/types";
vi.mock("@/components/tunnel-form", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/tunnel-form")>()),
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const service: RemoteService = {
  id: "s",
  name: "Model",
  executionHostId: "h",
  revision: "v1",
  ruleIds: [],
  noLocalEnvironment: true,
  executionEnabled: false,
  actions: [
    {
      id: "a",
      kind: "start",
      label: "Start",
      command: "<img src=x onerror=alert(1)>\nwhoami\r\u202eevil",
      timeoutSecs: 60,
      successCodes: [0],
      confirm: true,
    },
  ],
  control: {
    statusProbe: null,
    healthProbe: {
      command: "HEALTH_CANARY",
      readyCodes: [0],
      notReadyCodes: [1],
      repeatable: false,
      timeoutSecs: 5,
      intervalSecs: 2,
      budgetSecs: 30,
    },
    startActionId: "a",
    checkAfterActions: false,
    ttlSecs: 60,
  },
};
describe("service package review", () => {
  it("offers unlimited duration for standalone commands in either interface and bounds combined starts", () => {
    const foreground = {
      ...service,
      control: { ...service.control!, startActionId: null },
      actions: service.actions.map((a) => ({
        ...a,
        mode: "terminal" as const,
        timeoutSecs: 0,
      })),
    };
    const html = renderToStaticMarkup(
      <ServiceReview service={foreground} endpoint="linked forward" />,
    );
    expect(html).toContain(i18n.t("review.unlimited", { ns: "commands" }));
    const editor = (value: RemoteService) =>
      renderToStaticMarkup(
        <ServiceEditor
          service={value}
          data={{ hosts: [], rules: [] } as unknown as Snapshot}
          busy={false}
          onSave={() => {}}
          onCancel={() => {}}
        />,
      );
    expect(editor(foreground)).toMatch(
      /type="number"[^>]*min="0"[^>]*max="3600"[^>]*value="0"/,
    );
    expect(
      editor({
        ...foreground,
        actions: foreground.actions.map((action) => ({
          ...action,
          mode: "command",
        })),
      }),
    ).toMatch(/type="number"[^>]*min="0"[^>]*max="3600"[^>]*value="0"/);
    expect(editor(service)).toMatch(
      /type="number"[^>]*min="1"[^>]*max="3600"[^>]*value="60"/,
    );
  });
  it("enables from the explicit action button without an agreement checkbox", () => {
    const render = (busy: boolean) =>
      renderToStaticMarkup(
        <ServiceEnableDialog
          service={service}
          endpoint="linked forward"
          busy={busy}
          error=""
          close={() => {}}
          enable={() => {}}
        />,
      );
    const html = render(false);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('class="service-review-meta"');
    const label = i18n.t("sharing.enable", { ns: "commands" });
    const buttons = [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map(
      (match) => match[0],
    );
    const enable = buttons.find((button) => button.includes(label));
    expect(enable).toBeDefined();
    expect(enable).not.toMatch(/\sdisabled(?:=|\s|>)/);
    const pending = [
      ...render(true).matchAll(/<button[^>]*>[\s\S]*?<\/button>/g),
    ]
      .map((match) => match[0])
      .find((button) => button.includes(label));
    expect(pending).toMatch(/\sdisabled(?:=|\s|>)/);
  });
  it("allows saving an imported health-only service without adding an unrelated action", () => {
    const html = renderToStaticMarkup(
      <ServiceEditor
        service={{ ...service, hostIds: ["h"], actions: [] }}
        data={{ hosts: [], rules: [] } as unknown as Snapshot}
        busy={false}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const submit = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
    expect(submit).toBeDefined();
    expect(submit).not.toContain('disabled=""');
  });

  it("shows all executable scripts, effective endpoint and invisible characters safely in all languages", async () => {
    for (const language of [
      "en",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "de",
      "fr",
      "ru",
    ]) {
      await i18n.changeLanguage(language);
      const html = renderToStaticMarkup(
        <ServiceReview service={service} endpoint="tester@127.0.0.1:2222" />,
      );
      expect(html).toContain("tester@127.0.0.1:2222");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).not.toContain("<img");
      expect(html).toContain("␍\\u202e");
      expect(html).toContain("HEALTH_CANARY");
      expect(html).not.toMatch(/>sharing\.|>service\./);
    }
    await i18n.changeLanguage("zh-CN");
  });
  it("keeps imported services unselected and service-only import disabled until explicitly selected", () => {
    const preview = {
      token: "token",
      fileName: "package.json",
      version: 2,
      hosts: [],
      rules: [],
      services: [
        { ...service, endpoint: "tester@127.0.0.1:2222", conflict: true },
      ],
    } as ImportPreview;
    const html = renderToStaticMarkup(
      <ImportConfigReview
        preview={preview}
        hosts={[]}
        busy={false}
        close={() => {}}
        submit={async () => true}
      />,
    );
    expect(html).toContain("默认禁用执行");
    expect(html).toContain("HEALTH_CANARY");
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>导入/);
  });
  it("preselects migration services while requiring separate consent for their scripts", () => {
    const html = renderToStaticMarkup(
      <ConfigExportDialog
        data={
          { hosts: [], rules: [], services: [service] } as unknown as Snapshot
        }
        mode="migration"
        close={() => {}}
      />,
    );
    expect(html).toContain(i18n.t("exportScriptsHint", { ns: "tunnel" }));
    expect(html).toContain(i18n.t("sharing.review", { ns: "commands" }));
    expect(html).not.toContain("HEALTH_CANARY");
    expect(html).toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>核对清单/);
  });
  it("starts sharing with an empty scope and service scripts excluded", () => {
    const html = renderToStaticMarkup(
      <ConfigExportDialog
        data={
          { hosts: [], rules: [], services: [service] } as unknown as Snapshot
        }
        mode="share"
        close={() => {}}
      />,
    );
    expect(html).not.toContain("HEALTH_CANARY");
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>核对清单/);
  });
  it("follows only selected dependencies and stops at explicitly reused hosts", () => {
    const preview = {
      hosts: [
        { id: "constructor", proxyJump: "jump" },
        { id: "jump" },
        { id: "unused" },
      ],
      rules: [{ id: "forward", hostId: "constructor", loginId: "login-a" }],
      services: [
        {
          id: "service",
          hostIds: ["constructor"],
          loginByHost: { constructor: "login-b" },
        },
      ],
    } as unknown as ImportPreview;
    const selected = importDependencies(
      preview,
      [],
      ["forward"],
      ["service"],
      {},
    );
    expect([...selected.hosts]).toEqual(["constructor", "jump"]);
    expect([...(selected.bindings.get("constructor") ?? [])]).toEqual([
      "login-b",
    ]);
    expect([
      ...importDependencies(preview, [], [], ["service"], {
        constructor: "local",
      }).hosts,
    ]).toEqual(["constructor"]);
    expect(importDependencies(preview, [], [], [], {}).hosts.size).toBe(0);
  });
  it("offers a v3 standalone host without selecting a rule or a command", () => {
    const preview: ImportPreview = {
      token: "preview",
      fileName: "host.json",
      version: 3,
      selectedHostIds: ["host"],
      hosts: [
        {
          id: "host",
          name: "Host only",
          endpoint: "fixture@127.0.0.1:22",
          conflict: false,
          keyPathsOmitted: false,
          keyPaths: [],
          blocked: false,
        },
      ],
      rules: [],
      services: [],
    };
    const html = renderToStaticMarkup(
      <ImportConfigReview
        preview={preview}
        hosts={[]}
        busy={false}
        close={() => {}}
        submit={async () => true}
      />,
    );
    expect(html).toContain('checked=""');
    expect(html).toContain("导入 1 台新主机、0 个服务、0 条转发");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>导入/);
  });
  it("shows control and bidi escapes without changing the saved script", () => {
    const raw = "printf '中文'\n\t\u200b\u2066x\u2069\x1b\x7f";
    expect(reviewScript(raw)).toBe("printf '中文'\n\t\\u200b\\u2066x\\u2069␛␡");
    expect(raw).toContain("\u200b");
  });
  it("bounds repeated output and accepts an empty backend eviction reset", () => {
    const decoder = new OutputDecoder();
    const run = {} as CommandRun;
    const bytes = Array(64 * 1024).fill(120);
    for (let sequence = 1; sequence <= 64; sequence++)
      expect(
        decoder.accept({
          run,
          reset: false,
          output: [{ sequence, stream: "stdout", bytes }],
        }).length,
      ).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(decoder.accept({ run, reset: true, output: [] })).toBe("");
    expect(
      decoder.accept({
        run,
        reset: false,
        output: [{ sequence: 100, stream: "stderr", bytes: [65] }],
      }),
    ).toBe("A");
  });
});
