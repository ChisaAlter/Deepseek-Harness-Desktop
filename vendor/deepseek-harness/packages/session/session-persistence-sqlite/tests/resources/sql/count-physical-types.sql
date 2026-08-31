SELECT type, COUNT(*) AS count
FROM events
WHERE type IN ('text-chunks', 'reasoning-chunks', 'tool-call-chunks')
  AND is_packed = 1
GROUP BY type
ORDER BY type;
