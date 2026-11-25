import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { canvasWirePath, WireLight } from "./wire-light";

export const ConnectionEdge = memo(function ConnectionEdge(props: EdgeProps) {
  const transferring = props.data?.state === "transferring";
  const listening = transferring || props.data?.state === "connected";
  const path = canvasWirePath(props, true);
  return (
    <>
      <WireLight
        track={
          <BaseEdge
            id={props.id}
            data-forward-edge={props.id}
            className="wire-track"
            path={canvasWirePath(props, false)}
            markerEnd={props.markerEnd}
            style={{
              ...props.style,
              strokeWidth: "var(--endpoint-stroke-width, 1.5)",
            }}
            interactionWidth={0}
          />
        }
        powered={listening}
        traffic={transferring}
        path={path}
        color={String(props.data?.lightColor || props.style?.stroke)}
        sourceSide={props.sourcePosition}
        targetSide={props.targetPosition}
      />
      <path
        className="react-flow__edge-interaction"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        pointerEvents="stroke"
      />
    </>
  );
});
