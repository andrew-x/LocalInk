ALTER TABLE `studio_stories` ADD `genre` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `studio_stories` ADD `voice` text DEFAULT '{"picks":[],"notes":[],"moments":[]}' NOT NULL;