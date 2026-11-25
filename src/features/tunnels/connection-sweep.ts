export type WireFeatherPatch = {
  aperture: string;
  core: string;
  dots: string;
  transform: string;
};

// A pair of filled ribbons clips the travelling light to the same cubic as the
// hit path. Compute them only on geometry changes, without reading SVG layout.
export function connectionSweep(path: string) {
  const points = (path.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(
    Number,
  );
  if (points.length !== 8 || !points.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = points;
  const samples: {
    x: number;
    y: number;
    nx: number;
    ny: number;
    distance: number;
  }[] = [];
  let length = 0;
  for (let step = 0; step <= 32; step++) {
    const t = step / 32;
    const u = 1 - t;
    const x =
      u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3;
    const y =
      u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3;
    const tx = u * u * (x1 - x0) + 2 * u * t * (x2 - x1) + t * t * (x3 - x2);
    const ty = u * u * (y1 - y0) + 2 * u * t * (y2 - y1) + t * t * (y3 - y2);
    const magnitude = Math.hypot(tx, ty) || 1;
    const previous = samples.at(-1);
    if (previous) length += Math.hypot(x - previous.x, y - previous.y);
    samples.push({
      x,
      y,
      distance: length,
      nx: -ty / magnitude,
      ny: tx / magnitude,
    });
  }
  function ribbon(halfWidth: number) {
    const left = [],
      right = [];
    for (const { x, y, nx, ny } of samples) {
      left.push(
        `${(x + nx * halfWidth).toFixed(2)},${(y + ny * halfWidth).toFixed(2)}`,
      );
      right.push(
        `${(x - nx * halfWidth).toFixed(2)},${(y - ny * halfWidth).toFixed(2)}`,
      );
    }
    return `M${left.join(" ")} ${right.reverse().join(" ")}Z`;
  }
  const chord = Math.max(1, Math.hypot(x3 - x0, y3 - y0));
  const spread = Math.min(12, length * 0.07);
  const dx = ((y0 - y3) / chord) * spread;
  const dy = ((x3 - x0) / chord) * spread;
  function strand(a: number, b: number) {
    return `M${x0},${y0} C${x1 + a * dx},${y1 + a * dy} ${x2 + b * dx},${y2 + b * dy} ${x3},${y3}`;
  }
  const mid = samples[(samples.length - 1) / 2];
  const radius = Math.min(125, Math.max(16, length * 0.32));
  const runout = Math.min(radius * 0.65, length * 0.18);
  const start = samples[0],
    end = samples[samples.length - 1];
  // Continue along the tangents behind the ports. The visible ribbon stays
  // clipped to the original cubic while the end of the light passes through.
  const extend = (runout: number) =>
    `M${x0 - start.ny * runout},${y0 + start.nx * runout} L${x0},${y0} C${x1},${y1} ${x2},${y2} ${x3},${y3} L${x3 + end.ny * runout},${y3 - end.nx * runout}`;
  // Wide clipping strips cover the rim reflections as well as the cable.
  // Precompute the sections once. During propagation only the two moving
  // cross-sections need interpolation, even while the camera is zoomed.
  function powerSections() {
    const margin = Math.max(12, length / 18);
    const cross = (
      x: number,
      y: number,
      nx: number,
      ny: number,
      distance: number,
    ) => ({
      x,
      y,
      nx,
      ny,
      distance,
      left: `${(x + nx * 48).toFixed(1)},${(y + ny * 48).toFixed(1)}`,
      right: `${(x - nx * 48).toFixed(1)},${(y - ny * 48).toFixed(1)}`,
    });
    const sections = [
      cross(
        x0 - start.ny * margin,
        y0 + start.nx * margin,
        start.nx,
        start.ny,
        -margin,
      ),
      ...samples.map((p) => cross(p.x, p.y, p.nx, p.ny, p.distance)),
      cross(
        x3 + end.ny * margin,
        y3 - end.nx * margin,
        end.nx,
        end.ny,
        length + margin,
      ),
    ];
    function at(phase: number) {
      const distance = phase * (length + 2 * margin) - margin;
      let i = 1;
      while (i < sections.length - 1 && sections[i].distance < distance) i++;
      const a = sections[i - 1],
        b = sections[i];
      const t = (distance - a.distance) / (b.distance - a.distance || 1);
      return cross(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.nx + (b.nx - a.nx) * t,
        a.ny + (b.ny - a.ny) * t,
        distance,
      );
    }
    function strip(from: number, to: number) {
      if (to <= from) return "";
      const a = at(from),
        b = at(to);
      const middle = sections.filter(
        (p) => p.distance > a.distance && p.distance < b.distance,
      );
      return `M${a.left} ${middle.map((p) => p.left).join(" ")} ${b.left} ${b.right} ${middle
        .reverse()
        .map((p) => p.right)
        .join(" ")} ${a.right}Z`;
    }
    const routeLength = length + 2 * margin;
    const head = Math.min(68 / routeLength, 0.21);
    const tail = Math.min(104 / routeLength, 0.33);
    // Allow the whole feather to enter and leave beyond the ports, including
    // on short links. Every in-flight change advances at the same speed.
    function center(progress: number) {
      return progress * (1 + tail) - tail / 2;
    }
    function feather(
      position: number,
      powered: boolean,
      previous: number,
      next: number,
    ): { from: number; to: number; patch: WireFeatherPatch | null } {
      const half = (powered ? head : tail) / 2;
      const start = Math.max(previous, position - half);
      const end = Math.min(next, position + half);
      const clip = (t: number) => Math.min(1, Math.max(0, t));
      const from = clip(start),
        to = clip(end);
      if (to <= from) return { from, to, patch: null };

      const full = at(powered ? start : end);
      const dim = at(powered ? end : start);
      const apertureLeft: string[] = [],
        apertureRight: string[] = [];
      const coreLeft: string[] = [],
        coreRight: string[] = [];
      for (let step = 0; step <= 10; step++) {
        const t = from + ((to - from) * step) / 10;
        const strength = powered
          ? (end - t) / (end - start)
          : (t - start) / (end - start);
        const p = at(t);
        const edge = (width: number) =>
          `${(p.x + p.nx * width).toFixed(2)},${(p.y + p.ny * width).toFixed(2)}`;
        // Reduce the real sheath, particles and rim to a subpixel filament.
        // A translucent ribbon carries that filament into the existing dashes.
        const aperture = 39.5 * strength ** 19 + 8.5 * strength ** 2.8;
        const core =
          (powered ? 2.15 : 1.8) * strength ** (powered ? 0.7 : 1.35);
        apertureLeft.push(edge(aperture));
        apertureRight.push(edge(-aperture));
        coreLeft.push(edge(core));
        coreRight.push(edge(-core));
      }
      const polygon = (left: string[], right: string[]) =>
        `M${left.join(" ")} ${right.reverse().join(" ")}Z`;
      const dx = dim.x - full.x,
        dy = dim.y - full.y;
      return {
        from,
        to,
        patch: {
          aperture: polygon(apertureLeft, apertureRight),
          core: polygon(coreLeft, coreRight),
          dots: strip(from, to),
          transform: `matrix(${dx} ${dy} ${-dy} ${dx} ${full.x} ${full.y})`,
        },
      };
    }
    return { at, strip, center, feather };
  }
  return {
    length,
    start,
    end,
    portPhase: runout / Math.max(1, length + 2 * runout),
    radius,
    travel: extend(runout),
    powerSections,
    direction: `matrix(${mid.ny} ${-mid.nx} ${mid.nx} ${mid.ny} ${mid.x} ${mid.y})`,
    core: ribbon(1.65),
    halo: ribbon(4),
    upper: strand(1, -0.45),
    lower: strand(-0.85, 0.7),
  };
}
