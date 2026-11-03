CREATE TABLE `app_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`run_id` text NOT NULL,
	`thread_id` text,
	`topic` text NOT NULL,
	`text` text NOT NULL,
	`evidence` text NOT NULL,
	`source_ids` text NOT NULL,
	`quote` text,
	`published_at` text,
	`event_date` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `app_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_claims_job_idx` ON `app_claims` (`job_id`);