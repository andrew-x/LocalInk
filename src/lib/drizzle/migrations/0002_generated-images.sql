CREATE TABLE `generated_images` (
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "generated_images_style_preset_check" CHECK("generated_images"."style_preset" IN ('amateur-photo', 'social-media-photo', 'professional-posed-photo', 'cinematic-photo', 'custom'))
);
--> statement-breakpoint
CREATE INDEX `generated_images_created_at_idx` ON `generated_images` (`created_at`);