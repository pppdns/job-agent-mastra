-- Full-text index over saved jobs, maintained by app code (reindexJob in src/jobs.ts).
CREATE VIRTUAL TABLE `app_jobs_fts` USING fts5(job_id UNINDEXED, title, company, location, summary, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO `app_jobs_fts` (job_id, title, company, location, summary)
SELECT j.id, coalesce(j.title, ''), coalesce(j.company, ''), coalesce(j.location, ''),
  coalesce((SELECT json_extract(d.assessment, '$.overview') FROM app_job_drafts d WHERE d.job_id = j.id ORDER BY d.version DESC LIMIT 1), '')
FROM app_jobs j;
