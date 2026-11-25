import { describe, it, expect } from "vitest";
import {
  serviceTarget,
  resolveTrayServiceRequest,
  serviceCommandOutput,
  serviceLoginId,
  serviceRuntimeState,
} from "./service-target";
import { newService, newAction } from "./command-model";
import { emptyHost, emptyRule } from "@/features/tunnels/rule-model";
import { directProtocol } from "./direct-protocol";
import type { CommandRun, ServiceObservation } from "@/types";

it("uses the current host credential unless the service or the execution selected one", () => {
  const host = { ...emptyHost(), id: "host", defaultLoginId: "alice" };
  const service = newService(host.id);
  expect(serviceLoginId(service, host)).toBe("alice");
  const switched = { ...host, defaultLoginId: "deploy" };
  expect(serviceLoginId(service, switched)).toBe("deploy");
  const configured = { ...service, loginByHost: { [host.id]: "alice" } };
  expect(serviceLoginId(configured, switched)).toBe("alice");
  expect(serviceLoginId(configured, switched, "primary:host")).toBe("primary:host");
  expect(serviceLoginId(service, { ...host, defaultLoginId: null })).toBe("primary:host");
});

it("reopens the active run on the card's host before any finished or automatic status output", () => {
  const service = { ...newService("first"), id: "service", revision: "v2" };
  const last = { id: "last", serviceId: service.id, serviceRevision: service.revision, hostId: "first", actionId: "start", finishedAt: 5 } as CommandRun;
  const active = { ...last, id: "active", finishedAt: null };
  const elsewhere = { ...active, hostId: "second" };
  const stale = { ...active, serviceRevision: "v1" };
  const status = { ...last, actionId: "$status" };
  expect(serviceCommandOutput([elsewhere, stale, status, last, active], service, "first")).toBe(active);
  expect(serviceCommandOutput([elsewhere, stale, status, last], service, "first")).toBe(last);
  expect(serviceCommandOutput([elsewhere, stale, status], service, "first")).toBeUndefined();
});

it("only shows an active foreground launch or a fresh observation for this login", () => {
  const start = newAction("start", "start");
  const logs = newAction("logs", "logs");
  const service = { ...newService("host"), id: "service", revision: "v2", actions: [start, logs] };
  const run = { hostId: "host", serviceId: service.id, serviceRevision: service.revision,
    actionId: start.id, phase: "foreground-running", finishedAt: null } as CommandRun;
  const fact = { hostId: run.hostId, serviceId: service.id, serviceRevision: service.revision,
    loginId: "alice", status: { value: "running", expired: false } } as ServiceObservation;
  const state = (runs: CommandRun[], facts: ServiceObservation[] = []) =>
    serviceRuntimeState(service, "host", "alice", runs, facts, false);
  expect(state([run])).toBe("foreground-running");
  for (const change of [{ actionId: logs.id }, { finishedAt: 10 }, { phase: "connecting" },
    { serviceRevision: "v1" }, { hostId: "another" }]) expect(state([{ ...run, ...change }])).toBe("unknown");
  expect(state([], [fact])).toBe("running");
  expect(state([], [{ ...fact, loginId: "bob" }])).toBe("unknown");
  expect(state([], [{ ...fact, status: { ...fact.status, expired: true } }])).toBe("unknown");
  expect(state([], [{ ...fact, status: { ...fact.status, value: "stopped" } }])).toBe("stopped");
});

describe("direct service launch", () => {
  it.each([
    ["VNC · TigerVNC", "desktop", 15901, "vnc"],
    ["DSH", "inference", 3080, "http"],
    ["Gitea", "development", 3000, "http"],
    ["Website", "web", 8443, "https"],
    ["PostgreSQL", "databases", 25432, "postgresql"],
    ["MariaDB", "databases", 13306, "mysql"],
    ["MongoDB", "databases", 37017, "mongodb"],
    ["Valkey", "caches", 6380, "redis"],
    ["Elasticsearch", "databases", 9200, "http"],
    ["Custom database", "databases", 5656, null],
  ] as const)("resolves %s without a forward", (name, category, port, protocol) => {
    expect(directProtocol({ ...newService("host"), name, category, port }, [], "host")).toBe(protocol);
  });
  it("uses the selected host's linked protocol and honors an explicit override", () => {
    const rule = { ...emptyRule("other"), id: "forward", serviceProtocol: "vnc" as const };
    const service = { ...newService("host"), ruleIds: [rule.id], port: 3000 };
    expect(directProtocol(service, [rule], "host")).toBe("http");
    expect(directProtocol(service, [rule], "other")).toBe("vnc");
    expect(directProtocol({ ...service, directProtocol: "https" }, [rule], "other")).toBe("https");
  });
});
const data = {
  rules: [
    { ...emptyRule("host-a"), id: "a" },
    { ...emptyRule("host-b"), id: "b" },
    { ...emptyRule("unrelated"), id: "other" },
  ],
};
describe("forward-provided service execution target", () => {
  it("resolves tray operations only from the current revision and exact saved forward/action", () => {
    const service = {
      ...newService("ignored-host"),
      id: "service",
      revision: "v1",
      ruleIds: ["a", "b"],
      actions: [newAction("start", "启动")],
    };
    const snapshot = { ...data, services: [service] };
    const request = {
      serviceId: service.id,
      revision: service.revision,
      ruleId: "b",
      actionId: service.actions[0].id,
      stopTerminal: false,
      command: "untrusted command",
    };
    expect(resolveTrayServiceRequest(snapshot, request)).toEqual({
      service,
      action: service.actions[0],
      ruleId: "b",
    });
    for (const invalid of [
      { ...request, revision: "old" },
      { ...request, ruleId: "other" },
      { ...request, serviceId: "missing" },
      { ...request, actionId: "removed" },
      { ...request, stopTerminal: true },
    ])
      expect(resolveTrayServiceRequest(snapshot, invalid)).toBeUndefined();
    service.actions[0].mode = "terminal";
    expect(
      resolveTrayServiceRequest(snapshot, { ...request, stopTerminal: true })
        ?.action,
    ).toBe(service.actions[0]);
    service.actions[0].kind = "logs";
    expect(
      resolveTrayServiceRequest(snapshot, { ...request, stopTerminal: true }),
    ).toBeUndefined();
  });
  it("takes the host from the selected forward, ignoring the former independent service host", () => {
    const template = {
      ...newService(""),
      hostIds: ["host-a", "host-b"],
      executionHostId: "legacy-host",
      ruleIds: ["a", "b"],
    };
    expect(serviceTarget(template, data, "a")?.hostId).toBe("host-a");
    expect(serviceTarget(template, data, "b")?.hostId).toBe("host-b");
    expect(serviceTarget(template, data, "other")).toBeUndefined();
    expect(serviceTarget(template, data)).toBeUndefined();
  });
  it("executes directly only on an explicitly associated host without inventing a forward", () => {
    const service = { ...newService("host-a"), id: "service" };
    expect(serviceTarget(service, { rules: [] }, "host:host-a")).toEqual({
      id: "host:host-a",
      hostId: "host-a",
    });
    expect(serviceTarget(service, { rules: [] }, "host:other")).toBeUndefined();
    expect(serviceTarget(service, { rules: [] })).toEqual({
      id: "host:host-a",
      hostId: "host-a",
    });
  });
  it("permits a single reference but never invents a host for an unbound template", () => {
    expect(
      serviceTarget(
        { ...newService(""), hostIds: undefined, ruleIds: ["a"] },
        data,
      )?.hostId,
    ).toBe("host-a");
    expect(
      serviceTarget(
        { ...newService(""), executionHostId: "legacy-host" },
        data,
      ),
    ).toBeUndefined();
    expect(
      serviceTarget({ ...newService(""), ruleIds: ["deleted"] }, data),
    ).toBeUndefined();
  });
});
