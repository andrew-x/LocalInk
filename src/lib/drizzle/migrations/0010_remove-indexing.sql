DROP TABLE `chunks`;--> statement-breakpoint
DROP INDEX `story_chat_messages_chat_position_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `story_chat_messages_chat_position_unique` ON `story_chat_messages` (`chat_id`,`position`);--> statement-breakpoint
ALTER TABLE `chapters` DROP COLUMN `indexed_hash`;--> statement-breakpoint
ALTER TABLE `chapters` DROP COLUMN `indexed_at`;--> statement-breakpoint
ALTER TABLE `chapters` DROP COLUMN `summary`;