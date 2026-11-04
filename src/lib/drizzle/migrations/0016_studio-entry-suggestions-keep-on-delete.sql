PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_studio_entry_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`moment_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moment_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_studio_entry_suggestions`("id", "story_id", "moment_id", "type", "name", "name_key", "description", "status", "created_at", "updated_at") SELECT "id", "story_id", "moment_id", "type", "name", "name_key", "description", "status", "created_at", "updated_at" FROM `studio_entry_suggestions`;--> statement-breakpoint
DROP TABLE `studio_entry_suggestions`;--> statement-breakpoint
ALTER TABLE `__new_studio_entry_suggestions` RENAME TO `studio_entry_suggestions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `studio_entry_suggestions_story_name_idx` ON `studio_entry_suggestions` (`story_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `studio_entry_suggestions_story_status_idx` ON `studio_entry_suggestions` (`story_id`,`status`);