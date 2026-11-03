CREATE TABLE `app_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `app_runs_thread_idx` ON `app_runs` (`thread_id`,`status`);