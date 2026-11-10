CREATE TABLE `app_discovery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`lookback_days` integer,
	`error` text,
	`sources` text NOT NULL,
	`estimated_usd` real DEFAULT 0 NOT NULL,
	`workflow_run_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `app_discovery_runs_started_idx` ON `app_discovery_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `app_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`company_key` text NOT NULL,
	`location` text,
	`remote` integer,
	`regions` text NOT NULL,
	`salary_min` real,
	`salary_max` real,
	`salary_currency` text,
	`salary_period` text,
	`salary_text` text,
	`seniority` text,
	`employment_type` text,
	`posted_at` integer,
	`description` text NOT NULL,
	`screen_reasons` text,
	`job_id` text,
	`first_run_id` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `app_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_postings_source_external_uq` ON `app_postings` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `app_postings_job_idx` ON `app_postings` (`job_id`);--> statement-breakpoint
CREATE INDEX `app_postings_first_seen_idx` ON `app_postings` (`first_seen_at`);--> statement-breakpoint
CREATE TABLE `app_search_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `origin` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `company_key` text;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `triage_score` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `triage_reason` text;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `triage_profile_version` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `triaged_at` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `kept_at` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `seen_at` integer;--> statement-breakpoint
CREATE INDEX `app_jobs_company_key_idx` ON `app_jobs` (`company_key`);