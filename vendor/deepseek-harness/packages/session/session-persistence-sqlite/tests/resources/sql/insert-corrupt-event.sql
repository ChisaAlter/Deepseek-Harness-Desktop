INSERT INTO events (session_id, seq, type, time, data, is_packed)
VALUES ((SELECT id FROM sessions WHERE session_key = ?), ?, ?, ?, ?, ?);
