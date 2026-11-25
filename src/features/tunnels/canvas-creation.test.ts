import { describe, expect, it } from "vitest";
import { availableHostPosition, hostForwardDraft, localForwardServiceIds, serviceLocalForward } from "./canvas-creation";
import { emptyHost, emptyRule } from "./rule-model";
import { newService } from "../commands/command-model";

describe("creating forwards on the canvas", () => {
  const service = {
    ...newService("host"),
    id: "api",
    name: "API",
    color: "#6b9ee8",
    icon: { kind: "builtin", value: "server" } as const,
    directProtocol: "https" as const,
    port: 13081,
    ruleIds: ["saved", "shared"],
  };
  const rules = [
    { ...emptyRule("host"), id: "saved", targetHost: "internal.example", targetPort: 9999 },
    { ...emptyRule("other"), id: "shared", targetHost: "different.example" },
  ];

  it("prefills a stopped L rule with the service appearance, port and known target on this host", () => {
    expect(serviceLocalForward("host", service, rules)).toMatchObject({
      hostId: "host", kind: "L", name: "API", bindAddress: "127.0.0.1",
      targetPort: 13081, bindPort: 0, targetHost: "internal.example",
      autoConnect: false, color: service.color, icon: service.icon, serviceProtocol: "https",
    });
  });

  it("uses the host loopback when no single saved target is available", () => {
    expect(serviceLocalForward("host", service, [])?.targetHost).toBe("127.0.0.1");
    expect(serviceLocalForward("host", service, [
      rules[0], { ...rules[1], hostId: "host" },
    ])?.targetHost).toBe("127.0.0.1");
  });

  it("does not create a rule for services without a valid port", () => {
    for (const port of [undefined, null, 0, -1, 1.5, 65536]) {
      expect(serviceLocalForward("host", { ...service, port }, rules)).toBeUndefined();
    }
  });

  it("prefills a host rule of the requested kind", () => {
    expect(hostForwardDraft("host", "R")).toMatchObject({
      hostId: "host", kind: "R", targetPort: 0, bindPort: 0,
    });
    expect(hostForwardDraft("host", "D")).toMatchObject({
      hostId: "host", kind: "D", name: "SOCKS5", targetPort: 0, bindPort: 0,
    });
  });

  it("groups explicit and uniquely matched local forwards under their service", () => {
    const host = { ...emptyHost(), id: "host", address: "server.example" };
    const local = { ...emptyRule(host.id), id: "legacy", targetPort: 13081 };
    const remote = { ...local, id: "remote", kind: "R" as const };
    const external = { ...local, id: "external", targetHost: "upstream.example" };
    expect([...localForwardServiceIds(host, [rules[0], local, remote, external], [service])])
      .toEqual([["saved", "api"], ["legacy", "api"]]);
    expect(localForwardServiceIds(host, [local], [service, { ...service, id: "duplicate", ruleIds: [] }]).size)
      .toBe(0);
  });
});

describe("adding a host card", () => {
  it("uses the chosen free point and avoids overlapping measured hosts and the computer", () => {
    const size = { width: 380, height: 180 };
    const occupied = [
      { x: 0, y: 0, width: 200, height: 164 },
      { x: 232, y: 0, width: 440, height: 600 },
    ];
    expect(availableHostPosition({ x: 710, y: 10 }, size, occupied)).toEqual({
      x: 710,
      y: 10,
    });
    for (let i = 0; i < 4; i++) {
      const point = availableHostPosition({ x: 22, y: 12 }, size, occupied);
      expect(
        occupied.every(
          (r) =>
            point.x >= r.x + r.width + 32 ||
            point.x + size.width + 32 <= r.x ||
            point.y >= r.y + r.height + 32 ||
            point.y + size.height + 32 <= r.y,
        ),
      ).toBe(true);
      occupied.push({ ...point, ...size });
    }
  });
});
