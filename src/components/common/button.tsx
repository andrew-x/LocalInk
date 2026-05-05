"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type * as React from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/common/tooltip";
import { cn } from "@/lib/util";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-label transition-[background-color,border-color,color,box-shadow,transform] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive shadow-xs hover:border-destructive/55 hover:bg-destructive/15",
        outline:
          "border-border/80 bg-card/60 text-foreground shadow-xs hover:border-ring/50 hover:bg-muted",
        secondary:
          "border-border/70 bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 gap-1.5 px-3",
        lg: "h-10 px-5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    leftSection?: React.ReactNode;
    rightSection?: React.ReactNode;
    tooltip?: React.ReactNode;
    tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  leftSection,
  rightSection,
  tooltip,
  tooltipSide,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const content = asChild ? (
    children
  ) : (
    <>
      {loading ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        leftSection
      )}
      {children}
      {rightSection}
    </>
  );

  const button = (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </Comp>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Button, buttonVariants };
