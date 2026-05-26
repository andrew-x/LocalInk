"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/common/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import type { Prompt } from "@/components/prompts/prompts-data";

const COPIED_INDICATOR_MS = 1400;

type PromptCardProps = {
  prompt: Prompt;
};

export function PromptCard({ prompt }: PromptCardProps) {
  const [hasCopied, setHasCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt.content);
      toast.success("Copied.");
      setHasCopied(true);
      window.setTimeout(() => setHasCopied(false), COPIED_INDICATOR_MS);
    } catch {
      toast.error("The prompt could not be copied.");
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{prompt.title}</CardTitle>
          {prompt.description ? (
            <CardDescription>{prompt.description}</CardDescription>
          ) : null}
        </div>
        <Button
          aria-label={`Copy ${prompt.title}`}
          onClick={handleCopy}
          size="sm"
          type="button"
          variant="outline"
        >
          {hasCopied ? <Check /> : <Copy />}
          {hasCopied ? "Copied" : "Copy"}
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-3 font-sans text-muted-foreground text-sm leading-relaxed">
          {prompt.content}
        </pre>
      </CardContent>
    </Card>
  );
}
