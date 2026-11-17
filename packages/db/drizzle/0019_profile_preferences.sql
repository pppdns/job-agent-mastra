ALTER TABLE `app_profile_versions` ADD `preferences` text;--> statement-breakpoint
-- Carry the search settings' place and pay criteria into the latest profile version: places where
-- office work was fine become OK hybrid / on-site places (anything else a deal-breaker), the pay
-- floor becomes the salary floor. Home stays unset until the user picks it on /profile.
UPDATE `app_profile_versions` SET `preferences` = (
  SELECT json_object(
    'workMode', json_object(
      'hybrid', json(COALESCE((SELECT json_group_array(json_object('place', value, 'level', 'ok')) FROM json_each(s.settings, '$.onsitePlaces')), '[]')),
      'onsite', json(COALESCE((SELECT json_group_array(json_object('place', value, 'level', 'ok')) FROM json_each(s.settings, '$.onsitePlaces')), '[]')),
      'hybridElsewhere', CASE WHEN COALESCE(json_array_length(s.settings, '$.onsitePlaces'), 0) > 0 THEN 'no' ELSE 'ok' END,
      'onsiteElsewhere', CASE WHEN COALESCE(json_array_length(s.settings, '$.onsitePlaces'), 0) > 0 THEN 'no' ELSE 'ok' END
    ),
    'salary', CASE
      WHEN json_extract(s.settings, '$.minSalary.amount') IS NOT NULL
      THEN json_object('floor', json_extract(s.settings, '$.minSalary.amount'), 'currency', upper(json_extract(s.settings, '$.minSalary.currency')))
      ELSE json_object()
    END
  )
  FROM `app_search_settings` s WHERE s.id = 1
)
WHERE `version` = (SELECT max(`version`) FROM `app_profile_versions`);
