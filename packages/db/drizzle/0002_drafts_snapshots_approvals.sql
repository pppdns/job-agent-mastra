CREATE TABLE `app_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`thread_id` text NOT NULL,
	`job_id` text,
	`draft_id` text,
	`draft_version` integer,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`snapshot_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `app_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `app_job_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_approvals_idempotency_key_unique` ON `app_approvals` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `app_job_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`assessment` text NOT NULL,
	`thread_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `app_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_job_drafts_job_version_uq` ON `app_job_drafts` (`job_id`,`version`);--> statement-breakpoint
CREATE TABLE `app_job_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`draft_id` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`approval_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `app_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `app_job_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_job_snapshots_approval_id_unique` ON `app_job_snapshots` (`approval_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_job_snapshots_job_version_uq` ON `app_job_snapshots` (`job_id`,`version`);