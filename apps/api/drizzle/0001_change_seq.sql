-- One global sequence feeds the pull cursor (research R6). Every insert or update of a synced
-- table takes the next value, so `change_seq > cursor` returns exactly what changed.
CREATE SEQUENCE change_seq_seq AS bigint;
--> statement-breakpoint
CREATE FUNCTION set_change_seq() RETURNS trigger AS $$
BEGIN
  NEW.change_seq := nextval('change_seq_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER learner_settings_change_seq BEFORE INSERT OR UPDATE ON learner_settings
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
--> statement-breakpoint
CREATE TRIGGER learner_stats_change_seq BEFORE INSERT OR UPDATE ON learner_stats
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
--> statement-breakpoint
CREATE TRIGGER deck_change_seq BEFORE INSERT OR UPDATE ON deck
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
--> statement-breakpoint
CREATE TRIGGER card_change_seq BEFORE INSERT OR UPDATE ON card
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
--> statement-breakpoint
CREATE TRIGGER media_asset_change_seq BEFORE INSERT OR UPDATE ON media_asset
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
--> statement-breakpoint
CREATE TRIGGER daily_activity_change_seq BEFORE INSERT OR UPDATE ON daily_activity
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
