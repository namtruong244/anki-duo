CREATE TABLE "daily_activity" (
	"user_id" uuid NOT NULL,
	"study_day" date NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"goal_xp" smallint DEFAULT 20 NOT NULL,
	"all_available_done" boolean DEFAULT false NOT NULL,
	"goal_met" boolean DEFAULT false NOT NULL,
	"change_seq" bigint,
	CONSTRAINT "daily_activity_user_id_study_day_pk" PRIMARY KEY("user_id","study_day")
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"total_rows" integer NOT NULL,
	"mapping" jsonb,
	"duplicate_mode" text NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_job_rows" CHECK ("import_job"."total_rows" between 1 and 10000),
	CONSTRAINT "import_job_mode" CHECK ("import_job"."duplicate_mode" in ('skip', 'update', 'keep_both'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_bucket_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "review_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text DEFAULT 'review' NOT NULL,
	"grade" smallint,
	"reviewed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"was_new" boolean DEFAULT false NOT NULL,
	"was_due" boolean DEFAULT false NOT NULL,
	"study_ahead" boolean DEFAULT false NOT NULL,
	"xp" smallint DEFAULT 0 NOT NULL,
	"state_before" double precision[] NOT NULL,
	"state_after" double precision[] NOT NULL,
	"scheduler_version" text NOT NULL,
	"device_id" uuid,
	"revoked_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_seq" bigint,
	CONSTRAINT "review_log_kind" CHECK ("review_log"."kind" in ('review', 'reset')),
	CONSTRAINT "review_log_grade" CHECK (("review_log"."kind" = 'review' and "review_log"."grade" between 1 and 4) or "review_log"."kind" = 'reset'),
	CONSTRAINT "review_log_duration" CHECK ("review_log"."duration_ms" between 0 and 3600000),
	CONSTRAINT "review_log_state_len" CHECK (cardinality("review_log"."state_before") = 8 and cardinality("review_log"."state_after") = 8)
);
--> statement-breakpoint
CREATE TABLE "study_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"node_index" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"planned_count" smallint DEFAULT 0 NOT NULL,
	"cards_reviewed" smallint DEFAULT 0 NOT NULL,
	"correct_count" smallint DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"bonus_xp" smallint DEFAULT 0 NOT NULL,
	"study_day" date NOT NULL,
	CONSTRAINT "study_session_kind" CHECK ("study_session"."kind" in ('node', 'review', 'ahead')),
	CONSTRAINT "study_session_node" CHECK ("study_session"."kind" <> 'node' or "study_session"."node_index" is not null)
);
--> statement-breakpoint
CREATE TABLE "card" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"node_index" integer NOT NULL,
	"front" text DEFAULT '' NOT NULL,
	"back" text DEFAULT '' NOT NULL,
	"front_norm" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"learning_steps" smallint DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"change_seq" bigint,
	CONSTRAINT "card_front_length" CHECK ("card"."deleted_at" is not null or char_length("card"."front") between 1 and 10000),
	CONSTRAINT "card_back_length" CHECK (char_length("card"."back") <= 10000),
	CONSTRAINT "card_tags_count" CHECK (cardinality("card"."tags") <= 20),
	CONSTRAINT "card_state" CHECK ("card"."state" in ('new', 'learning', 'review', 'relearning')),
	CONSTRAINT "card_difficulty" CHECK ("card"."difficulty" between 0 and 10),
	CONSTRAINT "card_stability" CHECK ("card"."stability" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deck" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"new_cards_per_day" smallint DEFAULT 20 NOT NULL,
	"next_position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"change_seq" bigint,
	CONSTRAINT "deck_name_length" CHECK ("deck"."deleted_at" is not null or char_length("deck"."name") between 1 and 100),
	CONSTRAINT "deck_new_cards_per_day" CHECK ("deck"."new_cards_per_day" between 0 and 999)
);
--> statement-breakpoint
CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"change_seq" bigint,
	CONSTRAINT "media_asset_bytes" CHECK ("media_asset"."bytes" between 1 and 5242880),
	CONSTRAINT "media_asset_status" CHECK ("media_asset"."status" in ('pending', 'ready')),
	CONSTRAINT "media_asset_side" CHECK ("media_asset"."side" in ('front', 'back')),
	CONSTRAINT "media_asset_kind" CHECK ("media_asset"."kind" in ('image', 'audio'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"last_pull_seq" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"day_start_hour" smallint DEFAULT 4 NOT NULL,
	"desired_retention" numeric(3, 2) DEFAULT '0.90' NOT NULL,
	"maximum_interval_days" integer DEFAULT 36500 NOT NULL,
	"daily_xp_goal" smallint DEFAULT 20 NOT NULL,
	"session_size" smallint DEFAULT 20 NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"motion" text DEFAULT 'system' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_seq" bigint,
	CONSTRAINT "learner_settings_locale" CHECK ("learner_settings"."locale" in ('vi', 'en')),
	CONSTRAINT "learner_settings_day_start" CHECK ("learner_settings"."day_start_hour" between 0 and 23),
	CONSTRAINT "learner_settings_retention" CHECK ("learner_settings"."desired_retention" between 0.70 and 0.97),
	CONSTRAINT "learner_settings_max_interval" CHECK ("learner_settings"."maximum_interval_days" between 1 and 36500),
	CONSTRAINT "learner_settings_goal" CHECK ("learner_settings"."daily_xp_goal" in (10, 20, 30, 50)),
	CONSTRAINT "learner_settings_session_size" CHECK ("learner_settings"."session_size" between 5 and 50),
	CONSTRAINT "learner_settings_motion" CHECK ("learner_settings"."motion" in ('system', 'reduced', 'full'))
);
--> statement-breakpoint
CREATE TABLE "learner_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_goal_day" date,
	"card_count" integer DEFAULT 0 NOT NULL,
	"media_bytes" bigint DEFAULT 0 NOT NULL,
	"change_seq" bigint,
	CONSTRAINT "learner_stats_card_count" CHECK ("learner_stats"."card_count" between 0 and 20000),
	CONSTRAINT "learner_stats_media_bytes" CHECK ("learner_stats"."media_bytes" between 0 and 524288000)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_session" ADD CONSTRAINT "study_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_session" ADD CONSTRAINT "study_session_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck" ADD CONSTRAINT "deck_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_settings" ADD CONSTRAINT "learner_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_stats" ADD CONSTRAINT "learner_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_activity_seq_idx" ON "daily_activity" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "review_log_card_idx" ON "review_log" USING btree ("card_id","reviewed_at","id");--> statement-breakpoint
CREATE INDEX "review_log_user_day_idx" ON "review_log" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "study_session_user_day_idx" ON "study_session" USING btree ("user_id","study_day");--> statement-breakpoint
CREATE INDEX "card_queue_idx" ON "card" USING btree ("user_id","deck_id","state","due");--> statement-breakpoint
CREATE INDEX "card_node_idx" ON "card" USING btree ("deck_id","node_index");--> statement-breakpoint
CREATE INDEX "card_front_norm_idx" ON "card" USING btree ("deck_id","front_norm");--> statement-breakpoint
CREATE INDEX "card_user_seq_idx" ON "card" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "deck_user_name_unique" ON "deck" USING btree ("user_id",lower("name")) WHERE "deck"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "deck_user_seq_idx" ON "deck" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "media_asset_card_idx" ON "media_asset" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "media_asset_user_seq_idx" ON "media_asset" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "device_user_idx" ON "device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learner_settings_seq_idx" ON "learner_settings" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");