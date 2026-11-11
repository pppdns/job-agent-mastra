-- Triage every waiting job by default: move saved settings still on the old defaults (400 jobs, $2 per run) to the new ones. Custom values stay.
UPDATE `app_search_settings` SET `settings` = json_set(`settings`, '$.maxTriagePerRun', 2000) WHERE json_extract(`settings`, '$.maxTriagePerRun') = 400;
--> statement-breakpoint
UPDATE `app_search_settings` SET `settings` = json_set(`settings`, '$.maxLlmUsdPerRun', 5) WHERE json_extract(`settings`, '$.maxLlmUsdPerRun') = 2;
