CREATE TABLE `story_chat_edit_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`summary` text NOT NULL,
	`chapters` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `story_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `story_chat_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_chat_edit_proposals_status_check" CHECK("story_chat_edit_proposals"."status" IN ('pending', 'accepted', 'rejected', 'undone'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_chat_edit_proposals_generation_unique` ON `story_chat_edit_proposals` (`generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_chat_edit_proposals_message_unique` ON `story_chat_edit_proposals` (`message_id`);--> statement-breakpoint
CREATE INDEX `story_chat_edit_proposals_chat_idx` ON `story_chat_edit_proposals` (`chat_id`);--> statement-breakpoint
ALTER TABLE `chapters` ADD `content_revision` integer DEFAULT 0 NOT NULL;