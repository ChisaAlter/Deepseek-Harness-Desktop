SELECT COUNT(*) AS count
FROM events
WHERE type = 'text-chunks' AND is_packed = 1;
