CREATE TABLE `app_run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`actor` text,
	`status` text NOT NULL,
	`at` integer NOT NULL,
	`duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_input_tokens` integer,
	`cache_write_tokens` integer,
	`reasoning_tokens` integer,
	`estimated_usd` real,
	`data` text,
	FOREIGN KEY (`run_id`) REFERENCES `app_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_run_events_run_idx` ON `app_run_events` (`run_id`);--> statement-breakpoint
ALTER TABLE `app_runs` ADD `model` text;--> statement-breakpoint
ALTER TABLE `app_runs` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `app_runs` ADD `ttft_ms` integer;