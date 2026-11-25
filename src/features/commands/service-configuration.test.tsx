import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import i18n from "@/i18n";
import { posixShell } from "@/test/posix-shell";
import {
  renderInvocation,
  displayInvocation,
  readableActionPreview,
  readableShellSource,
  normalizeInvocation,
  CommandInvocationEditor,
  CommandEnvironmentEditor,
  editActionEnvironment,
  editActionScript,
  actionScript,
  isStructuredCommand,
  switchActionFormat,
} from "./command-invocation";
import {
  completedPortAlias,
  editPortText,
  portText,
  servicePortToken,
  textEdit,
  variableOffer,
} from "./command-variable-model";
import {
  builtinServiceTemplates,
  applyLaunchTemplate,
  fillServiceTemplate,
  groupServiceTemplates,
  serviceTemplateCategories,
  serviceTemplateGroups,
  localizedServiceTemplates,
  groupServices,
  serviceCategory,
  type ServiceTemplateGroup,
} from "./service-template-catalog";
import {
  ServiceEditor,
  PresetCommandProvider,
  HostServices, AddHostService,
} from "./preset-commands";
import { RuleEditor } from "@/features/tunnels/rule-editor";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import { newService } from "./command-model";
import { manageServiceWithSystemd, restoreSystemdCommand, systemdService, systemdUnit } from "./systemd-service";
import type { RemoteService, Snapshot, ServiceTemplate } from "@/types";
import catalog from "@/features/tunnels/connection-icon-catalog.json";
import categoryIds from "./service-category-ids.json";
const host = { ...emptyHost(), id: "host", name: "fixture" };
const service: RemoteService = {
  ...newService("host"),
  id: "svc",
  name: "Model service",
  revision: "rev",
  ruleIds: ["rule"],
  color: "#67ad98",
  icon: { kind: "builtin", value: "brain" },
  actions: [
    {
      id: "start",
      kind: "start",
      label: "Launch",
      command: "printf ok",
      timeoutSecs: 60,
      confirm: true,
      successCodes: [0],
    },
  ],
};
const snapshot = {
  hosts: [host],
  rules: [{ ...emptyRule("host"), id: "rule", name: "Forward" }],
  services: [service],
  addedHostIds: ["host"],
  hostSnapshots: [],
  runtimes: [],
  diagnostics: [],
} as unknown as Snapshot;
function base(resource: string): ServiceTemplate {
  return {
    resource,
    shell: "POSIX sh",
    control: {
      statusProbe: {
        actionId: "status",
        mode: "exitCode",
        runningCodes: [0],
        stoppedCodes: [3],
        failedCodes: [4],
      },
      healthProbe: null,
      startActionId: "start",
      checkAfterActions: false,
      ttlSecs: 30,
    },
    actions: ["start", "stop", "restart", "status", "logs"].map((kind) => ({
      id: kind,
      kind: kind as "start",
      label: kind,
      command:
        kind === "status"
          ? 'load=$(systemctl --user show --property=LoadState --value -- unit) || exit 5\n[ "$load" = loaded ] || exit 5\nexit 0'
          : `printf '%s' ${kind}`,
      timeoutSecs: 60,
      successCodes: [0],
      confirm: kind === "restart" || kind === "stop",
    })),
  };
}
describe("service configuration", () => {
  it("lists host services with their own addresses and controls, independently of their forwards", () => {
    const rules = [
      ...["one", "two", "legacy"].map((id) => ({ ...emptyRule(host.id), id })),
      { ...emptyRule(host.id), id: "remote", kind: "R" as const },
      { ...emptyRule(host.id), id: "proxy", kind: "D" as const },
    ];
    const services = [
      { ...service, port: 8080, ruleIds: ["one", "two", "proxy"] },
      { ...newService(host.id), id: "legacy-profile", name: "Legacy service", hostIds: undefined, ruleIds: ["legacy"] },
      { ...newService(host.id), id: "desktop", name: "VNC", port: 5900, directProtocol: "vnc" as const },
      { ...newService("other"), id: "other", name: "Other host only" },
    ];
    const html = renderToStaticMarkup(
      <PresetCommandProvider data={{ ...snapshot, services, rules }} onSnapshot={() => {}}>
        <AddHostService hostId={host.id} />
        <HostServices host={{ ...host, address: "::1" }} canLink />
      </PresetCommandProvider>,
    );
    const group = html.match(/<section class="canvas-service"[^>]*aria-label="Model service"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(html).toContain(`<h3 class="host-card-group-title">${i18n.t("services", { ns: "commands" })}</h3>`);
    expect(group).not.toMatch(/class="status(?:\s|")/);
    expect(group).toContain("canvas-service-path");
    expect(group).toContain("canvas-service-actions");
    expect(group).toContain("[::1]:8080");
    expect(group).not.toContain("lucide-ellipsis");
    expect(group).toContain(`aria-label="${i18n.t("details", { ns: "tunnel" })} Model service"`);
    expect(group).toContain("Launch");
    expect(group).toContain(`aria-label="${i18n.t("edit", { ns: "commands" })} Model service"`);
    expect(group).toContain(`aria-label="${i18n.t("delete", { ns: "commands" })} Model service"`);
    expect(html).not.toMatch(/data-(canvas-rules|link-rule|rule-endpoint)=/);
    expect(html).toContain('data-canvas-service="legacy-profile"');
    const desktop = html.match(/<section class="canvas-service"[^>]*aria-label="VNC"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    expect(desktop).not.toContain(i18n.t("serviceUnbound", { ns: "commands" }));
    expect(desktop).not.toMatch(/class="status(?:\s|")/);
    expect(desktop).toMatch(/class="canvas-path-access"><span[^>]*>VNC<\/span><span class="service-open-action/);
    expect(desktop).toMatch(/class="canvas-path-route"><code[^>]*>\[::1\]:5900<\/code>/);
    expect(desktop).toContain(`aria-label="${i18n.t("openNamedService", { ns: "commands", name: "VNC" })}"`);
    expect(html).not.toContain("Other host only");
    expect(html).toContain(i18n.t("addService", { ns: "commands" }));
  });
  it("offers creation inside the host without a service manager or assignment picker", () => {
    const html = renderToStaticMarkup(
      <PresetCommandProvider data={{ ...snapshot, services: [] }} onSnapshot={() => {}}>
        <AddHostService hostId={host.id} />
        <HostServices host={host} canLink />
      </PresetCommandProvider>,
    );
    expect(html).toContain(i18n.t("addService", { ns: "commands" }));
    expect(html).not.toContain(i18n.t("manageServices", { ns: "commands" }));
    expect(html).not.toContain("host-card-group-title");
  });
  it("uses the linked L path inside the service card without a second address or action row", () => {
    const serviceHost = { ...host, address: "lab.example" };
    const rule = { ...emptyRule(host.id), id: "linked", name: "Forward", targetPort: 8080 };
    const profile = { ...service, port: 8080, ruleIds: [rule.id] };
    const html = renderToStaticMarkup(
      <PresetCommandProvider data={{ ...snapshot, services: [profile], rules: [rule] }} onSnapshot={() => {}}>
        <HostServices host={serviceHost} canLink forwardsFor={() => [rule]}
          forwardControls={() => ({ traffic: "↑ 0 B　↓ 0 B", open: null })} />
      </PresetCommandProvider>,
    );
    expect(html).toContain('data-canvas-rules="linked"');
    expect(html).toContain('data-rule-endpoint="linked"');
    expect(html).toContain('data-edit-port="linked"');
    expect(html).toContain("↑ 0 B　↓ 0 B");
    expect(html).toContain("127.0.0.1:8080");
    expect(html).not.toContain(`${serviceHost.address}:8080`);
    expect(html).not.toContain('class="host-card-rule"');
    expect(html).not.toContain('class="rule-actions');
  });
  it("groups services by service category rather than command kinds and honors explicit choices", () => {
    expect(categoryIds).toEqual([...serviceTemplateCategories]);
    const legacy = {
      ...service,
      category: undefined,
      icon: { kind: "builtin" as const, value: "ollama" },
    };
    expect(serviceCategory(legacy)).toBe("inference");
    expect(serviceCategory({ ...legacy, category: "development" })).toBe(
      "development",
    );
    expect(serviceCategory({ ...legacy, category: "other" })).toBe("other");
    const groups = groupServices([
      legacy,
      { ...legacy, id: "other", category: "other" },
    ]);
    expect(groups.map((group) => group.category)).toEqual([
      "inference",
      "other",
    ]);
    expect(groups.flatMap((group) => group.services)).toHaveLength(2);
  });
  it("applies variables to an entire shell script and preserves source and variables through format changes", () => {
    const source =
      '# keep the script\nprintf "%s\\0" "$ORIA_SCRIPT_TEST"\nprintf "%s" "${ORIA_EMPTY_TEST+x}"\n';
    const literal = "a' b $HOME $(printf UNSAFE) 中文";
    const original = {
      ...service.actions[0],
      invocation: null,
      command: source,
    };
    const scripted = editActionEnvironment(original, [
      { name: "ORIA_SCRIPT_TEST", value: literal },
      { name: "ORIA_EMPTY_TEST", value: "" },
    ]);
    expect(isStructuredCommand(scripted)).toBe(false);
    expect(actionScript(scripted)).toBe(source);
    expect(execFileSync(posixShell, ["-c", scripted.command]).toString()).toBe(
      `${literal}\0x`,
    );
    const structured = switchActionFormat(scripted, "command");
    expect(isStructuredCommand(structured)).toBe(true);
    const restored = switchActionFormat(structured, "script");
    expect(actionScript(restored)).toBe(source);
    expect(restored.invocation?.environment).toEqual(
      scripted.invocation?.environment,
    );
    expect(actionScript(JSON.parse(JSON.stringify(restored)))).toBe(source);
    const changed = editActionScript(restored, source + "# edited\n");
    const removed = editActionEnvironment(changed, []);
    expect(removed.invocation).toBeNull();
    expect(removed.command).toBe(source + "# edited\n");
  });
  it("shows the common environment editor in script and structured modes and keeps script source editable", () => {
    const original = {
      ...service.actions[0],
      invocation: null,
      command: "printf original",
    };
    const scripted = editActionEnvironment(original, [
      { name: "MODEL_PORT", value: "8000" },
    ]);
    for (const action of [
      original,
      scripted,
      switchActionFormat(scripted, "command"),
    ]) {
      const html = renderToStaticMarkup(
        <ServiceEditor
          service={{ ...service, actions: [action] }}
          data={snapshot}
          busy={false}
          onSave={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain(
        i18n.t("builder.environmentAdd", { ns: "commands" }),
      );
      if (isStructuredCommand(action)) {
        expect(html).toContain("service-command-preview");
        expect(html).not.toContain("<textarea");
      } else {
        expect(html).toMatch(/<textarea[^>]*required/);
      }
    }
  });
  it("restores the original arguments after an unchanged script round trip", () => {
    const invocation = {
      executable: "dsh",
      arguments: [
        { name: "", value: "web" },
        { name: "--port", value: servicePortToken },
      ],
      environment: [{ name: "MODE", value: "original" }],
    };
    const action = {
      ...service.actions[0],
      invocation,
      command: renderInvocation(invocation),
      servicePortVariable: true,
    };
    const script = switchActionFormat(action, "script");
    const environment = [{ name: "MODE", value: "edited" }];
    const updated = editActionEnvironment(script, environment);
    const restored = switchActionFormat(updated, "command", invocation);
    expect(restored.invocation).toEqual({ ...invocation, environment });
    expect(restored.command).toBe(renderInvocation({ ...invocation, environment }));
    expect(restored.servicePortVariable).toBe(true);

    const edited = editActionScript(script, "dsh web && printf 'ready'");
    const converted = switchActionFormat(edited, "command", invocation);
    expect(converted.invocation?.executable).toBe("sh");
    expect(actionScript(switchActionFormat(converted, "script"))).toBe(actionScript(edited));
  });
  it("passes explicit environment values literally, including empty values, without changing the parent environment", () => {
    const literal = "a' b;$(printf UNSAFE)`id` $HOME 中文";
    const invocation = normalizeInvocation({
      executable: "/bin/sh",
      arguments: [
        { name: "", value: "-c" },
        {
          name: "",
          value: 'printf "%s\\0%s" "$ORIA_ENV_TEST" "${ORIA_EMPTY_TEST+x}"',
        },
      ],
      environment: [
        { name: "ORIA_ENV_TEST", value: literal },
        { name: "ORIA_EMPTY_TEST", value: "" },
        { name: "", value: "" },
      ],
    });
    expect(invocation.environment).toHaveLength(2);
    expect(
      execFileSync(posixShell, ["-c", renderInvocation(invocation)]).toString(),
    ).toBe(`${literal}\0x`);
    const html = renderToStaticMarkup(
      <CommandEnvironmentEditor
        value={invocation.environment || []}
        onChange={() => {}}
      />,
    );
    expect(html).toContain(
      i18n.t("builder.environmentAdd", { ns: "commands" }),
    );
    expect(html).toContain('pattern="[A-Za-z_][A-Za-z0-9_]*"');
  });
  it("keeps managed recipe environment in the original structured command", () => {
    const preset = builtinServiceTemplates.find((preset) => preset.id === "dsh-systemd")!;
    const invocation = {
      ...preset.launch!,
      environment: [
        { name: "CUDA_VISIBLE_DEVICES", value: "0,1" },
        { name: "LITERAL", value: "$HOME ' 中文" },
      ],
    };
    const result = applyLaunchTemplate(base("oria-dsh.service"), preset, invocation);
    expect(result.actions[0].invocation).toEqual(invocation);
    expect(result.actions[0].command).toBe(renderInvocation(invocation));
  });
  it("omits blank parameter values and unused rows while keeping literal nonempty values", () => {
    const invocation = {
      executable: "dsh",
      arguments: [
        { name: "", value: "web" },
        { name: "--no-open", value: "" },
        { name: "--flag", value: null },
        { name: "", value: "" },
        { name: "", value: null },
        { name: "--port", value: "0" },
        { name: "--literal", value: " $(id) " },
      ],
    };
    const result = normalizeInvocation(invocation);
    expect(result.arguments).toHaveLength(5);
    expect(renderInvocation(result)).toBe(
      "'dsh' 'web' '--no-open' '--flag' '--port' '0' '--literal' ' $(id) '",
    );
    expect(invocation.arguments).toHaveLength(7);
    const html = renderToStaticMarkup(
      <CommandInvocationEditor value={result} onChange={() => {}} />,
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("lucide-trash-2");
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
    expect(inputs.every((input) => !/\sdisabled(?:=|\s|>)/.test(input))).toBe(
      true,
    );
  });
  it("renders a readable legacy shell wrapper without changing the executable representation", () => {
    const body = `'dsh' 'web' '--port' '13081'${servicePortToken}`;
    const invocation = {
      executable: "sh",
      arguments: [{ name: "", value: "-c" }, { name: "", value: body }],
    };
    const canonical = renderInvocation(invocation);
    expect(readableShellSource(body, true)).toBe(`dsh web --port 13081${servicePortToken}`);
    expect(displayInvocation(invocation, true).text).toBe(`sh -c 'dsh web --port 13081${servicePortToken}'`);
    expect(displayInvocation({ executable: "dsh", arguments: [{ name: "", value: "a b'c" }] }, false).text)
      .toBe(`dsh 'a b'"'"'c'`);
    expect(readableShellSource("'printf' '$HOME' && echo x", false)).toBe("'printf' '$HOME' && echo x");
    expect(invocation.arguments[1].value).toBe(body);
    expect(renderInvocation(invocation)).toBe(canonical);
  });
  it("keeps equal literal numbers distinct from a port token and respects escaped dollars", () => {
    const view = portText(`6300${servicePortToken}`, "6300");
    const edit = textEdit(view.text, "6300", 0, { start: 0, end: 4 });
    expect(editPortText(view, edit, edit.inserted)).toBe(servicePortToken);
    expect(editPortText(view, { start: 5, end: 6 }, "7")).toBe("63007");
    expect(variableOffer("$", 1)).toEqual({ start: 0, end: 1 });
    expect(variableOffer("$HOME", 5)).toBeNull();
    expect(variableOffer("$$", 2)).toBeNull();
    expect(completedPortAlias("=\${PORT}", 8)).toBe(1);
    expect(completedPortAlias("\\\${PORT}", 8)).toBeNull();
  });
  it("keeps required argument quotes and environment data in the resolved execution preview", () => {
    const invocation = {
      executable: "dsh",
      arguments: [
        { name: "", value: "web" },
        { name: "--port", value: "13081" },
        { name: "--title", value: "two words" },
      ],
      environment: [{ name: "MODE", value: "local" }],
    };
    const command = renderInvocation(invocation);
    const action = { ...service.actions[0], invocation, command };
    expect(readableActionPreview(action, command)).toBe("MODE=local dsh web --port 13081 --title 'two words'");
    expect(readableActionPreview(action, "printf '%s' \"$MODE\"\n")).toBe("printf '%s' \"$MODE\"\n");
    expect(renderInvocation(invocation)).toBe(command);
  });
  it("groups every recipe once and searches names and localized categories without empty groups", () => {
    const labels = Object.fromEntries(
      serviceTemplateGroups.map((category) => [
        category,
        i18n.t(`templates.groups.${category}`, { ns: "commands" }),
      ]),
    ) as Record<ServiceTemplateGroup, string>;
    const groups = groupServiceTemplates(builtinServiceTemplates, "", labels);
    expect(
      groups
        .flatMap((group) => group.templates)
        .map((template) => template.id)
        .sort(),
    ).toEqual(builtinServiceTemplates.map((template) => template.id).sort());
    const managed = groups.find((group) => group.category === "systemd")!;
    expect(managed.templates).toHaveLength(31);
    expect(managed.name).toBe(labels.systemd);
    expect(
      managed.templates.every((template) =>
        template.manager.startsWith("systemd"),
      ),
    ).toBe(true);
    expect(
      groups
        .filter((group) => group.category !== "systemd")
        .flatMap((group) => group.templates)
        .every((template) => template.manager === "direct"),
    ).toBe(true);
    expect(
      groupServiceTemplates(builtinServiceTemplates, labels.systemd, labels),
    ).toEqual([managed]);
    expect(
      managed.templates.find((template) => template.id === "dsh-systemd")
        ?.category,
    ).toBe("inference");
    expect(
      groupServiceTemplates(builtinServiceTemplates, "  ＤＳＨ  ", labels).map(
        (group) => [
          group.category,
          group.templates.map((template) => template.id),
        ],
      ),
    ).toEqual([
      ["inference", ["dsh"]],
      ["systemd", ["dsh-systemd"]],
    ]);
    expect(
      groupServiceTemplates(
        builtinServiceTemplates,
        labels.inference,
        labels,
      ).map((group) => group.category),
    ).toEqual(["inference", "systemd"]);
    expect(
      groupServiceTemplates(
        builtinServiceTemplates,
        "docker CONTAINER",
        labels,
      )[0].templates.map((template) => template.id),
    ).toEqual(["dockerContainer"]);
    expect(
      groupServiceTemplates(builtinServiceTemplates, "no-such-service", labels),
    ).toEqual([]);
  });
  it("keeps one localized Docker container in containers and only systemd templates in generic", () => {
    const templates = localizedServiceTemplates((key) =>
      i18n.t(key, { ns: "commands" }),
    );
    const containers = templates.filter(
      (template) => template.id === "dockerContainer",
    );
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      category: "containers",
      name: i18n.t("templates.docker", { ns: "commands" }),
    });
    expect(
      templates
        .filter((template) => template.category === "generic")
        .map((template) => template.manager)
        .sort(),
    ).toEqual(["systemdSystem", "systemdUser"]);
  });
  it("provides direct editable commands for databases, caches, messaging, monitoring and storage", () => {
    const expected = {
      databases: ["postgresql", "mysql", "mariadb", "mongodb", "elasticsearch"],
      caches: ["redis", "valkey", "memcached"],
      messaging: ["rabbitmq", "kafka"],
      observability: ["prometheus", "grafana"],
      storage: ["minio"],
    };
    for (const [category, ids] of Object.entries(expected)) {
      const templates = builtinServiceTemplates.filter(
        (template) =>
          template.category === category && template.manager === "direct",
      );
      expect(templates.map((template) => template.id).sort()).toEqual(
        ids.sort(),
      );
      for (const template of templates) {
        const result = applyLaunchTemplate(
          base(`${template.resource}.service`),
          template,
          template.launch,
        );
        expect(result.name).toBe(template.name);
        expect(result.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(result.icon).toEqual({ kind: "builtin", value: template.icon });
        expect(result.actions.length).toBeGreaterThan(0);
        if (template.id !== "vnc") expect(result.control.statusProbe).toBeNull();
        expect(
          result.actions.map((action) => action.command).join("\n"),
        ).not.toMatch(/systemctl|systemd-run|journalctl/);
      }
    }
  });
  it("imports the entire service template into an existing draft without saving or changing its identity, references or permission", () => {
    const preset = builtinServiceTemplates.find(
      (preset) => preset.id === "dsh-systemd",
    )!;
    const template = applyLaunchTemplate(
      base("oria-dsh.service"),
      preset,
      preset.launch,
    );
    const current = {
      ...service,
      executionEnabled: false,
      noLocalEnvironment: false,
    };
    const before = JSON.stringify(current);
    const result = fillServiceTemplate(current, template);
    expect(result.name).toBe("DeepSeek Harness · systemd");
    expect(result.category).toBe("inference");
    expect(result.color).toBe(preset.color);
    expect(result.icon).toEqual({ kind: "builtin", value: preset.icon });
    expect(result.actions).toEqual(template.actions);
    expect(result.control).toEqual(template.control);
    expect(result).toMatchObject({
      id: service.id,
      revision: service.revision,
      ruleIds: service.ruleIds,
      executionEnabled: false,
      noLocalEnvironment: false,
    });
    expect(JSON.stringify(current)).toBe(before);
    // Subsequent edits must change only this draft, including nested parameters.
    result.name = "Custom service";
    result.actions[0].invocation!.arguments[0].name = "--modified";
    result.control!.statusProbe!.runningCodes.push(7);
    expect(template.actions[0].invocation!.arguments[0].name).toBe("");
    expect(template.control.statusProbe!.runningCodes).toEqual([0]);
  });
  it("replaces stale decoration and commands when importing a generic service template", () => {
    const template = base("custom.service");
    const result = fillServiceTemplate(service, template);
    expect(result.name).toBe("custom.service");
    expect(result.color).toBeNull();
    expect(result.icon).toBeNull();
    expect(result.actions.map((action) => action.kind)).toEqual([
      "start",
      "stop",
      "restart",
      "status",
      "logs",
    ]);
  });
  it("quotes positional values, switches, empty values, Unicode and shell metacharacters literally", () => {
    const words = [
      "a b",
      "a'quote",
      "$(printf UNSAFE)",
      "`printf UNSAFE`",
      "; touch /tmp/never",
      "",
      "中文\\path",
      "$HOME %n",
    ];
    const command = renderInvocation({
      executable: "/usr/bin/printf",
      arguments: [
        { name: "", value: "%s\\0" },
        ...words.map((value) => ({ name: "", value })),
        { name: "--flag", value: null },
      ],
    });
    expect(
      execFileSync(posixShell, ["-c", command])
        .toString()
        .split("\0")
        .slice(0, -1),
    ).toEqual([...words, "--flag"]);
  });
  it("keeps direct commands and optional managed templates independent with valid shell syntax", () => {
    const scripts: string[] = [];
    expect(new Set(builtinServiceTemplates.map((p) => p.id)).size).toBe(
      builtinServiceTemplates.length,
    );
    const direct = builtinServiceTemplates.filter(
      (p) => p.manager === "direct",
    );
    expect(direct).toHaveLength(30);
    for (const preset of builtinServiceTemplates) {
      const before = base(`${preset.resource}.service`);
      const json = JSON.stringify(before);
      const result = applyLaunchTemplate(before, preset, preset.launch);
      expect(catalog.icons.some((icon) => icon.id === result.icon?.value)).toBe(
        true,
      );
      expect(JSON.stringify(before)).toBe(json);
      for (const action of result.actions) {
        // Parse each action in its own function body in one syntax-only shell.
        // Starting hundreds of MSYS processes blocks Vitest's worker on Windows.
        scripts.push(
          `oria_template_${scripts.length}() {\n${action.command}\n}`,
        );
        if (action.invocation)
          expect(action.command).toBe(renderInvocation(action.invocation));
      }
      if (preset.manager === "direct") {
        expect(result.actions.map((a) => a.command).join("\n")).not.toMatch(
          /systemctl|systemd-run|journalctl|pkill|killall|nohup/,
        );
        if (preset.id === "vnc") {
          expect(result.control.statusProbe).toMatchObject({
            actionId: result.actions.find(a => a.kind === "status")!.id, mode: "vncSessions",
          });
          expect(result.control.checkAfterActions).toBe(true);
          expect(result.port).toBe(5901);
        } else expect(result.control.statusProbe).toBeNull();
        expect(result.control.healthProbe).toBeNull();
        const start = result.actions.find((a) => a.kind === "start")!;
        expect(result.control.startActionId).toBe(
          start.mode === "terminal" ? null : start.id,
        );
        if (start.mode === "terminal") expect(start.timeoutSecs).toBe(0);
        else expect(start.timeoutSecs).toBeGreaterThan(0);
        continue;
      }
      expect(result.actions.map((a) => a.kind)).toEqual([
        "start",
        "stop",
        "restart",
        "status",
        "logs",
      ]);
      expect(result.control.startActionId).toBe(result.actions[0].id);
      expect(result.control.statusProbe?.actionId).toBe(result.actions[3].id);
      if (preset.launch) {
        expect(preset.id).toMatch(/-systemd$/);
        expect(result.actions[0].invocation).toEqual(preset.launch);
        expect(result.actions[0].systemdLaunch).toEqual({ unit: before.resource, mode: "transient" });
        expect(result.actions[2].systemdLaunch).toEqual(result.actions[0].systemdLaunch);
        expect(result.actions[3].command).toContain(
          '[ "$load" != not-found ] || exit 3',
        );
        expect(result.actions[2].command).toContain(result.actions[0].command);
      }
    }
    for (const preset of direct.filter((p) => p.id !== "dockerContainer")) {
      expect(
        builtinServiceTemplates.find((p) => p.id === `${preset.id}-systemd`)
          ?.name,
      ).toBe(`${preset.name} · systemd`);
    }
    execFileSync(posixShell, ["-n"], { input: scripts.join("\n") });
  });
  it.each([`oriatunnel-${service.id}`, systemdUnit(service.id)])("recovers the editable start command for %s", (unitName) => {
    const unit = `${unitName}.service`;
    const template = base(unit);
    template.actions.find((a) => a.kind === "stop")!.command = `systemctl --user stop -- '${unit}'`;
    template.actions.find((a) => a.kind === "status")!.command = [
      `load=$(systemctl --user show --property=LoadState --value -- '${unit}') || exit 5`,
      '[ "$load" = loaded ] || exit 5',
      `state=$(systemctl --user show --property=ActiveState --value -- '${unit}') || exit 5`,
      'case "$state" in', "  active) exit 0 ;;", "  inactive) exit 3 ;;",
      "  failed) exit 4 ;;", "  *) exit 5 ;;", "esac",
    ].join("\n");
    const start = { ...service.actions[0], command: 'printf "%s" "$MESSAGE"', invocation: undefined };
    const labels = { start: "Start", stop: "Stop", restart: "Restart", status: "Status", logs: "Logs", custom: "Custom" };
    const managed = manageServiceWithSystemd(service, start, template, labels);
    expect(managed.actions[0].id).toBe(start.id);
    expect(managed.actions[0].command).toBe(start.command);
    expect(managed.actions[0].systemdLaunch).toEqual({ unit, mode: "persistent" });
    expect(managed.control?.checkAfterActions).toBe(true);
    const lifecycle = systemdService(managed);
    expect(lifecycle?.unit).toBe(unit);
    expect(lifecycle?.startId).toBe(start.id);
    expect(systemdService({
      ...managed,
      actions: managed.actions.map((action) => action === lifecycle?.status
        ? { ...action, command: action.command + "\nprintf unrelated" }
        : action),
    })).toBeUndefined();
    const invocation = {
      executable: "dsh",
      arguments: [
        { name: "", value: "web" },
        { name: "--port", value: "13085" },
        { name: "--title", value: "A '$HOME'" },
      ],
    };
    const command = [
      'if [ "$(loginctl show-user "$(id -u)" --property=Linger --value 2>/dev/null)" != yes ]; then',
      "  printf '%s\\n' 'systemd user service requires Linger=yes to survive logout.' >&2",
      "  exit 1",
      "fi",
      `if [ "$(systemctl --user show --property=ActiveState --value -- '${unit}' 2>/dev/null)" = failed ]; then`,
      `  systemctl --user reset-failed -- '${unit}' || exit $?`,
      "fi",
      `systemd-run --user --no-ask-password --service-type=exec --unit='${unit}' --setenv=PATH -- /bin/sh -c ` +
        renderInvocation({ executable: renderInvocation(invocation).replaceAll("$", () => "$$"), arguments: [] }),
    ].join("\n");
    function legacy(command: string) {
      return { ...managed, actions: [{ ...start, mode: "command" as const, timeoutSecs: 60, command }, ...managed.actions.slice(1)] };
    }
    expect(restoreSystemdCommand(legacy(command)).actions[0]).toMatchObject({
      command: renderInvocation(invocation),
      invocation,
      systemdLaunch: { unit, mode: "persistent" },
    });
    const modified = command + "\nprintf custom";
    expect(restoreSystemdCommand(legacy(modified)).actions[0].command).toBe(modified);
  });
  it("uses the template port as a default while preserving the configured service port", () => {
    for (const id of ["dsh", "dsh-systemd", "jupyter", "memcached", "prometheus", "minio"]) {
      const preset = builtinServiceTemplates.find((p) => p.id === id)!;
      const template = applyLaunchTemplate(base("oria-example.service"), preset, preset.launch);
      const start = template.actions.find((action) => action.kind === "start")!;
      expect(start.servicePortVariable).toBe(true);
      expect(start.invocation?.arguments.some((arg) => arg.value?.includes(servicePortToken))).toBe(true);
      expect(fillServiceTemplate({ ...service, port: null }, template).port).toBeGreaterThan(0);
      expect(fillServiceTemplate({ ...service, port: 13085 }, template).port).toBe(13085);
    }
    const preset = builtinServiceTemplates.find((p) => p.id === "minio")!;
    const start = applyLaunchTemplate(base("oria-minio.service"), preset, preset.launch).actions[0];
    expect(start.invocation?.arguments.find((arg) => arg.name === "--console-address")?.value).toBe("127.0.0.1:9001");
  });
  it("uses a direct dsh foreground command on port 3080 and a native VNC daemon", () => {
    const preset = builtinServiceTemplates.find((p) => p.id === "dsh")!;
    expect(preset.icon).toBe("dsh");
    expect(preset.category).toBe("inference");
    expect(renderInvocation(preset.launch!)).toBe(
      "'dsh' 'web' '--port' '{{service.port}}'",
    );
    const dsh = applyLaunchTemplate(base("unused"), preset, preset.launch);
    expect(dsh.actions).toHaveLength(1);
    expect(dsh.actions[0]).toMatchObject({ mode: "terminal", timeoutSecs: 0 });
    const vncPreset = builtinServiceTemplates.find((p) => p.id === "vnc")!;
    const vnc = applyLaunchTemplate(
      base("unused"),
      vncPreset,
      vncPreset.launch,
    );
    expect(vnc.actions[0]).toMatchObject({
      command: "'vncserver' ':1' '-localhost' 'yes'",
      mode: "command",
    });
    expect(vnc.actions.find((a) => a.kind === "stop")?.command).toBe(
      "'vncserver' '-kill' ':1'",
    );
    expect(vnc.actions[0].command).not.toContain("-fg");
  });
  it("passes native launch arguments and environment literally without service-manager escaping", () => {
    const dir = mkdtempSync(join(tmpdir(), "oria-direct-launch-"));
    try {
      const stub = join(dir, "dsh");
      writeFileSync(stub, '#!/bin/sh\nprintf "%s\\0" "$MODEL" "$@"\n');
      chmodSync(stub, 0o700);
      const preset = builtinServiceTemplates.find((p) => p.id === "dsh")!;
      const invocation = {
        ...preset.launch!,
        environment: [{ name: "MODEL", value: "$HOME ' 中文" }],
        arguments: [
          { name: "", value: "web" },
          { name: "--path", value: "$(id) $MODEL %n" },
        ],
      };
      const result = applyLaunchTemplate(base("unused"), preset, invocation);
      const start = result.actions[0];
      expect(start).toMatchObject({ mode: "terminal", timeoutSecs: 0 });
      const output = execFileSync(posixShell, ["-c", start.command], {
        env: { PATH: dir },
      })
        .toString()
        .split("\0")
        .slice(0, -1);
      expect(output).toEqual([
        "$HOME ' 中文",
        "web",
        "--path",
        "$(id) $MODEL %n",
      ]);
      start.invocation!.environment![0].value = "edited";
      expect(invocation.environment[0].value).toBe("$HOME ' 中文");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps service appearance and command controls in the host editor", () => {
    const editor = renderToStaticMarkup(
      <ServiceEditor
        service={service}
        data={snapshot}
        busy={false}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(editor).toContain("profile-icon-trigger");
    expect(editor).toContain(i18n.t("serviceIcon", { ns: "commands" }));
    expect(editor).toContain('class="service-editor-connection"');
    expect(editor).toContain('class="editor-disclosure service-command-item"');
    expect(editor).toContain(
      'class="editor-disclosure service-editor-advanced"',
    );
    expect(
      editor.indexOf(i18n.t("templates.import", { ns: "commands" })),
    ).toBeLessThan(editor.indexOf("<form"));
    expect(editor).not.toContain(i18n.t("connectionColor", { ns: "tunnel" }));
    expect(editor).not.toContain(i18n.t("selectHostSearch", { ns: "tunnel" }));
    expect(editor).not.toContain(i18n.t("linkedForwards", { ns: "commands" }));
    expect(editor).not.toContain('name="hostIds"');

    expect(editor).toContain(i18n.t("builder.title", { ns: "commands" }));
  });
  it("requires a host before a service can be saved", () => {
    const unbound = { ...service, id: "", hostIds: [], executionHostId: "", ruleIds: [] };
    const html = renderToStaticMarkup(
      <ServiceEditor
        service={unbound}
        data={{ ...snapshot, hosts: [], rules: [] }}
        busy={false}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const save = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
    expect(save).toBeDefined();
    expect(save).toMatch(/\sdisabled(?:=|\s|>)/);
  });
  it("renders bound service chips in the D editor without changing its SSH host", () => {
    const html = renderToStaticMarkup(
      <RuleEditor
        draft={{ ...snapshot.rules[0], kind: "D" }}
        hosts={[host]}
        services={[service]}
        busy={false}
        reconnect={false}
        onChange={() => {}}
        onAddHost={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("combobox-chip");
    expect(html).toContain("Model service");
    expect(html).toContain("hostId");
  });
});
