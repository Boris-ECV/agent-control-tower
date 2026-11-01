"use client";

import Link from "next/link";
import type { KeyboardEvent } from "react";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-sm leading-[22px] text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => {
        if (e.key === " ") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 flex-none fill-current">
        <path d="M9.78 2.22a.75.75 0 0 1 0 1.06L5.06 8l4.72 4.72a.75.75 0 1 1-1.06 1.06L3.47 8.53a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" />
      </svg>
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
    </Link>
  );
}
