-- Chat channels for guests, and the provider-template mapping the channels
-- that refuse free text need.
--
-- Safe against a populated database: both columns on message_templates are
-- nullable or defaulted, and the new table starts empty. Existing templates
-- keep working unchanged, because a null providerTemplate means "send the
-- rendered body as it is", which is what email and Telegram do.
ALTER TABLE "message_templates"
  ADD COLUMN "providerTemplate" TEXT,
  ADD COLUMN "providerParams" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "guest_channels" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "optedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_channels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guest_channels_channel_address_idx" ON "guest_channels"("channel", "address");

-- One address per guest per channel: a second Telegram account for the same
-- guest replaces the first rather than adding to it, so an opt-in from a new
-- device cannot silently double every message.
CREATE UNIQUE INDEX "guest_channels_guestId_channel_key" ON "guest_channels"("guestId", "channel");

ALTER TABLE "guest_channels"
  ADD CONSTRAINT "guest_channels_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An address is the whole point of the row.
ALTER TABLE "guest_channels"
  ADD CONSTRAINT "guest_channels_address_not_blank" CHECK (length(btrim("address")) > 0);
