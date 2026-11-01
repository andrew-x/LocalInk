CREATE TABLE `studio_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`bundle_id` text,
	`generation_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `studio_chat_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "studio_chat_messages_role_check" CHECK("studio_chat_messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_chat_messages_thread_position_unique` ON `studio_chat_messages` (`thread_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `studio_chat_messages_generation_role_unique` ON `studio_chat_messages` (`generation_id`,`role`);--> statement-breakpoint
CREATE TABLE `studio_chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `studio_stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `studio_chat_threads_story_updated_idx` ON `studio_chat_threads` (`story_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `studio_stories` ADD `chat_model` text DEFAULT 'deepseek-v4-1-flash-1017-uncensored' NOT NULL;