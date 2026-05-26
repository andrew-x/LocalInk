import { AppHeader } from "@/components/app/app-header";
import { PromptCard } from "@/components/prompts/prompt-card";
import { PROMPT_CATEGORIES } from "@/components/prompts/prompts-data";

export default function PromptsPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-workspace flex-col px-page py-5 md:py-7">
        <AppHeader />

        <section className="mt-6 flex flex-col gap-2">
          <h1 className="font-serif text-title">Prompt Library</h1>
          <p className="max-w-3xl text-body text-muted-foreground">
            Reusable writing-instruction snippets. Copy a preset into{" "}
            <span className="font-medium text-foreground">
              Settings → Writer Global System Instructions
            </span>{" "}
            for durable preferences, into a story&apos;s system instructions for
            story-specific voice, or into a per-generation writer brief.
          </p>
        </section>

        <div className="mt-8 flex flex-col gap-10 pb-12">
          {PROMPT_CATEGORIES.map((category) => (
            <section
              aria-labelledby={`prompt-category-${category.id}`}
              className="flex flex-col gap-4"
              key={category.id}
            >
              <header className="flex flex-col gap-1">
                <h2
                  className="text-heading"
                  id={`prompt-category-${category.id}`}
                >
                  {category.label}
                </h2>
                {category.description ? (
                  <p className="max-w-3xl text-body text-muted-foreground">
                    {category.description}
                  </p>
                ) : null}
              </header>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {category.prompts.map((prompt) => (
                  <PromptCard key={prompt.id} prompt={prompt} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
