# Database

LocalInk uses SQLite with Drizzle migrations. The schema and generated SQL are the source of truth for tables and columns; this document covers operational and provenance decisions.

## Local Data

`LOCALINK_DATA_MODE` selects `dev` or `prod`, defaulting to `dev`. Each has a separate database under `data/<mode>/localink.sqlite` and separate generated-image storage. The app creates the mode folder as needed. These ignored files contain private user data, not disposable build output.

Image rows hold metadata and relative paths; image bytes live separately. See [image persistence](ai-image-generation.md#local-storage) for legacy prompt meanings and filesystem boundaries.

## Data Provenance

Hidden chat messages capture saved reference context for a prepared generation, linked to the assistant reply by generation ID. They intentionally exclude manuscript text, story description, and outline content: chat is a planning/reference workflow, not a manuscript reader. See [chat context](ai-prose-generation.md#chat-context).

Chapter synopses are derived caches. Their versioned source hash establishes freshness against the actual manuscript snapshot, including unsaved focused-chapter edits; timestamps alone cannot establish that relationship. See [chapter synopses](ai-prose-generation.md#chapter-synopses).

Global AI instructions are local app settings, not story-scoped data. Missing or blank settings leave only the built-in prompts. Story-specific instructions are more specific writer preferences; their precedence is explained in [the prompt contract](ai-prose-generation.md#prompt-contract).

## Migrations

Update the Drizzle schema and generated SQL together using `bun run db:generate -- --name=<migration-name>`; do not hand-edit user SQLite files. `bun run db:migrate` applies migrations manually.

Migrations also run at Node server startup, before requests are handled. Drizzle records applied migrations in `__drizzle_migrations`, so restarting does not reapply them. Existing rows receive each migration's declared defaults; consult the generated SQL rather than maintaining a second migration chronology here.
