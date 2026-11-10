ALTER TABLE `app_jobs` ADD `ats_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `app_jobs_ats_key_unique` ON `app_jobs` (`ats_key`);