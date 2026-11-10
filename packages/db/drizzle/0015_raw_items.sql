CREATE TABLE `app_raw_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `app_discovery_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_raw_items_run_idx` ON `app_raw_items` (`run_id`);--> statement-breakpoint
CREATE INDEX `app_raw_items_source_kind_idx` ON `app_raw_items` (`source`,`kind`,`created_at`);