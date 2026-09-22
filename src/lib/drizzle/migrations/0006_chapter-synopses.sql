ALTER TABLE `chapters` ADD `synopsis` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `synopsis_source_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `synopsis_updated_at` text;