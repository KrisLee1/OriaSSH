import { memo, useState } from "react";
import { BaseEdge, Handle, Position, type EdgeProps } from "@xyflow/react";
import { WireLight, canvasWirePath } from "../tunnels/wire-light";
import { useTranslation } from "react-i18next";
import { filePortId } from "./transfer-graph";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TransferDetails } from "./transfer-details";

export function FileTransferPorts({ host = false }: { host?: boolean }) {
  const sides = host
    ? [Position.Left, Position.Right]
    : [Position.Top, Position.Right, Position.Bottom, Position.Left];
  return sides.flatMap((side) =>
    (["source", "target"] as const).map((kind) => (
      <Handle
        key={`${kind}-${side}`}
        id={filePortId(kind, side)}
        type={kind}
        position={side}
        isConnectable={false}
        aria-hidden="true"
        tabIndex={-1}
        className="file-transfer-port"
      />
    )),
  );
}

const filePacket = (
  <g className="file-transfer-packet">
    <path
      className="file-packet-sheet"
      d="M-3.6 -5.8 H.9 L4.5 -2.2 V4.6 Q4.5 5.8 3.3 5.8 H-3.6 Q-4.8 5.8 -4.8 4.6 V-4.6 Q-4.8 -5.8 -3.6 -5.8 Z"
    />
    <path
      className="file-packet-fold"
      d="M.9 -5.8 V-2.8 Q.9 -2.2 1.5 -2.2 H4.5 Z"
    />
  </g>
);

export const FileTransferEdge = memo(function FileTransferEdge(
  props: EdgeProps,
) {
  const { t } = useTranslation("files");
  const [showDetails, setShowDetails] = useState(false);
  const moving = props.data?.moving === true;
  const leaving = props.data?.leaving === true;
  const path = canvasWirePath(props, true);
  return (
    <Tooltip
      onOpenChange={setShowDetails}
      trackCursorAxis="both"
      disableHoverablePopup
    >
      <g
        className="file-route-visual"
        data-leaving={leaving || undefined}
        aria-hidden={leaving || undefined}
      >
        <WireLight
          track={
            <BaseEdge
              id={props.id}
              path={canvasWirePath(props, false)}
              pointerEvents="none"
              className="wire-track"
              markerEnd={props.markerEnd}
              style={props.style}
              interactionWidth={0}
            />
          }
          powered={moving && !leaving}
          traffic={moving}
          path={path}
          color={props.style?.stroke}
          targetColor={String(
            props.data?.targetColor ??
              props.style?.stroke ??
              "var(--oria-color-primary)",
          )}
          sourceSide={props.sourcePosition}
          targetSide={props.targetPosition}
          packet={filePacket}
        />
        {!leaving && (
          <TooltipTrigger
            delay={200}
            closeOnClick={false}
            tabIndex={0}
            aria-label={`${t("transferCount", { count: Number(props.data?.count) || 1 })} · ${t(String(props.data?.phase || "preparing"))}`}
            render={
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                className="files-edge-hit-target"
              />
            }
          />
        )}
      </g>
      {!leaving && showDetails && (
        <TooltipContent className="files-edge-tooltip">
          <TransferDetails
            taskIds={(props.data?.taskIds as string[] | undefined) || []}
          />
        </TooltipContent>
      )}
    </Tooltip>
  );
});
