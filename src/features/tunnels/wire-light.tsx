import {
  getBezierPath,
  type Position,
  type EdgeProps,
  type BaseEdgeProps,
} from "@xyflow/react";
import {
  memo,
  useId,
  useRef,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
  type ReactElement,
} from "react";
import { WirePower } from "./wire-power";
import { canvasPortCenterOffset } from "./canvas-state";
import type { connectionSweep } from "./connection-sweep";

export function canvasWirePath(props: EdgeProps, listening: boolean) {
  const source = canvasPortCenterOffset[props.sourcePosition];
  const target = canvasPortCenterOffset[props.targetPosition];
  const [path] = getBezierPath(
    listening
      ? {
          ...props,
          sourceX: props.sourceX + source.x,
          sourceY: props.sourceY + source.y,
          targetX: props.targetX + target.x,
          targetY: props.targetY + target.y,
        }
      : props,
  );
  return path;
}

function FlowMotion({
  path,
  duration,
  phase,
  keyTimes,
  rotate = "auto",
}: {
  path: string;
  duration: number;
  phase: number;
  keyTimes: string;
  rotate?: "auto" | "0";
}) {
  const begin = `${-duration * phase}s`;
  const dur = `${duration}s`;
  return (
    <>
      <animateMotion
        path={path}
        dur={dur}
        begin={begin}
        rotate={rotate}
        repeatCount="indefinite"
      />
      <animate
        attributeName="opacity"
        values="0;1;1;0"
        keyTimes={keyTimes}
        calcMode="spline"
        keySplines=".4 0 .6 1;0 0 1 1;.4 0 .6 1"
        dur={dur}
        begin={begin}
        repeatCount="indefinite"
      />
    </>
  );
}

function TravellingLight({
  path,
  duration,
  clip,
  fill,
  radius,
}: {
  path: string;
  duration: number;
  clip: string;
  fill: string;
  radius: number;
}) {
  return (
    <g clipPath={clip}>
      {[0.25, 0.75].map((phase) => (
        <g key={phase}>
          <FlowMotion
            path={path}
            duration={duration}
            phase={phase}
            keyTimes="0;.22;.74;1"
          />
          <ellipse
            cx={-radius * 0.3}
            rx={radius}
            ry={radius * 0.65}
            fill={fill}
          />
        </g>
      ))}
    </g>
  );
}

const outwardAngle = { right: 0, bottom: 90, left: 180, top: -90 };

function RimLight({
  x,
  y,
  side,
  color,
  duration,
  peak,
}: {
  x: number;
  y: number;
  side: Position;
  color?: string;
  duration: number;
  peak: number;
}) {
  const id = useId();
  const period = duration / 2;
  // Each crest is half a period apart. Match its crossing of this end on the
  // extended path. Only the reflected light changes, the contact stays lit.
  const begin = duration * (peak - 1.25);
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${outwardAngle[side]})`}
      color={color}
    >
      <defs>
        <radialGradient id={id}>
          <stop stopColor="var(--wire-hot)" />
          <stop offset=".45" stopColor="currentColor" stopOpacity=".52" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="wire-rim-reflection" fill={`url(#${id})`} opacity=".46">
        {duration > 0 && (
          <animate
            attributeName="opacity"
            values=".94;.18;.94"
            keyTimes="0;.5;1"
            calcMode="spline"
            keySplines=".36 0 .55 1;.45 0 .64 1"
            begin={`${begin}s`}
            dur={`${period}s`}
            repeatCount="indefinite"
          />
        )}
        <ellipse cx=".5" rx="3.8" ry="33" />
        <ellipse cx="1" rx="7" ry="11" />
      </g>
      <path
        d="M0 -12 Q.5 -1.4 6 -1 L10 -.65 L10 .65 L6 1 Q.5 1.4 0 12 Z"
        fill={`url(#${id})`}
      />
    </g>
  );
}

type WireLightProps = {
  path: string;
  color?: string;
  targetColor?: string;
  sourceSide: Position;
  targetSide: Position;
  packet?: ReactNode;
};

export const WireLight = memo(function WireLight({
  powered,
  traffic,
  track,
  ...optics
}: WireLightProps & {
  powered: boolean;
  traffic: boolean;
  track: ReactElement<BaseEdgeProps>;
}) {
  const lastTraffic = useRef(traffic);
  useLayoutEffect(() => {
    if (powered) lastTraffic.current = traffic;
  }, [powered, traffic]);
  return (
    <WirePower
      path={optics.path}
      powered={powered}
      track={track}
      color={optics.color}
      targetColor={optics.targetColor}
    >
      {(wire, reducedMotion) => (
        <g
          className={
            !powered && lastTraffic.current
              ? "wire-draining-traffic"
              : undefined
          }
        >
          <WireOptics {...optics} wire={wire} reducedMotion={reducedMotion} />
        </g>
      )}
    </WirePower>
  );
});

const WireOptics = memo(function WireOptics({
  path,
  color,
  targetColor = color,
  sourceSide,
  targetSide,
  packet,
  wire,
  reducedMotion,
}: WireLightProps & {
  wire: NonNullable<ReturnType<typeof connectionSweep>>;
  reducedMotion: boolean;
}) {
  const id = useId();
  const duration = Math.min(4, Math.max(1.2, wire.length / 165));
  const blend = color !== targetColor;
  const style = blend
    ? ({
        "--wire-color": `url(#${id}-route)`,
        "--wire-filament": `url(#${id}-filament)`,
      } as CSSProperties)
    : undefined;
  const light = `url(#${id}-light)`;
  return (
    <g
      className="connection-glow"
      color={color}
      style={style}
      fill="none"
      aria-hidden="true"
    >
      {blend && (
        <defs>
          {["route", "filament"].map((kind) => (
            <linearGradient
              key={kind}
              id={`${id}-${kind}`}
              gradientUnits="userSpaceOnUse"
              x1={wire.start.x}
              y1={wire.start.y}
              x2={wire.end.x}
              y2={wire.end.y}
            >
              {[color, targetColor].map((hue, index) => (
                <stop
                  key={index}
                  offset={index}
                  stopColor={
                    kind === "route"
                      ? hue
                      : `color-mix(in oklab, ${hue} 42%, white)`
                  }
                />
              ))}
            </linearGradient>
          ))}
        </defs>
      )}
      <g className="connection-haze" stroke="var(--wire-color, currentColor)">
        <path className="connection-haze-outer" d={path} />
        <path className="connection-haze-middle" d={path} />
        <path className="connection-haze-inner" d={path} />
      </g>
      <path className="connection-sheath" d={path} />
      <g className="connection-strands">
        <path d={wire.upper} />
        <path d={wire.lower} />
      </g>
      <path className="connection-filament" d={path} />
      {reducedMotion && (
        <path
          d="m-3,-2.5 3,2.5 -3,2.5"
          transform={wire.direction}
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
      {!reducedMotion && (
        <g className="connection-current">
          <defs>
            <radialGradient id={`${id}-light`} cx=".5" cy=".5" r=".5" fx=".72">
              <stop stopColor="white" />
              <stop
                offset=".22"
                stopColor={blend ? "white" : "var(--wire-hot)"}
              />
              <stop
                offset=".64"
                stopColor={blend ? "white" : "currentColor"}
                stopOpacity={blend ? ".46" : ".85"}
              />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
            <clipPath id={`${id}-core`}>
              <path d={wire.core} />
            </clipPath>
            <clipPath id={`${id}-halo`}>
              <path d={wire.halo} />
            </clipPath>
          </defs>
          <g className="connection-wave-halo">
            <TravellingLight
              path={wire.travel}
              duration={duration}
              clip={`url(#${id}-halo)`}
              fill={light}
              radius={wire.radius}
            />
          </g>
          <TravellingLight
            path={wire.travel}
            duration={duration}
            clip={`url(#${id}-core)`}
            fill={light}
            radius={wire.radius}
          />
          <g className="connection-particles">
            {(packet ? [path, path] : [wire.upper, path, wire.lower]).map(
              (track, index, tracks) => (
                <g key={index}>
                  <FlowMotion
                    path={track}
                    phase={index / tracks.length}
                    duration={duration * 0.7}
                    rotate={packet ? "0" : "auto"}
                    keyTimes="0;.09;.88;1"
                  />
                  {packet && blend && (
                    <animate
                      attributeName="color"
                      from={color}
                      to={targetColor}
                      dur={`${duration * 0.7}s`}
                      begin={`${(-duration * 0.7 * index) / tracks.length}s`}
                      repeatCount="indefinite"
                    />
                  )}
                  {packet ?? (
                    <>
                      <ellipse cx="-3" rx="8" ry="3.2" fill={light} />
                      <circle r="1.65" fill="white" />
                    </>
                  )}
                </g>
              ),
            )}
          </g>
        </g>
      )}
      <RimLight
        x={wire.start.x}
        y={wire.start.y}
        side={sourceSide}
        color={color}
        duration={reducedMotion ? 0 : duration}
        peak={wire.portPhase}
      />
      <RimLight
        x={wire.end.x}
        y={wire.end.y}
        side={targetSide}
        color={targetColor}
        duration={reducedMotion ? 0 : duration}
        peak={1 - wire.portPhase}
      />
    </g>
  );
});
