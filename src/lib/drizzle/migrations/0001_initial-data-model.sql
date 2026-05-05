CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`content` text NOT NULL,
	`summary` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapters_story_position_idx` ON `chapters` (`story_id`,`position`);--> statement-breakpoint
CREATE TRIGGER `stories_updated_at_after_update`
AFTER UPDATE ON `stories`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `stories`
	SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	WHERE `id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `chapters_updated_at_after_update`
AFTER UPDATE ON `chapters`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `chapters`
	SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	WHERE `id` = OLD.`id`;
END;
