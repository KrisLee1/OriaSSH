import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ParameterTitle } from "@/components/parameter-field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { FilePathsEditor } from "./file-paths-editor";
import { pickSshConfigFile } from "@/lib/bridge";
import type { Snapshot } from "@/types";

export function HostSourceSettings({
  data,
  busy,
  save,
}: {
  data: Snapshot;
  busy: boolean;
  save: (files: string[], autoSync: boolean) => Promise<boolean>;
}) {
  const { t } = useTranslation("tunnel");
  const syncId = useId();
  const syncRef = useRef<HTMLSpanElement>(null);
  const savedFiles = data.sourceFiles ?? [];
  const savedAutoSync = data.autoSyncHosts ?? true;
  const [draft, setDraft] = useState<{ files: string[]; autoSync: boolean }>();
  const { files, autoSync } = draft ?? {
    files: savedFiles,
    autoSync: savedAutoSync,
  };
  const effectiveFiles = files.map((path) => path.trim()).filter(Boolean);
  const changed =
    draft !== undefined &&
    (autoSync !== savedAutoSync ||
      effectiveFiles.length !== savedFiles.length ||
      effectiveFiles.some((path, index) => path !== savedFiles[index]));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed || busy) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const restoreFocus = document.activeElement === submitter;
        void save(effectiveFiles, autoSync).then((ok) => {
          if (restoreFocus) {
            requestAnimationFrame(() => {
              if (document.activeElement !== document.body) return;
              (ok ? syncRef.current : submitter)?.focus({
                preventScroll: true,
              });
            });
          }
          if (!ok) return;
          setDraft((current) => (current === draft ? undefined : current));
          toast.add({
            title: t("sourcesSaved"),
            type: "success",
            timeout: 4000,
          });
        });
      }}
    >
      <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
        <Item className="flex-nowrap rounded-none border-0 px-3 py-2.5">
          <ItemContent className="min-w-0 gap-0.5">
            <ItemTitle>
              <ParameterTitle
                label={t("autoSyncHosts")}
                description={t("autoSyncHint")}
                htmlFor={syncId}
              />
            </ItemTitle>
            <ItemDescription
              id={`${syncId}-summary`}
              className="line-clamp-none text-xs"
            >
              {t("autoSyncSummary")}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              ref={syncRef}
              id={syncId}
              aria-describedby={`${syncId}-summary`}
              checked={autoSync}
              disabled={busy}
              onCheckedChange={(autoSync) => setDraft({ files, autoSync })}
            />
          </ItemActions>
        </Item>
        <Item className="rounded-none border-0 px-3 py-2.5">
          <FilePathsEditor
            className="ssh-source-files grid w-full min-w-0 gap-1.5"
            label={t("additionalSources")}
            description={t("sourcesHint")}
            value={files}
            disabled={busy}
            pickFile={pickSshConfigFile}
            addLabel={t("addSource")}
            chooseLabel={(count) => t("chooseSource", { count })}
            removeLabel={(count) => t("removeSource", { count })}
            placeholder={t("sourcePathPlaceholder")}
            formatError={(cause) =>
              String(cause).includes("pick_ssh_config_file")
                ? t("sourcePickerUpdateRequired")
                : String(cause)
            }
            onChange={(files) => setDraft({ files, autoSync })}
          />
        </Item>
        {changed && (
          <Item className="justify-end rounded-none border-0 px-3 py-2.5">
            <Button
              size="sm"
              variant="primary-soft"
              type="submit"
              disabled={busy}
            >
              {t("save")}
            </Button>
          </Item>
        )}
      </ItemGroup>
    </form>
  );
}
