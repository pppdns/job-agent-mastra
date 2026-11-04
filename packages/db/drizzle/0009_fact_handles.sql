ALTER TABLE `app_profile_facts` ADD `handle` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `app_profile_facts` SET `handle` = (SELECT `n` FROM (SELECT `id`, row_number() OVER (ORDER BY `created_in_version`, `created_at`, `id`) AS `n` FROM `app_profile_facts`) AS `numbered` WHERE `numbered`.`id` = `app_profile_facts`.`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_profile_facts_handle_idx` ON `app_profile_facts` (`handle`);
