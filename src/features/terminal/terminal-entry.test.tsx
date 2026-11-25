import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "@/i18n";
import { emptyHost } from "@/features/tunnels/rule-model";
import type { Snapshot } from "@/types";
import * as bridge from "@/lib/bridge";
import { TerminalTargets } from "./terminal-targets";
import {
  OpenTerminalButton,
  TerminalWorkspaceProvider,
  useTerminalWorkspace,
} from "./terminal-workspace";

vi.mock("@/lib/bridge", () => ({
  desktop: true,
  // Inspect the submitted intent and reject before any connection or session is created.
  openTerminal: vi.fn().mockRejectedValue("hostBlocked"),
}));

describe("host terminal entry", () => {
  it("submits the chosen host directly without a host-selection confirmation", async () => {
    const host = {
      ...emptyHost(),
      id: "chosen-host",
      name: "Chosen host",
      address: "fixture.invalid",
      user: "original",
      defaultLoginId: "alternate",
      logins: [{ id: "alternate", label: "", user: "selected user", authMethod: "password" as const, identityFiles: [] }],
    };
    let workspace: ReturnType<typeof useTerminalWorkspace> = null;
    function Entry() {
      workspace = useTerminalWorkspace();
      return <>
        <OpenTerminalButton hostId={host.id} />
        <OpenTerminalButton workspace />
        <TerminalTargets hosts={[host]} busy={false} choose={() => {}} />
      </>;
    }
    const html = renderToStaticMarkup(
      <TerminalWorkspaceProvider
        data={{ hosts: [host], rules: [], services: [] } as unknown as Snapshot}
      >
        <Entry />
      </TerminalWorkspaceProvider>,
    );
    expect(html.match(/lucide-square-terminal/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/\blucide-terminal(?=["\s])/);
    expect(html).toContain("selected user@fixture.invalid:22");
    expect(html).not.toContain("original@fixture.invalid");
    expect(bridge.openTerminal).not.toHaveBeenCalled();
    expect(workspace).not.toBeNull();
    await workspace!.openHost(host.id);
    expect(bridge.openTerminal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        hostId: host.id,
        loginId: "alternate",
        noLocalEnvironment: true,
        secrets: {},
        rememberHostIds: [],
      }),
    );
  });
});
