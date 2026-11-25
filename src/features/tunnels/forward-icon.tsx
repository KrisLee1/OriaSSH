import type { ComponentProps } from "react";

export function ForwardIcon({ add = false, ...props }: ComponentProps<"svg"> & { add?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="5" cy="18" r="2" />
      <path d="M5 16v-4a4 4 0 0 1 4-4h11m-3-3 3 3-3 3" />
      {add && <path d="M17 14v6m-3-3h6" />}
    </svg>
  );
}
