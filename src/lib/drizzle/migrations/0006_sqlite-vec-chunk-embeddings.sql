PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`text` text NOT NULL,
	`start_position` integer NOT NULL,
	`end_position` integer NOT NULL,
	`embedding` blob,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chunks_embedding_float32_vec_check" CHECK(
        CASE
          WHEN "__new_chunks"."embedding" IS NULL THEN 1
          ELSE typeof("__new_chunks"."embedding") = 'blob'
            AND vec_type("__new_chunks"."embedding") = 'float32'
        END
      )
);
--> statement-breakpoint
INSERT INTO `__new_chunks`("id", "story_id", "chapter_id", "text", "start_position", "end_position", "embedding") SELECT "id", "story_id", "chapter_id", "text", "start_position", "end_position", "embedding" FROM `chunks`;--> statement-breakpoint
DROP TABLE `chunks`;--> statement-breakpoint
ALTER TABLE `__new_chunks` RENAME TO `chunks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chunks_story_idx` ON `chunks` (`story_id`);--> statement-breakpoint
CREATE INDEX `chunks_chapter_position_idx` ON `chunks` (`chapter_id`,`start_position`);