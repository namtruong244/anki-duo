CREATE TABLE "note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"note_type_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "note_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"templates" jsonb NOT NULL,
	"css" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"change_seq" bigint,
	CONSTRAINT "note_type_name_length" CHECK ("note_type"."deleted_at" is not null or char_length("note_type"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "card" DROP CONSTRAINT "card_front_length";--> statement-breakpoint
ALTER TABLE "card" DROP CONSTRAINT "card_back_length";--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "note_id" uuid;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "note_type_id" uuid;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "format" text DEFAULT 'markdown' NOT NULL;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_deck_id_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_note_type_id_note_type_id_fk" FOREIGN KEY ("note_type_id") REFERENCES "public"."note_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_type" ADD CONSTRAINT "note_type_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_deck_idx" ON "note" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "note_type_idx" ON "note" USING btree ("note_type_id");--> statement-breakpoint
CREATE INDEX "note_user_idx" ON "note" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_type_user_name_unique" ON "note_type" USING btree ("user_id",lower("name")) WHERE "note_type"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "note_type_user_seq_idx" ON "note_type" USING btree ("user_id","change_seq");--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_note_idx" ON "card" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_note_template_unique" ON "card" USING btree ("note_id","template_id") WHERE "card"."deleted_at" is null and "card"."note_id" is not null;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_format" CHECK ("card"."format" in ('markdown', 'html'));--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_front_length" CHECK ("card"."deleted_at" is not null or char_length("card"."front") between 1 and 100000);--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_back_length" CHECK (char_length("card"."back") <= 100000);--> statement-breakpoint
CREATE TRIGGER note_type_change_seq BEFORE INSERT OR UPDATE ON note_type
  FOR EACH ROW EXECUTE FUNCTION set_change_seq();
