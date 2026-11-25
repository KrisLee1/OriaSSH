import { PageEmptyState } from "@/components/page-empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { useId, useMemo, useState } from "react";
import {
  DatabaseBackupIcon,
  ServerCogIcon,
  WebhookIcon,
  FolderSyncIcon,
  NotebookPenIcon,
  MicrochipIcon,
  ScanTextIcon,
  WaypointsIcon,
  DatabaseZapIcon,
  RadioTowerIcon,
  FileCodeIcon,
  GitForkIcon,
  PanelsTopLeftIcon,
  AudioLinesIcon,
  BinaryIcon,
  DnaIcon,
  AtomIcon,
  CircuitBoardIcon,
  SigmaIcon,
  MonitorCogIcon,
  ChevronDownIcon,
  ServerIcon,
  PencilIcon,
  DatabaseIcon,
  GlobeIcon,
  SquareTerminalIcon,
  CodeIcon,
  BracesIcon,
  MonitorIcon,
  LaptopIcon,
  SmartphoneIcon,
  TabletIcon,
  PcCaseIcon,
  PrinterIcon,
  UsbIcon,
  CctvIcon,
  ProjectorIcon,
  SatelliteDishIcon,
  WatchIcon,
  TvIcon,
  KeyboardIcon,
  NetworkIcon,
  RouterIcon,
  WifiIcon,
  CableIcon,
  PlugIcon,
  CloudIcon,
  ContainerIcon,
  BoxesIcon,
  HardDriveIcon,
  FolderIcon,
  FileIcon,
  ArchiveIcon,
  ShieldIcon,
  LockIcon,
  KeyRoundIcon,
  FingerprintIcon,
  EyeIcon,
  ActivityIcon,
  ChartNoAxesCombinedIcon,
  GaugeIcon,
  CpuIcon,
  MemoryStickIcon,
  BotIcon,
  BrainCircuitIcon,
  SearchIcon,
  MailIcon,
  MessageSquareIcon,
  VideoIcon,
  MusicIcon,
  ImageIcon,
  Gamepad2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  PackageIcon,
  WrenchIcon,
  SettingsIcon,
  FlaskConicalIcon,
  RocketIcon,
  ZapIcon,
  StarIcon,
  HeartIcon,
  HouseIcon,
  Building2Icon,
  CoffeeIcon,
  LeafIcon,
  LayersIcon,
  WorkflowIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { RuleIcon } from "@/types";
import { ConnectionColorDot, ConnectionColorPicker } from "./connection-color";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import serviceIcons from "@/assets/service-icons.json";
import platformIcons from "@/assets/platform-icons.json";
import catalog from "./connection-icon-catalog.json";

const icons = {
  "database-backup": DatabaseBackupIcon,
  "server-cog": ServerCogIcon,
  webhook: WebhookIcon,
  "folder-sync": FolderSyncIcon,
  notebook: NotebookPenIcon,
  microchip: MicrochipIcon,
  ocr: ScanTextIcon,
  pipeline: WaypointsIcon,
  "database-fast": DatabaseZapIcon,
  "radio-tower": RadioTowerIcon,
  "file-code": FileCodeIcon,
  "git-fork": GitForkIcon,
  "web-app": PanelsTopLeftIcon,
  audio: AudioLinesIcon,
  binary: BinaryIcon,
  dna: DnaIcon,
  atom: AtomIcon,
  circuit: CircuitBoardIcon,
  sigma: SigmaIcon,
  "remote-desktop": MonitorCogIcon,

  server: ServerIcon,
  database: DatabaseIcon,
  globe: GlobeIcon,
  terminal: SquareTerminalIcon,
  code: CodeIcon,
  braces: BracesIcon,
  monitor: MonitorIcon,
  laptop: LaptopIcon,
  smartphone: SmartphoneIcon,
  tablet: TabletIcon,
  "pc-case": PcCaseIcon,
  printer: PrinterIcon,
  usb: UsbIcon,
  cctv: CctvIcon,
  projector: ProjectorIcon,
  dish: SatelliteDishIcon,
  watch: WatchIcon,
  television: TvIcon,
  keyboard: KeyboardIcon,
  network: NetworkIcon,
  router: RouterIcon,
  wifi: WifiIcon,
  cable: CableIcon,
  plug: PlugIcon,
  cloud: CloudIcon,
  container: ContainerIcon,
  boxes: BoxesIcon,
  "hard-drive": HardDriveIcon,
  folder: FolderIcon,
  file: FileIcon,
  archive: ArchiveIcon,
  shield: ShieldIcon,
  lock: LockIcon,
  key: KeyRoundIcon,
  fingerprint: FingerprintIcon,
  eye: EyeIcon,
  activity: ActivityIcon,
  chart: ChartNoAxesCombinedIcon,
  gauge: GaugeIcon,
  cpu: CpuIcon,
  memory: MemoryStickIcon,
  bot: BotIcon,
  brain: BrainCircuitIcon,
  search: SearchIcon,
  mail: MailIcon,
  message: MessageSquareIcon,
  video: VideoIcon,
  music: MusicIcon,
  image: ImageIcon,
  gamepad: Gamepad2Icon,
  "git-branch": GitBranchIcon,
  "git-pull": GitPullRequestIcon,
  package: PackageIcon,
  wrench: WrenchIcon,
  settings: SettingsIcon,
  flask: FlaskConicalIcon,
  rocket: RocketIcon,
  zap: ZapIcon,
  star: StarIcon,
  heart: HeartIcon,
  home: HouseIcon,
  building: Building2Icon,
  coffee: CoffeeIcon,
  leaf: LeafIcon,
  layers: LayersIcon,
  workflow: WorkflowIcon,
};
const brands = { ...serviceIcons.icons, ...platformIcons };
export { catalog as connectionIconCatalog };

export function connectionIconLabelKey(item: { id?: string; value?: string }) {
  return (
    item.id ??
    `emoji-${[...item.value!].map((character) => character.codePointAt(0)!.toString(16)).join("-")}`
  );
}

// A single visible grapheme also supports flags, skin tones and ZWJ emoji.
export function validCustomIcon(value: string) {
  return (
    value.length > 0 &&
    [...value].length <= 16 &&
    value.replace(/[\u200d\ufe00-\ufe0f\u{e0020}-\u{e007f}]/gu, "").length >
      0 &&
    !/[\s\p{Cc}\p{Cf}]/u.test(
      value.replace(/[\u200d\u{e0020}-\u{e007f}]/gu, ""),
    ) &&
    [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        value,
      ),
    ].length === 1
  );
}

export function ConnectionIcon({
  icon,
  color,
}: {
  icon?: RuleIcon | null;
  color: string | null;
}) {
  if (!icon) return <ConnectionColorDot color={color} />;
  const Glyph =
    icon.kind === "builtin" && Object.hasOwn(icons, icon.value)
      ? icons[icon.value as keyof typeof icons]
      : undefined;
  const brand =
    icon.kind === "builtin" && Object.hasOwn(brands, icon.value)
      ? brands[icon.value as keyof typeof brands]
      : undefined;
  if (icon.kind === "builtin" && !Glyph && !brand)
    return <ConnectionColorDot color={color} />;
  return (
    <span
      className="connection-icon"
      style={{ color: color || "var(--oria-color-primary)" }}
      aria-hidden="true"
    >
      {Glyph ? (
        <Glyph size={18} />
      ) : brand ? (
        <svg
          viewBox={brand.viewBox}
          width="18"
          height="18"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          {brand.paths.map((path, i) => (
            <path key={i} d={path} />
          ))}
        </svg>
      ) : (
        icon.value
      )}
    </span>
  );
}

const iconOptions = {
  builtin: catalog.icons.filter(({ category }) => category !== "service"),
  service: catalog.icons.filter(({ category }) => category === "service"),
  emoji: catalog.emojis,
};
const defaultHostIcon = { kind: "builtin", value: "server" } satisfies RuleIcon;
const iconOptionClass = buttonVariants({
  variant: "ghost",
  size: "icon",
  className: "connection-icon-option",
});

function IconOptions({
  category,
  query,
  value,
  color,
  onChange,
}: {
  category: keyof typeof iconOptions;
  query: string;
  value: RuleIcon | null;
  color: string | null;
  onChange: (icon: RuleIcon) => void;
}) {
  const { t } = useTranslation("tunnel");
  const kind = category === "emoji" ? "emoji" : "builtin";
  const entries = useMemo(
    () =>
      iconOptions[category].map((item) => {
        const name = t(connectionIconLabelKey(item), { ns: "icons" });
        const value = "id" in item ? item.id : item.value;
        return {
          name,
          value,
          search: `${name} ${item.zh} ${item.en} ${value}`.toLocaleLowerCase(),
        };
      }),
    [category, t],
  );
  const term = query.trim().toLocaleLowerCase();
  const visible = term
    ? entries.filter(({ search }) => search.includes(term))
    : entries;
  return (
    <div className="connection-icon-options" data-category={category}>
      <div className="connection-icon-grid">
        {visible.map((item) => (
          <button
            key={item.value}
            type="button"
            className={iconOptionClass}
            aria-label={item.name}
            title={item.name}
            aria-pressed={value?.kind === kind && value.value === item.value}
            onClick={() => onChange({ kind, value: item.value })}
          >
            <ConnectionIcon icon={{ kind, value: item.value }} color={color} />
          </button>
        ))}
        {!visible.length && (
          <PageEmptyState
            compact
            role="status"
            className="connection-icon-empty"
            icon={<SearchIcon />}
            title={t("noMatchingIcons")}
          />
        )}
      </div>
    </div>
  );
}

export function ConnectionIconPicker({
  value,
  color,
  onChange,
  fieldLabel,
  initialCategory = "builtin",
  avatar,
}: {
  value: RuleIcon | null;
  color: string | null;
  onChange: (icon: RuleIcon | null) => void;
  fieldLabel?: string;
  initialCategory?: "builtin" | "service";
  avatar?: {
    onColorChange: (color: string | null) => void;
    fallbackIcon?: RuleIcon;
    colorLabel?: string;
    resetLabel?: string;
  };
}) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [custom, setCustom] = useState(
    value?.kind === "emoji" ? value.value : "",
  );
  const id = useId();
  const selected =
    value?.kind === "builtin"
      ? catalog.icons.find((item) => item.id === value.value)
      : catalog.emojis.find((item) => item.value === value?.value);
  const selectedName = !value
    ? t("defaultIcon")
    : selected
      ? t(connectionIconLabelKey(selected), { ns: "icons" })
      : value.value;
  const customIsValid = validCustomIcon(custom);
  const applyCustom = () => {
    if (customIsValid) onChange({ kind: "emoji", value: custom });
  };
  const fallbackIcon = avatar?.fallbackIcon ?? defaultHostIcon;
  const resetLabel = avatar ? avatar.resetLabel : t("defaultIcon");
  const optionsProps = {
    query,
    value: value ?? (avatar ? fallbackIcon : null),
    color,
    onChange: (icon: RuleIcon) =>
      onChange(
        avatar &&
          icon.kind === fallbackIcon.kind &&
          icon.value === fallbackIcon.value
          ? null
          : icon,
      ),
  };
  const library = (
    <div className="connection-icon-body">
      <div className="connection-icon-tools">
        <Tabs
          defaultValue={
            value?.kind === "emoji"
              ? "emoji"
              : value?.kind === "builtin" &&
                  catalog.icons.find((i) => i.id === value.value)?.category ===
                    "service"
                ? "service"
                : value
                  ? "builtin"
                  : initialCategory
          }
        >
          <div className="connection-icon-tools-row">
            <TabsList
              aria-label={t("iconLibrary")}
              className="connection-icon-tabs"
            >
              <TabsTrigger value="builtin">{t("builtinIcons")}</TabsTrigger>
              <TabsTrigger value="service">
                {t("serviceIcons", { ns: "commands" })}
              </TabsTrigger>
              <TabsTrigger value="emoji">{t("emojiCategory")}</TabsTrigger>
            </TabsList>
            {resetLabel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={!value}
                onClick={() => onChange(null)}
              >
                {resetLabel}
              </Button>
            )}
          </div>
          <SearchInput
            aria-label={t("searchIcons")}
            placeholder={t("searchIcons")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <TabsContent
            value="builtin"
            keepMounted={Boolean(avatar)}
            className="connection-icon-panel"
          >
            <IconOptions category="builtin" {...optionsProps} />
          </TabsContent>
          <TabsContent value="service" className="connection-icon-panel">
            <IconOptions category="service" {...optionsProps} />
          </TabsContent>
          <TabsContent
            value="emoji"
            keepMounted={Boolean(avatar)}
            className="connection-icon-panel"
          >
            <IconOptions category="emoji" {...optionsProps} />
            <label className="sr-only" htmlFor={`${id}-custom`}>
              {t("customEmoji")}
            </label>
            <div className="connection-icon-custom-row">
              <Input
                id={`${id}-custom`}
                value={custom}
                maxLength={64}
                placeholder={t("customEmoji")}
                aria-describedby={`${id}-hint`}
                aria-invalid={!!custom && !customIsValid}
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    applyCustom();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!customIsValid}
                onClick={applyCustom}
              >
                {t("useIcon")}
              </Button>
            </div>
            <small
              id={`${id}-hint`}
              className={custom && !customIsValid ? "inline-error" : "muted"}
            >
              {t("customEmojiHint")}
            </small>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
  if (avatar) {
    const label = fieldLabel ?? t("hostIcon");
    return (
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="profile-icon-trigger"
            />
          }
          aria-label={label}
          title={label}
        >
          <ConnectionIcon icon={value ?? fallbackIcon} color={color} />
          <span className="profile-icon-edit" aria-hidden="true">
            <PencilIcon />
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="profile-icon-popover">
          <PopoverTitle>{label}</PopoverTitle>
          <ConnectionColorPicker
            fieldLabel={avatar.colorLabel ?? t("hostColor")}
            value={color}
            onChange={avatar.onColorChange}
          />
          {library}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <div className="field">
      <span id={id}>{fieldLabel ?? t("connectionIcon")}</span>
      <div className="connection-icon-picker">
        <Button
          type="button"
          variant="ghost"
          className="connection-icon-trigger"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-labelledby={`${id} ${id}-selection`}
          onClick={() => setOpen(!open)}
        >
          <ConnectionIcon icon={value} color={color} />
          <span id={`${id}-selection`}>{selectedName}</span>
          <ChevronDownIcon size={16} aria-hidden="true" />
        </Button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={`${id}-panel`}
              key="icon-panel"
              style={{ overflow: "hidden" }}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {library}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
