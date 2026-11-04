CREATE TABLE `studio_entry_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`moment_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moment_id`) REFERENCES `studio_plan_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_entry_suggestions_story_name_idx` ON `studio_entry_suggestions` (`story_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `studio_entry_suggestions_story_status_idx` ON `studio_entry_suggestions` (`story_id`,`status`);