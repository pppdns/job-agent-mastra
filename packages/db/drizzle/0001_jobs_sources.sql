CREATE TABLE `app_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`linkedin_job_id` text,
	`canonical_url` text,
	`company` text,
	`title` text,
	`location` text,
	`dedupe_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_jobs_linkedin_job_id_unique` ON `app_jobs` (`linkedin_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_jobs_canonical_url_unique` ON `app_jobs` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `app_jobs_dedupe_key_idx` ON `app_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `app_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`url` text,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`truncated` integer NOT NULL,
	`thread_id` text,
	`retrieved_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `app_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_sources_job_content_uq` ON `app_sources` (`job_id`,`content_hash`);