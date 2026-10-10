-- Links written/audio twins created before pairing existed (batch "both" split into two briefs, sample seeder).
-- Twins = same field, theme, topic and creator; the n-th written unit pairs with the n-th audio unit.
WITH candidates AS (
  SELECT u.id, u.format,
         row_number() OVER (PARTITION BY u.field_id, u.theme_id, b.topic, b.created_by, u.format ORDER BY u.created_at, u.id) AS n,
         u.field_id, u.theme_id, b.topic, b.created_by
  FROM unit u
  JOIN content_brief b ON b.id = u.brief_id
  WHERE u.pair_id IS NULL
),
pairs AS (
  SELECT w.id AS written_id, a.id AS audio_id, gen_random_uuid() AS pair_id
  FROM candidates w
  JOIN candidates a
    ON a.format = 'audio' AND w.format = 'written'
   AND a.field_id = w.field_id AND a.theme_id IS NOT DISTINCT FROM w.theme_id
   AND a.topic = w.topic AND a.created_by IS NOT DISTINCT FROM w.created_by AND a.n = w.n
)
UPDATE unit SET pair_id = p.pair_id
FROM pairs p
WHERE unit.id IN (p.written_id, p.audio_id);
