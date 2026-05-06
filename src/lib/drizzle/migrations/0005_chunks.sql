CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`text` text NOT NULL,
	`start_position` integer NOT NULL,
	`end_position` integer NOT NULL,
	`embedding` blob,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_story_idx` ON `chunks` (`story_id`);--> statement-breakpoint
CREATE INDEX `chunks_chapter_position_idx` ON `chunks` (`chapter_id`,`start_position`);--> statement-breakpoint
ALTER TABLE `chapters` DROP COLUMN `embedding`;