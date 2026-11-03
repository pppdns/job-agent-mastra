ALTER TABLE `app_jobs` ADD `status` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `status_changed_at` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `app_jobs_archived_status_idx` ON `app_jobs` (`archived_at`,`status`);