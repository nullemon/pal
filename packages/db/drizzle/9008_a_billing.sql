-- Agent A · Billing (docs/17 §A, docs/07 "Subscriptions").
-- Plans gain the feature set they grant and an on/off switch so the operator changes what a
-- tier unlocks without a deploy; `billing_customers` links an account to its Stripe customer
-- before the first Checkout session (so a webhook can resolve the user from `customer`
-- alone) and `billing_receipts` is the invoice history /me/billing links to.

ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint

UPDATE "plans" SET "features" = ARRAY['no_ads']::text[]
  WHERE "id" = 'supporter' AND cardinality("features") = 0;--> statement-breakpoint
UPDATE "plans" SET "features" = ARRAY['no_ads','early_access','premium_content','offline']::text[]
  WHERE "id" = 'premium' AND cardinality("features") = 0;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_customers" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"stripe_subscription_id" text,
	"description" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_receipts_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "billing_receipts" ADD CONSTRAINT "billing_receipts_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "billing_receipts_user_idx" ON "billing_receipts" USING btree ("user_id","issued_at" DESC);
