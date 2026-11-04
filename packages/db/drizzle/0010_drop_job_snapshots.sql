DROP TABLE `app_job_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`thread_id` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`profile_version` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_app_approvals`("id", "kind", "status", "thread_id", "payload", "payload_hash", "idempotency_key", "profile_version", "created_at", "resolved_at") SELECT "id", "kind", "status", "thread_id", "payload", "payload_hash", "idempotency_key", "profile_version", "created_at", "resolved_at" FROM `app_approvals` WHERE "kind" = 'profile_change';--> statement-breakpoint
DROP TABLE `app_approvals`;--> statement-breakpoint
ALTER TABLE `__new_app_approvals` RENAME TO `app_approvals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `app_approvals_idempotency_key_unique` ON `app_approvals` (`idempotency_key`);--> statement-breakpoint
-- Profile page edits now apply directly; proposals left pending there can no longer be decided.
UPDATE `app_approvals` SET `status` = 'superseded', `resolved_at` = (unixepoch() * 1000) WHERE `thread_id` = 'profile-page' AND `status` = 'pending';
