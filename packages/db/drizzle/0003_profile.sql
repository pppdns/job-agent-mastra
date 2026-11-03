CREATE TABLE `app_profile_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_in_version` integer NOT NULL,
	`superseded_in_version` integer,
	`supersedes_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_profile_facts_current_idx` ON `app_profile_facts` (`superseded_in_version`);--> statement-breakpoint
CREATE TABLE `app_profile_versions` (
	`version` integer PRIMARY KEY NOT NULL,
	`approval_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_profile_versions_approval_id_unique` ON `app_profile_versions` (`approval_id`);--> statement-breakpoint
ALTER TABLE `app_approvals` ADD `profile_version` integer;--> statement-breakpoint
ALTER TABLE `app_job_drafts` ADD `profile_version` integer DEFAULT 0 NOT NULL;