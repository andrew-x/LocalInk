PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_generated_images` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_response_id` text,
	`prompt` text NOT NULL,
	`style_preset` text NOT NULL,
	`style_prompt` text NOT NULL,
	`model` text NOT NULL,
	`aspect_ratio` text NOT NULL,
	`image_size` text NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text NOT NULL,
	`file_relative_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_generated_images`("id", "provider", "provider_response_id", "prompt", "style_preset", "style_prompt", "model", "aspect_ratio", "image_size", "width", "height", "mime_type", "file_relative_path", "file_size", "created_at") SELECT "id", "provider", "provider_response_id", "prompt", "style_preset", "style_prompt", "model", "aspect_ratio", "image_size", "width", "height", "mime_type", "file_relative_path", "file_size", "created_at" FROM `generated_images`;--> statement-breakpoint
DROP TABLE `generated_images`;--> statement-breakpoint
ALTER TABLE `__new_generated_images` RENAME TO `generated_images`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `generated_images_created_at_idx` ON `generated_images` (`created_at`);
