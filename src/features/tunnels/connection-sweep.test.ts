import { describe, expect, it } from "vitest";
import { getBezierPath, Position } from "@xyflow/react";
import { connectionSweep } from "./connection-sweep";

describe("light travelling along a connection", () => {
  it("follows the bend, including its actual midpoint and both ports", () => {
    const wire = connectionSweep("M0,0 C0,100 100,100 100,0")!;
    // At the apex the tangent is horizontal, so the luminous core straddles y=75.
    expect(wire.core).toContain("50.00,76.65");
    expect(wire.core).toContain("50.00,73.35");
    expect(wire.halo).toContain("50.00,79.00");
    expect(wire.length).toBeCloseTo(200, 0);
    for (const strand of [wire.upper, wire.lower]) {
      expect(strand).toMatch(/^M0,0 C.* 100,0$/);
    }
    expect(wire.upper).not.toBe(wire.lower);
  });

  it("extends the light trajectory behind both ports without extending the visible wire", () => {
    const path = "M0,0 C25,0 75,0 100,0";
    const wire = connectionSweep(path)!;
    expect(wire.travel).toBe("M-18,0 L0,0 C25,0 75,0 100,0 L118,0");
    expect(wire.core).toMatch(/^M0.00,1.65 /);
    expect(wire.core).toContain("100.00,1.65 100.00,-1.65");
  });

  it("handles reversed React Flow paths and overlapping endpoints", () => {
    const [curve] = getBezierPath({
      sourceX: 400,
      sourceY: 200,
      sourcePosition: Position.Left,
      targetX: -100,
      targetY: 20,
      targetPosition: Position.Right,
    });
    expect(connectionSweep(curve)?.upper).toMatch(/^M400,200 C.* -100,20$/);
    const point = connectionSweep("M0,0 C0,0 0,0 0,0")!;
    expect(point.length).toBe(0);
    expect(point.upper).not.toMatch(/NaN|Infinity/);
    expect(connectionSweep("")).toBeNull();
  });

  it("partitions the bend into adjacent lit and dashed intervals in source order", () => {
    const wire = connectionSweep("M100,0 C100,100 0,100 0,0")!;
    const sections = wire.powerSections();
    const near = sections.at(0.25),
      far = sections.at(0.65);
    expect(near.x).toBeGreaterThan(far.x);
    expect(sections.at(0.5).y).toBeCloseTo(75);
    expect(sections.strip(0, 0.25)).toContain(near.left + " " + near.right);
    expect(sections.strip(0.25, 0.65)).toMatch(/^M/);
    expect(sections.strip(0.25, 0.65)).toContain(far.left + " " + far.right);
    expect(sections.strip(0.65, 1)).toContain("M" + far.left);
    expect(sections.strip(1, 1)).toBe("");
  });

  it.each(["M0,0 C100,0 200,0 300,0", "M0,0 C1,0 3,0 4,0"])(
    "tapers the head and the longer tail in opposite directions, including a restart on %s",
    (path) => {
      const s = connectionSweep(path)!.powerSections();
      const head = s.feather(0.5, true, -Infinity, Infinity);
      const tail = s.feather(0.5, false, -Infinity, Infinity);
      expect(tail.to - tail.from).toBeGreaterThan(head.to - head.from);
      // On a horizontal wire the upper boundary gives the local half-width.
      for (const [band, grows] of [
        [head, false],
        [tail, true],
      ] as const) {
        const points = band.patch!.core.slice(1, -1).split(" ");
        const widths = points
          .slice(0, points.length / 2)
          .map((p) => Number(p.split(",")[1]));
        expect(widths).toEqual(
          [...widths].sort((a, b) => (grows ? a - b : b - a)),
        );
        expect(Math.min(...widths)).toBe(0);
      }
      const midpoint = 0.47;
      expect(s.feather(0.45, true, -Infinity, midpoint).to).toBe(midpoint);
      expect(s.feather(0.49, false, midpoint, Infinity).from).toBe(midpoint);
      expect(
        s.feather(s.center(0), false, -Infinity, Infinity).patch,
      ).toBeNull();
      expect(
        s.feather(s.center(1), false, -Infinity, Infinity).patch,
      ).toBeNull();
    },
  );
});
