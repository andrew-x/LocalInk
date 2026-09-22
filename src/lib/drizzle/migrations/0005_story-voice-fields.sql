ALTER TABLE `stories` ADD `system_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `stories` ADD `voice_exemplars` text DEFAULT '[]' NOT NULL;