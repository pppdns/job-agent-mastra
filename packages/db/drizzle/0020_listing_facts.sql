ALTER TABLE `app_jobs` ADD `facts` text;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `facts_version` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `extracted_at` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `eligibility` text;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `eligibility_quote` text;--> statement-breakpoint
CREATE INDEX `app_jobs_eligibility_idx` ON `app_jobs` (`eligibility`);