import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/util";

type AppHeaderProps = {
  actions?: ReactNode;
  className?: string;
};

const navigationItems = [
  { href: "/", label: "Home" },
  { href: "/images/generate", label: "Generate Images" },
  { href: "/images", label: "Image Gallery" },
] as const;

export function AppHeader({ actions, className }: AppHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 flex-col gap-4 border-border/80 border-b pb-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-center md:gap-7">
        <Link aria-label="LocalInk home" className="w-fit" href="/">
          <Image
            alt="LocalInk"
            className="h-9 w-auto max-w-44"
            height={36}
            priority
            src="/logo.svg"
            width={169}
          />
        </Link>

        <nav aria-label="Main navigation" className="flex flex-wrap gap-1.5">
          {navigationItems.map((item) => (
            <Link
              className="rounded-md px-3 py-2 text-label text-muted-foreground transition-[background-color,color] hover:bg-muted/70 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {actions ? (
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
