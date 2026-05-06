ALTER TABLE `chapters` RENAME COLUMN "hash" TO "indexed_hash";--> statement-breakpoint
ALTER TABLE `chapters` ADD `indexed_at` text;