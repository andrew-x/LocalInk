-- Carries each story's old writing samples and style fields into the voice model.
-- Samples become kept samples plus one kind of moment each; non-empty style
-- fields become AI-origin notes. `instructions` is left untouched.
CREATE TEMP TABLE `_voice_carry` AS
WITH raw AS (
  SELECT
    s.id AS story_id,
    CAST(j.key AS INTEGER) AS idx,
    coalesce(json_extract(j.value, '$.id'), 'sample-' || s.id || '-' || j.key) AS sid,
    trim(coalesce(json_extract(j.value, '$.label'), '')) AS lbl,
    coalesce(json_extract(j.value, '$.text'), '') AS txt
  FROM studio_stories s, json_each(s.voice_samples) j
), counted AS (
  SELECT *, count(*) OVER (PARTITION BY story_id, lower(lbl)) AS same_count FROM raw
)
SELECT
  story_id,
  idx,
  sid,
  txt,
  CASE
    WHEN lbl = '' THEN 'Your sample ' || (idx + 1)
    WHEN same_count > 1 THEN substr(lbl, 1, 55) || ' ' || (idx + 1)
    ELSE substr(lbl, 1, 60)
  END AS kind
FROM counted;--> statement-breakpoint
CREATE TEMP TABLE `_voice_carry_notes` AS
SELECT id AS story_id, 1 AS ord, 'POV and tense: ' || trim(json_extract(style, '$.povAndTense')) AS text
FROM studio_stories WHERE trim(coalesce(json_extract(style, '$.povAndTense'), '')) <> ''
UNION ALL
SELECT id, 2, 'Register: ' || trim(json_extract(style, '$.register'))
FROM studio_stories WHERE trim(coalesce(json_extract(style, '$.register'), '')) <> ''
UNION ALL
SELECT id, 3, 'Pacing: ' || trim(json_extract(style, '$.pacing'))
FROM studio_stories WHERE trim(coalesce(json_extract(style, '$.pacing'), '')) <> ''
UNION ALL
SELECT id, 4, 'Avoid: ' || trim(json_extract(style, '$.avoid'))
FROM studio_stories WHERE trim(coalesce(json_extract(style, '$.avoid'), '')) <> ''
UNION ALL
SELECT id, 5, 'Style notes: ' || trim(json_extract(style, '$.notes'))
FROM studio_stories WHERE trim(coalesce(json_extract(style, '$.notes'), '')) <> '';--> statement-breakpoint
UPDATE `studio_stories` SET
  `voice` = json_set(
    `voice`,
    '$.moments',
    json((
      SELECT json_group_array(json_object('id', 'moment-' || c.sid, 'kind', c.kind, 'planItemId', NULL))
      FROM (SELECT * FROM `_voice_carry` WHERE story_id = `studio_stories`.`id` ORDER BY idx) c
    ))
  ),
  `voice_samples` = json((
    SELECT json_group_array(json_object(
      'id', c.sid, 'kind', c.kind, 'text', c.txt,
      'planItemId', NULL, 'source', 'author', 'stale', json('false')
    ))
    FROM (SELECT * FROM `_voice_carry` WHERE story_id = `studio_stories`.`id` ORDER BY idx) c
  ))
WHERE EXISTS (SELECT 1 FROM `_voice_carry` WHERE story_id = `studio_stories`.`id`);--> statement-breakpoint
UPDATE `studio_stories` SET
  `voice` = json_set(
    `voice`,
    '$.notes',
    json((
      SELECT json_group_array(json_object(
        'id', 'note-' || lower(hex(randomblob(8))), 'text', n.text, 'origin', 'ai'
      ))
      FROM (SELECT text FROM `_voice_carry_notes` WHERE story_id = `studio_stories`.`id` ORDER BY ord) n
    ))
  )
WHERE EXISTS (SELECT 1 FROM `_voice_carry_notes` WHERE story_id = `studio_stories`.`id`);--> statement-breakpoint
DROP TABLE `_voice_carry`;--> statement-breakpoint
DROP TABLE `_voice_carry_notes`;
