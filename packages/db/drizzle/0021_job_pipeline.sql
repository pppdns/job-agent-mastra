ALTER TABLE `app_jobs` ADD `interview_round` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `interview_rounds` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `progressed_at` integer;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `app_jobs` ADD `notes_updated_at` integer;--> statement-breakpoint
UPDATE `app_jobs` SET `progressed_at` = `status_changed_at`;
