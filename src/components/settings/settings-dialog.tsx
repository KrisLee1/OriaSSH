import { useId, useRef, useState, type ReactNode } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  ChevronRightIcon,
  FileJsonIcon,
  FolderOutputIcon,
  KeyRoundIcon,
  NetworkIcon,
  SlidersHorizontalIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ParameterTitle } from "@/components/parameter-field";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Switch } from "@/components/ui/switch";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CredentialManager } from "@/features/hosts/credential-manager";
import { HostSourceSettings } from "@/features/hosts/source-settings";
import { SavedCommandsLibrary } from "@/features/terminal/saved-commands";
import { useIsMobile } from "@/hooks/use-media-query";
import * as bridge from "@/lib/bridge";
import type { ConfigExportMode, Snapshot } from "@/types";
import { AppearanceSettings, WindowSettings } from "./appearance-settings";
import { VncClientSetting } from "./vnc-client-setting";
import "./settings-dialog.css";

const categories = [
  { value: "general", label: "settingsGeneral", icon: SlidersHorizontalIcon },
  { value: "connection", label: "settingsConnection", icon: NetworkIcon },
  { value: "credentials", label: "settingsCredentials", icon: KeyRoundIcon },
  { value: "terminal", label: "workspace", icon: SquareTerminalIcon },
  {
    value: "configuration",
    label: "settingsConfiguration",
    icon: FileJsonIcon,
  },
] as const;

export type SettingsCategory = (typeof categories)[number]["value"];

const panelClassName =
  "settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl";

type SettingsActionRunner = (task: () => Promise<unknown>) => Promise<boolean>;
type EditorActivity = "idle" | "editing" | "saving";

export function SettingsDialog({
  data,
  category,
  onCategoryChange,
  busy,
  close,
  onSnapshot,
  runAction,
  onImport,
  onExport,
}: {
  data: Snapshot;
  category: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  busy: boolean;
  close: () => void;
  onSnapshot: (data: Snapshot) => void;
  runAction: SettingsActionRunner;
  onImport: () => void;
  onExport: (mode: ConfigExportMode) => void;
}) {
  const { t } = useTranslation("tunnel");
  const { t: terminalText } = useTranslation("terminal");
  const compact = useIsMobile();
  const orientation = compact ? "horizontal" : "vertical";
  const activeTab = useRef<HTMLButtonElement>(null);
  const [credentialActivity, setCredentialActivity] =
    useState<EditorActivity>("idle");
  const [terminalActivity, setTerminalActivity] =
    useState<EditorActivity>("idle");
  const saving =
    credentialActivity === "saving" || terminalActivity === "saving";
  const editing =
    (category === "credentials" && credentialActivity === "editing") ||
    (category === "terminal" && terminalActivity === "editing");
  const desktopDisabled = busy || !bridge.desktop;

  return (
    <ResponsiveModal
      open
      disablePointerDismissal={saving || editing}
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <ResponsiveModalContent
        className="settings-dialog max-w-[44rem] sm:max-w-[44rem]"
        initialFocus={activeTab}
      >
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t("settings")}</ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <TabsPrimitive.Root
          className="settings-dialog-tabs"
          value={category}
          onValueChange={onCategoryChange}
          orientation={orientation}
          data-orientation={orientation}
        >
          <div className="settings-dialog-navigation">
            <TabsList
              className="settings-dialog-tab-list"
              variant="soft"
              aria-label={t("settings")}
              activateOnFocus
              style={{
                gridTemplateColumns: compact
                  ? `repeat(${categories.length}, minmax(0, 1fr))`
                  : undefined,
              }}
            >
              {categories.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  ref={value === category ? activeTab : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>
                    {value === "terminal"
                      ? terminalText("workspace")
                      : t(label)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <SettingsTab value="general">
            <SettingsSection title={t("appearance")}>
              <AppearanceSettings />
            </SettingsSection>
            <SettingsSection title={t("window")}>
              <WindowSettings />
            </SettingsSection>
            <SettingsSection title={t("trayAndStartup")}>
              <StartupSettings
                data={data}
                disabled={desktopDisabled}
                runAction={runAction}
              />
            </SettingsSection>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={!bridge.desktop}
                onClick={() => void runAction(bridge.quitApp)}
              >
                {t("quit")}
              </Button>
            </div>
          </SettingsTab>
          <SettingsTab value="connection">
            <SettingsSection title={t("discovery")}>
              <HostSourceSettings
                data={data}
                busy={desktopDisabled}
                save={(files, autoSync) =>
                  runAction(() => bridge.setHostSources(files, autoSync))
                }
              />
            </SettingsSection>
            <SettingsSection title="VNC">
              <VncClientSetting
                desktop={bridge.desktop}
                onChooseDefault={() => runAction(bridge.chooseDefaultVnc)}
              />
            </SettingsSection>
          </SettingsTab>
          <SettingsTab value="credentials">
            <CredentialManager
              data={data}
              disabled={desktopDisabled}
              onSnapshot={onSnapshot}
              onActivityChange={setCredentialActivity}
            />
          </SettingsTab>
          <SettingsTab value="terminal">
            <SavedCommandsLibrary onActivityChange={setTerminalActivity} />
          </SettingsTab>
          <SettingsTab value="configuration">
            <div className={panelClassName}>
              <SettingsAction
                icon={ArrowDownToLineIcon}
                title={t("importConfig")}
                disabled={desktopDisabled}
                onClick={onImport}
              />
              <SettingsAction
                icon={FolderOutputIcon}
                title={t("exportWorkspace")}
                disabled={desktopDisabled}
                onClick={() => onExport("migration")}
              />
              <SettingsAction
                icon={ArrowUpFromLineIcon}
                title={t("exportSelected")}
                disabled={desktopDisabled}
                onClick={() => onExport("share")}
              />
            </div>
          </SettingsTab>
        </TabsPrimitive.Root>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function SettingsTab({
  value,
  children,
}: {
  value: SettingsCategory;
  children: ReactNode;
}) {
  return (
    <TabsContent className="settings-dialog-panel" value={value} keepMounted>
      <ResponsiveModalBody className="settings-dialog-content">
        {children}
      </ResponsiveModalBody>
    </TabsContent>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="settings-dialog-section-title">{title}</h3>
      {children}
    </section>
  );
}

function SettingsAction({
  icon: Icon,
  title,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="settings-dialog-action h-auto w-full justify-start gap-3 rounded-none px-3 py-2.5 text-start whitespace-normal"
      aria-label={title}
      aria-haspopup="dialog"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="settings-dialog-action-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">{title}</span>
      <ChevronRightIcon className="text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}

function StartupSettings({
  data,
  disabled,
  runAction,
}: {
  data: Snapshot;
  disabled: boolean;
  runAction: SettingsActionRunner;
}) {
  const { t } = useTranslation("tunnel");
  const trayId = useId();
  const autostartId = useId();
  return (
    <ItemGroup className={panelClassName}>
      <Item className="rounded-none border-0 px-3 py-2.5">
        <ItemContent className="min-w-0">
          <ItemTitle>
            <ParameterTitle
              label={t("closeToTray")}
              description={t("closeToTrayHint")}
              htmlFor={trayId}
            />
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <Switch
            id={trayId}
            checked={data.closeToTray}
            disabled={disabled}
            onCheckedChange={(checked) =>
              void runAction(() => bridge.setCloseToTray(checked))
            }
          />
        </ItemActions>
      </Item>
      <Item className="rounded-none border-0 px-3 py-2.5">
        <ItemContent className="min-w-0">
          <ItemTitle>
            <ParameterTitle
              label={t("autostart")}
              description={t("autostartHint")}
              htmlFor={autostartId}
            />
          </ItemTitle>
          {data.autostartError && (
            <ItemDescription
              className="line-clamp-none text-xs text-destructive"
              role="alert"
            >
              {data.autostartError}
            </ItemDescription>
          )}
        </ItemContent>
        <ItemActions>
          <Switch
            id={autostartId}
            checked={data.autostart}
            disabled={disabled || !data.autostartSupported}
            onCheckedChange={(checked) =>
              void runAction(() => bridge.setAutostart(checked))
            }
          />
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
