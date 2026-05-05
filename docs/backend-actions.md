# Backend Actions

LocalInk uses `next-safe-action` for mutations and logged Server Functions for reads.

## Action Clients

The shared client lives in `src/lib/action.ts`:

- `publicActionClient`: mutation client with metadata, sanitized structured errors, request/response timing logs, and a maintenance-mode gate.
- `runLoggedAction`: read helper for Server Functions that need the same start/end/error logs as mutations.

LocalInk has no auth layer. Actions should not accept, infer, or check user identity unless the product direction changes.

Every action must provide metadata. Mutations use `.metadata(...)`; read Server Functions pass the same shape to `runLoggedAction`:

```ts
.metadata({ action: "create-writing-project" })
```

Action logs intentionally focus on action names, timing, success state, and error codes. Do not log user writing, prompts, manuscript text, or raw action payloads.

## Logging Convention

Use `src/lib/logger.ts` for application logging. App code should not call `console.*` directly; Biome enforces this with `noConsole`, and `src/lib/logger.ts` is the only exception.

Create scoped loggers with `createLogger("scope")` and keep messages short:

```ts
const storyLogger = createLogger("story");

storyLogger.info("loaded", { storyCount });
storyLogger.error("load-failed", { error });
```

Do not log user writing, prompts, manuscript text, or raw action payloads. Log operational metadata such as action names, IDs when needed, counts, durations, success state, and sanitized error codes.

Server action entrypoints should not add ad hoc start/end logs. Mutations get standardized logs from `publicActionClient`; read Server Functions should wrap their work in `runLoggedAction`.

## Mutation Pattern

Mutation files must start with `"use server"` and export safe actions:

```ts
"use server";

import { publicActionClient } from "@/lib/action";
import { updateSceneActionSchema } from "./_schemas";

export const updateScene = publicActionClient
  .metadata({ action: "update-scene" })
  .inputSchema(updateSceneActionSchema)
  .action(async ({ parsedInput }) => {
    return { success: true };
  });
```

Keep `"use server"` files thin. Put filesystem and data-access details in backend-only helpers under `src/lib/server/` when they grow beyond a small operation.

## Schema Split

Each feature should use separate form and action schemas:

```ts
import { z } from "zod";

export const sceneFormSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string(),
});

export const updateSceneActionSchema = sceneFormSchema.extend({
  projectId: z.string().min(1),
  sceneId: z.string().min(1),
});
```

The form schema covers fields the user edits. The action schema extends it with server-injected IDs or other hidden context.

## Client Calls

Use `useAction` for imperative non-form mutations:

```ts
import { toast } from "sonner";

const action = useAction(updateScene, {
  onSuccess: ({ data }) => {},
  onError: ({ error }) => {
    toast.error(error.serverError?.message ?? "The scene could not be updated.");
  },
});

action.execute(payload);
```

For forms, use React Hook Form, Zod, and `useHookFormAction` from `@next-safe-action/adapter-react-hook-form/hooks`.

React Hook Form owns browser form state and client validation. Zod owns input shape. `next-safe-action` owns server execution, server validation, typed results, and server errors. `useHookFormAction` is the bridge; do not manually wire `useForm` plus `useAction` for forms.

Use `formResolver` from `src/lib/schemas/resolve.ts` with the form schema:

```ts
const { form, action } = useHookFormAction(
  createStory,
  formResolver(createStoryFormSchema),
  {
    formProps: {
      defaultValues: { name: "", description: "" },
    },
  },
);
```

Submit with `handleSubmitWithAction` when the form values already match the action input. When the action schema needs prop-injected values, use `form.handleSubmit` and inject them at submit time:

```tsx
<form
  onSubmit={form.handleSubmit((values) =>
    action.execute({ ...values, storyId }),
  )}
>
```

Render controlled fields with `Controller`, pass `field` into the input, and render `fieldState.error` next to the field. Push server-level failures back into React Hook Form with `form.setError("root", { message })`, then render `form.formState.errors.root`.

Also show an error toast for action failures so operation-level errors are visible even when focus is elsewhere or a dialog closes. Inline field and root errors remain the source of actionable correction details; the toast should be a concise sanitized summary.

Keep this boundary:

- Client form schema validates exactly what the user can edit.
- Action schema validates the complete server payload.
- Server actions never trust client validation; `.inputSchema()` runs on the server too.
- Auth belongs in action-client middleware when LocalInk gains auth.
- React Hook Form handles field state; `next-safe-action` handles mutation state.

## Reads

Reads are logged Server Functions, not safe actions:

```ts
"use server";

import { runLoggedAction } from "@/lib/action";

export async function getScene(projectId: string, sceneId: string) {
  return runLoggedAction({ action: "get-scene" }, async () => {
    return null;
  });
}
```

Validate read inputs inside the function or the backend-only data-access helper it calls.

## Directory Structure

```text
src/actions/
  [feature]/
    _schemas.ts
    _types.ts
    get-[entity].ts
    [verb]-[entity].ts
```

Use a leading underscore for action-local support files that are not action entrypoints. Schema files should be named `_schemas.ts`; shared action result/input types should be named `_types.ts`.

Use action names that describe the operation in logs, for example `get-scene`, `create-scene`, `update-character`, or `delete-lore-entry`.
