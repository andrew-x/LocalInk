CREATE TABLE `studio_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`source` text NOT NULL,
	`thread_id` text,
	`message_id` text,
	`generation_id` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`operations` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_bundles_status_check" CHECK("studio_bundles"."status" IN ('pending', 'accepted', 'partially-accepted', 'rejected', 'undone'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_bundles_generation_unique` ON `studio_bundles` (`generation_id`);--> statement-breakpoint
CREATE INDEX `studio_bundles_story_status_idx` ON `studio_bundles` (`story_id`,`status`);