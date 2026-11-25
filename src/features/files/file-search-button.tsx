import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SearchPopoverContent } from "@/components/ui/search-popover";
import { Popover, PopoverTrigger } from "@/components/ui/popover";

export function FileSearchButton({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("files");
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef(false);
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        focusOnOpen.current = details.reason !== "trigger-hover";
        setOpen(next);
      }}
    >
      <span ref={anchor} className="inline-flex shrink-0">
        <PopoverTrigger
          openOnHover
          delay={150}
          closeDelay={150}
          disabled={disabled}
          onClick={() => input.current?.focus({ preventScroll: true })}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={`files-search-trigger ${value ? "bg-muted" : ""}`}
              data-filtered={!!value}
              aria-label={t("search")}
              title={value ? `${t("search")}: ${value}` : t("search")}
            >
              <Search />
            </Button>
          }
        />
      </span>
      <SearchPopoverContent
        anchor={anchor}
        align="end"
        aria-label={t("search")}
        initialFocus={() => (focusOnOpen.current ? input.current : false)}
        inputProps={{
          ref: input,
          "aria-label": t("search"),
          placeholder: t("search"),
          value,
          onChange: (event) => onChange(event.target.value),
        }}
      />
    </Popover>
  );
}
