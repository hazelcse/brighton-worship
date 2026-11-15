-- Leaving a session's builder without saving now throws the edits away (and unlocks the session),
-- so unsaved edits are no longer kept for later. The table that held them goes, with any rows in it.
DROP TABLE IF EXISTS "public"."worship_session_open_edits";
