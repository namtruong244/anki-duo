DROP INDEX "card_note_template_unique";--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "interaction" jsonb;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "answer_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "deck" ADD COLUMN "mc_practice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "extra" jsonb;--> statement-breakpoint
ALTER TABLE "note_type" ADD COLUMN "kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "note_type" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "note_type" ADD COLUMN "builtin_key" text;--> statement-breakpoint
ALTER TABLE "learner_settings" ADD COLUMN "auto_grade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "card_note_ordinal_unique" ON "card" USING btree ("note_id","template_id","ordinal") WHERE "card"."deleted_at" is null and "card"."note_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "note_type_user_builtin_unique" ON "note_type" USING btree ("user_id","builtin_key") WHERE "note_type"."deleted_at" is null and "note_type"."builtin_key" is not null;--> statement-breakpoint
ALTER TABLE "note_type" ADD CONSTRAINT "note_type_kind" CHECK ("note_type"."kind" in ('standard', 'cloze', 'image_occlusion', 'multiple_choice'));
--> statement-breakpoint
-- Backfill builtin_key for rows matching the three 001 built-ins (name + templates); best effort.
UPDATE "note_type" SET "builtin_key" = 'basic' WHERE "builtin_key" IS NULL AND "deleted_at" IS NULL AND "name" = 'Basic' AND "templates" = '[{"id":"t_card1","name":"Card 1","front":"{{Front}}","back":"{{FrontSide}}<hr id=answer>{{Back}}"}]'::jsonb;--> statement-breakpoint
UPDATE "note_type" SET "builtin_key" = 'basic_reversed' WHERE "builtin_key" IS NULL AND "deleted_at" IS NULL AND "name" = 'Basic (and reversed card)' AND "templates" = '[{"id":"t_card1","name":"Card 1","front":"{{Front}}","back":"{{FrontSide}}<hr id=answer>{{Back}}"},{"id":"t_card2","name":"Card 2","front":"{{Back}}","back":"{{FrontSide}}<hr id=answer>{{Front}}"}]'::jsonb;--> statement-breakpoint
UPDATE "note_type" SET "builtin_key" = 'basic_optional_reversed' WHERE "builtin_key" IS NULL AND "deleted_at" IS NULL AND "name" = 'Basic (optional reversed card)' AND "templates" = '[{"id":"t_card1","name":"Card 1","front":"{{Front}}","back":"{{FrontSide}}<hr id=answer>{{Back}}"},{"id":"t_card2","name":"Card 2","front":"{{#Add Reverse}}{{Back}}{{/Add Reverse}}","back":"{{FrontSide}}<hr id=answer>{{Front}}"}]'::jsonb;
