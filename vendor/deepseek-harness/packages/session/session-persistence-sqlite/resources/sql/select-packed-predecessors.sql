SELECT seq, type, time, data, source_event_seqs, surface_op, is_packed
FROM events
WHERE session_id = ? AND seq >= ? AND seq < ?
  AND type IN ('text-chunks', 'reasoning-chunks', 'tool-call-chunks')
  AND is_packed = 1
ORDER BY seq;
