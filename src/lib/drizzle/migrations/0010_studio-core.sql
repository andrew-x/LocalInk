CREATE TABLE `studio_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`about_entry_id` text,
	`aspect` text NOT NULL,
	`value` text NOT NULL,
	`plan_item_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`author_edited` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `studio_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`about_entry_id`) REFERENCES `studio_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_item_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_changes_aspect_check" CHECK("studio_changes"."aspect" IN ('believes', 'wants', 'knows', 'feels', 'where', 'status', 'looks', 'note')),
	CONSTRAINT "studio_changes_source_check" CHECK("studio_changes"."source" IN ('planned', 'read-back', 'author')),
	CONSTRAINT "studio_changes_status_check" CHECK("studio_changes"."status" IN ('planned', 'confirmed'))
);
--> statement-breakpoint
CREATE INDEX `studio_changes_story_plan_item_idx` ON `studio_changes` (`story_id`,`plan_item_id`);--> statement-breakpoint
CREATE TABLE `studio_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`type` text NOT NULL,
	`custom_type_label` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`related_entry_ids` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_entries_type_check" CHECK("studio_entries"."type" IN ('character', 'relationship', 'place', 'thing', 'lore', 'custom'))
);
--> statement-breakpoint
CREATE INDEX `studio_entries_story_type_position_idx` ON `studio_entries` (`story_id`,`type`,`position`);--> statement-breakpoint
CREATE TABLE `studio_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`plan_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_item_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_flags_kind_check" CHECK("studio_flags"."kind" IN ('unplanned-change', 'missing-planned-change')),
	CONSTRAINT "studio_flags_status_check" CHECK("studio_flags"."status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `studio_flags_story_status_idx` ON `studio_flags` (`story_id`,`status`);--> statement-breakpoint
CREATE TABLE `studio_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`what_happens` text DEFAULT '' NOT NULL,
	`how_to_write` text DEFAULT '' NOT NULL,
	`craft` text DEFAULT '{}' NOT NULL,
	`present_entry_ids` text DEFAULT '[]' NOT NULL,
	`context_pinned_entry_ids` text DEFAULT '[]' NOT NULL,
	`context_excluded_entry_ids` text DEFAULT '[]' NOT NULL,
	`author_fields` text DEFAULT '[]' NOT NULL,
	`origin` text DEFAULT 'ai' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`tension` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_plan_items_kind_check" CHECK("studio_plan_items"."kind" IN ('chapter', 'scene', 'moment')),
	CONSTRAINT "studio_plan_items_origin_check" CHECK("studio_plan_items"."origin" IN ('ai', 'author')),
	CONSTRAINT "studio_plan_items_tension_check" CHECK("studio_plan_items"."tension" IS NULL OR ("studio_plan_items"."kind" = 'chapter' AND "studio_plan_items"."tension" BETWEEN 1 AND 10))
);
--> statement-breakpoint
CREATE INDEX `studio_plan_items_story_parent_position_idx` ON `studio_plan_items` (`story_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE TABLE `studio_prose` (
	`moment_id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`origin` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`read_back_source_hash` text DEFAULT '' NOT NULL,
	`read_back_sentence_hashes` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`moment_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_prose_origin_check" CHECK("studio_prose"."origin" IN ('ai', 'author', 'ai-edited'))
);
--> statement-breakpoint
CREATE INDEX `studio_prose_story_idx` ON `studio_prose` (`story_id`);--> statement-breakpoint
CREATE TABLE `studio_prose_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`moment_id` text NOT NULL,
	`markdown` text NOT NULL,
	`origin` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moment_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_prose_versions_origin_check" CHECK("studio_prose_versions"."origin" IN ('ai', 'author', 'ai-edited'))
);
--> statement-breakpoint
CREATE INDEX `studio_prose_versions_moment_created_idx` ON `studio_prose_versions` (`moment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `studio_stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`style` text DEFAULT '{"povAndTense":"","register":"","pacing":"","avoid":"","notes":""}' NOT NULL,
	`theme` text DEFAULT '' NOT NULL,
	`structure_template` text DEFAULT 'freeform' NOT NULL,
	`structure_notes` text DEFAULT '' NOT NULL,
	`brain_dump` text DEFAULT '' NOT NULL,
	`voice_samples` text DEFAULT '[]' NOT NULL,
	`prose_model` text DEFAULT 'deepseek-v4-1-flash-1017-uncensored' NOT NULL,
	`setup_status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "studio_stories_structure_template_check" CHECK("studio_stories"."structure_template" IN ('romance', 'coming-of-age', 'quiet', 'freeform')),
	CONSTRAINT "studio_stories_setup_status_check" CHECK("studio_stories"."setup_status" IN ('draft', 'planned'))
);
