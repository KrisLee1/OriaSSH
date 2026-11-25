import { describe, expect, it } from "vitest";
import { addedHosts, copyHostDraft, hostFilterStatus } from "./host-collection";
import { groupHosts } from "./host-groups";
import { discoveredHosts } from "./host-discovery";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import type { Host, Runtime } from "@/types";

it("starts a copied SSH host with connection settings and a fresh credential selection", () => {
  const host: Host = {
    ...emptyHost(),
    id: "ssh:original",
    source: "config",
    sourceFile: "/fixture/config:2",
    name: "Original",
    address: "192.0.2.10",
    port: 2244,
    proxyJump: "jump",
    tags: ["fixture"],
    user: "original-user",
    authMethod: "privateKey",
    identityFiles: ["/fixture/identity"],
    primaryLoginLabel: "Source login",
    activeLoginId: "primary:ssh:original",
    defaultLoginId: "primary:ssh:original",
    credentialIds: ["shared"],
    logins: [{ id: "shared", user: "shared-user", authMethod: "agent", identityFiles: [] }],
  };

  const draft = copyHostDraft(host, "Original copy");

  expect(draft).toMatchObject({
    id: "",
    source: "manual",
    name: "Original copy",
    address: host.address,
    port: host.port,
    proxyJump: host.proxyJump,
    tags: host.tags,
    connection: host.connection,
    credentialOnly: true,
    user: "",
    identityFiles: [],
    authMethod: "auto",
  });
  for (const field of ["defaultLoginId", "activeLoginId", "logins", "credentialIds", "primaryLoginLabel", "sourceFile"]) {
    expect(draft).not.toHaveProperty(field);
  }
  expect(host.defaultLoginId).toBe("primary:ssh:original");
});

describe("added host collection", () => {
  const manual = { ...emptyHost(), id: "manual", name: "same" };
  const discovered = {
    ...emptyHost(),
    id: "candidate",
    source: "config",
    name: "same",
    port: 2222,
    tags: ["prod"],
  };
  const used = {
    ...emptyHost(),
    id: "used",
    source: "config",
    proxyJump: "jump",
  };
  const jump = {
    ...emptyHost(),
    id: "jump",
    source: "config",
    proxyJump: "used",
  };
  const data = {
    hosts: [manual, discovered, used, jump],
    rules: [{ ...emptyRule("used"), id: "rule" }],
  };
  it("keeps discovery candidates out of the main collection while retaining used profiles and their routes", () => {
    expect(addedHosts(data).map((host) => host.id)).toEqual([
      "manual",
      "used",
      "jump",
    ]);
    expect(addedHosts({ ...data, addedHostIds: ["candidate"] })).toContain(
      discovered,
    );
    expect(addedHosts(data, ["candidate"])).toContain(discovered);
    expect(discoveredHosts([manual, discovered], "PROD")).toEqual([discovered]);
    expect(discoveredHosts([manual, discovered], "2222")).toEqual([discovered]);
  });
  it("groups and filters only completed or untested host outcomes, preserving individual errors", () => {
    const runtime = (status: string, errorKind?: string) =>
      ({
        ruleId: "host-test:manual",
        status,
        errorKind,
        configurationChanged: false,
      }) as Runtime;
    expect(hostFilterStatus(manual)).toBe("untested");
    expect(hostFilterStatus(manual, runtime("tested"))).toBe("tested");
    expect(hostFilterStatus(manual, runtime("connecting"))).toBeNull();
    expect(
      hostFilterStatus(manual, runtime("needs-attention", "authentication")),
    ).toBe("status-authentication-error");
    expect(hostFilterStatus(manual, runtime("failed", "network"))).toBe(
      "status-network-error",
    );
    const grouped = Object.fromEntries(
      groupHosts([manual, discovered], "status", [runtime("failed", "dns")]),
    );
    expect(grouped["status-dns-error"]).toEqual([manual]);
    expect(grouped.untested).toEqual([discovered]);
    expect(grouped.testing).toBeUndefined();
  });
});
