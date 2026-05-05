# Database

Localink uses Drizzle ORM with a locally stored SQLite database. Database code lives under `src/lib/drizzle`, with schema in `schema.ts` and generated SQL migrations in `src/lib/drizzle/migrations`.

## Data Mode

Set `LOCALINK_DATA_MODE` in `.env`:

```env
LOCALINK_DATA_MODE=dev
```

Valid values are `dev` and `prod`. If the variable is omitted, Localink defaults to `dev`.

Database files are stored under the mode-specific app data folder:

- `data/dev/localink.sqlite`
- `data/prod/localink.sqlite`

The app creates the mode folder when it opens the database. `data/` contents are ignored by git because they contain local user data.

## Schema

The writing model has two content tables:

- `stories`: `id`, `name`, `description`, `characters`, `style`, `created_at`, `updated_at`
- `chapters`: `id`, `story_id`, `name`, `position`, `content`, `summary`, `updated_at`

`chapters.story_id` references `stories.id` with cascading delete behavior. `chapters.position` stores the chapter order within a story, and `chapters_story_position_idx` supports loading chapters by story in order.

`stories.characters` stores a JSON array of `{ name, description }` objects for story-level character context. `stories.style` stores story-level prose/style guidance as text.

`stories.created_at`, `stories.updated_at`, and `chapters.updated_at` default to the current UTC timestamp on insert. SQLite triggers refresh the `updated_at` fields automatically on row updates when the write does not explicitly change `updated_at`.

## Migrations

Migrations are generated from the TypeScript schema:

```bash
bun run db:generate -- --name=<migration-name>
```

Migrations can be applied manually:

```bash
bun run db:migrate
```

They also run automatically when the Next server starts. `src/instrumentation.ts` calls the migration runner only in the Node.js runtime, before the server starts handling requests. Drizzle tracks applied migrations in SQLite with its `__drizzle_migrations` table, so repeated starts are no-ops unless new migration files exist.
