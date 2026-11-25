import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { PopoverContent } from "./popover";
import { SearchInput } from "./search-input";

export function SearchPopoverContent({
  inputProps,
  className,
  children,
  ...props
}: ComponentProps<typeof PopoverContent> & {
  inputProps: Omit<ComponentProps<typeof SearchInput>, "embedded">;
}) {
  return (
    <PopoverContent
      {...props}
      className={cn("search-popover overflow-hidden p-0", className)}
    >
      <search className="flex min-h-0 flex-col">
        <SearchInput {...inputProps} embedded />
        {children}
      </search>
    </PopoverContent>
  );
}
