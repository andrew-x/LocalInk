CREATE TABLE `story_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`is_visible` integer NOT NULL,
	`position` integer NOT NULL,
	`content` text NOT NULL,
	`generation_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `story_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "story_chat_messages_role_check" CHECK("story_chat_messages"."role" IN ('system', 'user', 'assistant')),
	CONSTRAINT "story_chat_messages_visibility_role_check" CHECK(
        CASE
          WHEN "story_chat_messages"."is_visible" = 0 THEN "story_chat_messages"."role" = 'system'
          ELSE "story_chat_messages"."role" IN ('user', 'assistant')
        END
      )
);
--> statement-breakpoint
CREATE INDEX `story_chat_messages_chat_position_idx` ON `story_chat_messages` (`chat_id`,`position`);--> statement-breakpoint
CREATE INDEX `story_chat_messages_generation_idx` ON `story_chat_messages` (`generation_id`);--> statement-breakpoint
CREATE INDEX `story_chat_messages_story_idx` ON `story_chat_messages` (`story_id`);--> statement-breakpoint
CREATE TABLE `story_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_chats_story_updated_idx` ON `story_chats` (`story_id`,`updated_at`);