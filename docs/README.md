# LocalInk Project Memory

LocalInk is a local-first fiction writing app, run manually on the user's machine rather than deployed to the cloud. User writing and project files are private local data; prefer inspectable formats and clear migration paths.

Read this index first for repo-context questions, then only the relevant explanations. Code is the source of truth for implementation details.

## Docs Index

- [Agent setup](agent-setup.md): shared instructions, runtime parity, and trust caveats.
- [Backend actions](backend-actions.md): privacy boundaries and the concurrent-mutation exception.
- [Database](database.md): local data isolation, migration behavior, and data provenance.
- [AI prose generation](ai-prose-generation.md): prompt, context, draft-safety, and provider decisions.
- [AI image generation](ai-image-generation.md): endpoint/ZDR caveats, provider verification, and local persistence.
- [Styling](styling.md): token and Sass/Tailwind integration traps.
- [External references](devdocs-index.md): sources supporting non-obvious project decisions.

## Maintenance

Document non-obvious rationale, constraints, operational caveats, and decisions that need explanation. Routine changes do not require documentation or librarian delegation. Update existing explanations when changes invalidate them; avoid duplicating code, schemas, configuration, constants, or straightforward UI behavior.

Use the librarian for substantive explanation work or focused repo-context research. Keep this index current when explanatory docs are added or removed. Transient plans belong in `.tmp/`, not here.
