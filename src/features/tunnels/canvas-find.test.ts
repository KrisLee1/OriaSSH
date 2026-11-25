import { expect, it } from "vitest";
import { newService } from "../commands/command-model";
import { canvasMatches, canvasRows } from "./canvas-find";
import { emptyHost, emptyRule } from "./rule-model";

it("returns canvas matches only when the query contains a search term", () => {
  const host = { ...emptyHost(), id: "lab", name: "Lab", address: "lab.example" };
  const service = { ...newService(host.id), id: "api", name: "API", port: 13085 };
  const rule = { ...emptyRule(host.id), id: "forward", name: "Proxy", targetPort: 13085 };
  const data = { hosts: [host], addedHostIds: [host.id], services: [service], rules: [rule], runtimes: [] };

  const rows = canvasRows(data);
  expect(canvasMatches(rows, "")).toEqual([]);
  expect(canvasMatches(rows, " \t ")).toEqual([]);
  expect(canvasMatches(rows, "unknown")).toEqual([]);
  expect(canvasMatches(rows, " aPi ")).toMatchObject([{ serviceId: service.id }]);
  expect(canvasMatches(rows, "13085")).toMatchObject([
    { serviceId: service.id },
    { ruleId: rule.id },
  ]);
});
