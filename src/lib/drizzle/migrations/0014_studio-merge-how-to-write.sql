-- Custom data step: "how to write it" is merged into the description. Author-written
-- how_to_write text moves into what_happens (appended after any existing
-- description) so no author direction is lost. AI-owned how_to_write is left alone.
UPDATE `studio_plan_items`
SET
	`what_happens` = CASE
		WHEN trim(`what_happens`) = '' THEN `how_to_write`
		WHEN `kind` = 'moment' THEN `what_happens` || char(10) || `how_to_write`
		ELSE `what_happens` || char(10) || char(10) || `how_to_write`
	END,
	`how_to_write` = '',
	`author_fields` = (
		SELECT json_group_array(`value`) FROM (
			SELECT `value` FROM json_each(`studio_plan_items`.`author_fields`) WHERE `value` != 'howToWrite'
			UNION ALL
			SELECT 'whatHappens' WHERE NOT EXISTS (
				SELECT 1 FROM json_each(`studio_plan_items`.`author_fields`) WHERE `value` = 'whatHappens'
			)
		)
	),
	`revision` = `revision` + 1,
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `how_to_write` != ''
	AND EXISTS (SELECT 1 FROM json_each(`studio_plan_items`.`author_fields`) WHERE `value` = 'howToWrite');
