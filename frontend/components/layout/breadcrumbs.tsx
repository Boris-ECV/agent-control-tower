"use client";

import Link from "next/link";

import type { BreadcrumbItem } from "@/lib/breadcrumbs";
import { t } from "@/lib/i18n/t";

const LINK_CLASS =
  "max-w-[10rem] truncate rounded-sm text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:max-w-xs";

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label={t("breadcrumb.ariaLabel")} data-slot="breadcrumbs">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-[22px]">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const title = item.title ?? item.label;
          if (isLast) {
            return (
              <li key={i} className="flex min-w-0 items-center">
                <span
                  aria-current="page"
                  className="max-w-[10rem] truncate font-medium text-text-primary md:max-w-xs"
                  title={title}
                >
                  {item.label}
                </span>
              </li>
            );
          }
          return (
            <li key={i} className="flex min-w-0 items-center gap-2">
              {item.href ? (
                <Link href={item.href} className={LINK_CLASS} title={title}>
                  {item.label}
                </Link>
              ) : (
                <span
                  className="max-w-[10rem] truncate text-text-secondary md:max-w-xs"
                  title={title}
                >
                  {item.label}
                </span>
              )}
              <span aria-hidden="true" className="text-text-secondary">
                /
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
