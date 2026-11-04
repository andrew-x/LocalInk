PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_studio_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`about_entry_id` text,
	`aspect` text NOT NULL,
	`mode` text DEFAULT 'set' NOT NULL,
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
	CONSTRAINT "studio_changes_mode_check" CHECK("mode" IN ('set', 'add')),
	CONSTRAINT "studio_changes_source_check" CHECK("source" IN ('planned', 'read-back', 'author')),
	CONSTRAINT "studio_changes_status_check" CHECK("status" IN ('planned', 'confirmed'))
);
--> statement-breakpoint
INSERT INTO `__new_studio_changes`("id", "story_id", "entry_id", "about_entry_id", "aspect", "value", "plan_item_id", "position", "source", "status", "author_edited", "created_at", "updated_at") SELECT "id", "story_id", "entry_id", "about_entry_id", "aspect", "value", "plan_item_id", "position", "source", "status", "author_edited", "created_at", "updated_at" FROM `studio_changes`;--> statement-breakpoint
DROP TABLE `studio_changes`;--> statement-breakpoint
ALTER TABLE `__new_studio_changes` RENAME TO `studio_changes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `studio_changes_story_plan_item_idx` ON `studio_changes` (`story_id`,`plan_item_id`);
--> statement-breakpoint
UPDATE `studio_changes` SET `mode` = 'add' WHERE `aspect` IN ('knows', 'note');--> statement-breakpoint
UPDATE `studio_flags` SET `payload` = json_set(`payload`, '$.mode', CASE WHEN json_extract(`payload`, '$.aspect') IN ('knows', 'note') THEN 'add' ELSE 'set' END) WHERE `kind` = 'unplanned-change';
