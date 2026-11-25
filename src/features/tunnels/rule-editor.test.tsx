import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { RuleEditor } from "./rule-editor";
import { emptyRule, emptyHost, networkChanged, rulePath } from "./rule-model";
import type { Rule } from "@/types";
import { newService } from "@/features/commands/command-model";

function render(draft: Rule, hasHost = false) {
  return renderToStaticMarkup(
    <RuleEditor
      draft={draft}
      hosts={hasHost ? [{ ...emptyHost(), id: "h", name: "fixture" }] : []}
      busy={false}
      reconnect={false}
      onChange={() => {}}
      onAddHost={() => {}}
      onSave={() => {}}
      onCancel={() => {}}
    />,
  );
}
describe("forward composition and semantics", () => {
  it("shows the current host username without a separate credential selector", () => {
    const host = {
      ...emptyHost(), id: "h", name: "fixture", address: "host.invalid", user: "primary-user",
      defaultLoginId: "alternate",
      logins: [{ id: "alternate", label: "Other", user: "alternate-user", authMethod: "password" as const, identityFiles: [] }],
    };
    const html = renderToStaticMarkup(
      <RuleEditor
        draft={{ ...emptyRule("h"), loginIdentityId: "primary:h" }}
        hosts={[host]}
        busy={false}
        reconnect={false}
        onChange={() => {}}
        onAddHost={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("alternate-user@host.invalid");
    expect(html).not.toContain("primary-user@host.invalid");
    expect(html).not.toContain(i18n.t("logins", { ns: "tunnel" }));
  });
  it("shows the multi-service picker only for D and preserves existing L/R ports", () => {
    const association = i18n.t("associatedServices", { ns: "commands" });
    for (const kind of ["L", "R", "D"] as const) {
      const draft = { ...emptyRule("h"), id: "saved", kind, bindPort: 15432 };
      const html = renderToStaticMarkup(
        <RuleEditor
          draft={draft}
          savedRule={draft}
          hosts={[{ ...emptyHost(), id: "h" }]}
          services={[
            { ...newService("h"), id: "chosen", name: "linked-service", port: 3689, ruleIds: [draft.id] },
            { ...newService("other"), id: "foreign", name: "foreign-service", port: 3000 },
          ]}
          selectedServiceIds={["chosen", "foreign"]}
          busy={false}
          reconnect={false}
          onChange={() => {}}
          onAddHost={() => {}}
          onSave={() => {}}
          onCancel={() => {}}
        />,
      );
      const ports = [...html.matchAll(/<input[^>]*type="number"[^>]*>/g)].map((match) => match[0]);
      expect(html).not.toContain("foreign-service");
      if (kind === "D") {
        expect(html).toContain(association);
        expect(html).toContain("linked-service");
        expect(ports.some(port => port.includes('value="15432"') && !port.includes("readOnly"))).toBe(true);
        expect(ports.some(port => port.includes('value="3689"'))).toBe(false);
      } else {
        expect(html).not.toContain(association);
        expect(html).not.toContain("linked-service");
        expect(ports.some(port => port.includes('value="3689"') && port.includes("readOnly"))).toBe(true);
      }
      expect(html.includes("profile-icon-trigger")).toBe(kind !== "L");
    }
  });
  const text = (key: string) => i18n.t(key, { ns: "tunnel" });
  it("keeps a forward editor when no host exists and provides separate host actions", () => {
    const html = render(emptyRule());
    expect(html).toContain(text("forwardType"));
    expect(html.indexOf(text("forwardType"))).toBeLessThan(html.indexOf(text("path")));
    expect(html).toContain(text("selectHostSearch"));
    expect(html).toContain('role="combobox"');
    expect(html).toContain(text("addHost"));
    expect(html).not.toContain(text("manageHosts"));
    expect(html.indexOf(text("forwardType"))).toBeGreaterThan(
      html.indexOf(text("manageHosts")),
    );
    expect(html).not.toContain(text("user"));
    expect(html).not.toContain(text("identity"));
    expect(html).toContain("disabled");
  });
  it("keeps host actions by the selector and omits global service management", () => {
    const html = renderToStaticMarkup(
      <RuleEditor
        draft={emptyRule()}
        hosts={[]}
        busy={false}
        reconnect={false}
        onChange={() => {}}
        onAddHost={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html.indexOf(text("addHost"))).toBeLessThan(
      html.indexOf(text("selectHostSearch")),
    );
    expect(html).not.toContain(text("manageHosts"));
    expect(html).not.toContain(i18n.t("manageServices", { ns: "commands" }));
    expect(html).toContain("field-heading-actions");
  });
  it("renders R endpoints on the correct machine and D without fixed target controls", () => {
    const r = render({ ...emptyRule("h"), kind: "R" }, true);
    expect(r).toContain(text("remoteBindAddress"));
    expect(r).toContain(text("localTargetHost"));
    expect(r).toContain(text("forwardListener"));
    expect(r).toContain(text("forwardTarget"));
    const d = render({ ...emptyRule("h"), kind: "D" }, true);
    expect(d).toContain(text("forwardListener"));
    expect(d).not.toContain(text("forwardTarget"));
    expect(d).not.toContain(text("targetPort"));
    expect(d).not.toContain(text("targetHost"));
    expect(d).not.toContain(text("serviceProtocol"));
  });
  it("keeps an editable listener input with an automatic toggle for L and D", () => {
    for (const kind of ["L", "D"] as const) {
      const html = render({ ...emptyRule("h"), kind }, true);
      expect(html).toContain(`placeholder="${text("autoPortAssigned")}"`);
      expect(html).toMatch(/<input[^>]*data-port-field="bind"[^>]*>/);
      expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[^<]*<\/button>/);
    }
    const remote = render({ ...emptyRule("h"), kind: "R" }, true);
    expect(remote).not.toContain(text("autoPortAssigned"));
  });
  it("defaults to no remote command and supports host inheritance or explicit keepalive", () => {
    const html = render(emptyRule("h"), true);
    expect(html).toContain(text("noRemoteCommand"));
    expect(html).toContain(text("overrideConnection"));
    expect(html).not.toContain("（connection）");
    expect(html).not.toContain("（reconnect.enabled）");
    expect(html).not.toContain(`<span>${text("remoteCommand")}</span>`);
    const configured = render(
      {
        ...emptyRule("h"),
        noRemoteCommand: false,
        remoteCommand: "explicit-fixture",
        connection: {
          connectTimeoutSecs: 20,
          keepaliveIntervalSecs: 0,
          keepaliveMax: 5,
        },
      },
      true,
    );
    expect(configured).toContain("explicit-fixture");
    expect(configured).toContain(text("keepaliveIntervalTitle"));
    expect(configured).toContain("（-o ServerAliveInterval）");
    expect(configured).toContain("（-o RemoteCommand）");
  });
  it("offers deferred save and explicit restart for changes to a running listener", () => {
    const activeRule = { ...emptyRule("h"), id: "rule", name: "running", bindPort: 8080 };
    const actions = (draft: Rule) => renderToStaticMarkup(<RuleEditor
      draft={draft} activeRule={activeRule} hosts={[{...emptyHost(), id: "h"}]}
      reconnect={false} busy={false} onChange={() => {}} onSave={() => {}}
      onCancel={() => {}} onAddHost={() => {}}
    />);
    const changed = actions({ ...activeRule, bindPort: 0 });
    expect(changed).toContain(text("saveNextStart"));
    expect(changed).toContain(text("saveReconnect"));
    expect(changed).toContain(text("restartHint"));
    const renamed = actions({ ...activeRule, name: "renamed" });
    expect(renamed).not.toContain(text("saveReconnect"));
    expect(renamed).not.toContain(text("saveStart"));
  });
  it("preserves IPv6 path meaning and distinguishes metadata edits from reconnecting", () => {
    const rule = {
      ...emptyRule("h"),
      kind: "R" as const,
      bindAddress: "::1",
      bindPort: 15432,
      targetHost: "::1",
    };
    expect(rulePath(rule, "ssh", "local")).toContain(
      "ssh [::1]:15432 → local [::1]:5432",
    );
    expect(rulePath({ ...rule, kind: "L" }, "ssh", "local")).toBe(
      "local [::1]:15432 → ssh [::1]:5432",
    );
    expect(rulePath({ ...rule, kind: "D" }, "ssh", "local")).toBe(
      "local SOCKS5 [::1]:15432 → ssh (DNS / TCP)",
    );
    expect(networkChanged(rule, { ...rule, name: "renamed" })).toBe(false);
    expect(networkChanged(rule, { ...rule, autoConnect: true })).toBe(false);
    expect(networkChanged(rule, { ...rule, color: "#7c3aed" })).toBe(false);
    expect(
      networkChanged(rule, { ...rule, icon: { kind: "emoji", value: "🚀" } }),
    ).toBe(false);
    expect(networkChanged(rule, { ...rule, serviceProtocol: "vnc" })).toBe(
      false,
    );
    expect(networkChanged(rule, { ...rule, targetPort: 8080 })).toBe(true);
  });
});
