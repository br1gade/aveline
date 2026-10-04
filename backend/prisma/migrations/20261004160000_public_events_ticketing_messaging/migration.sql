-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "TicketOrderStatus" AS ENUM ('RESERVED', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'USED', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "visibility" "EventVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "event_listings" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "body" JSONB NOT NULL DEFAULT '{}',
    "heroAssetId" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ogTitle" JSONB NOT NULL DEFAULT '{}',
    "ogDescription" JSONB NOT NULL DEFAULT '{}',
    "ogImageId" TEXT,
    "isIndexable" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" JSONB NOT NULL DEFAULT '{}',
    "description" JSONB NOT NULL DEFAULT '{}',
    "priceMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AMD',
    "quantityTotal" INTEGER NOT NULL,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "minPerOrder" INTEGER NOT NULL DEFAULT 1,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 10,
    "salesStartAt" TIMESTAMP(3),
    "salesEndAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_orders" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'hy',
    "status" "TicketOrderStatus" NOT NULL DEFAULT 'RESERVED',
    "totalMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AMD',
    "paymentOrderNumber" TEXT,
    "reservesUntil" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,

    CONSTRAINT "ticket_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "holderName" TEXT,
    "holderEmail" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "guestId" TEXT,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "key" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" JSONB NOT NULL DEFAULT '{}',
    "body" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT,
    "guestId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "templateKey" TEXT,
    "toAddress" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'hy',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_imports" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "guest_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_listings_eventId_key" ON "event_listings"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_listings_slug_key" ON "event_listings"("slug");

-- CreateIndex
CREATE INDEX "event_listings_publishedAt_idx" ON "event_listings"("publishedAt");

-- CreateIndex
CREATE INDEX "ticket_types_eventId_isActive_idx" ON "ticket_types"("eventId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_orders_paymentOrderNumber_key" ON "ticket_orders"("paymentOrderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_orders_idempotencyKey_key" ON "ticket_orders"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_orders_accessToken_key" ON "ticket_orders"("accessToken");

-- CreateIndex
CREATE INDEX "ticket_orders_eventId_status_idx" ON "ticket_orders"("eventId", "status");

-- CreateIndex
CREATE INDEX "ticket_orders_status_reservesUntil_idx" ON "ticket_orders"("status", "reservesUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_order_items_orderId_ticketTypeId_key" ON "ticket_order_items"("orderId", "ticketTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_guestId_key" ON "tickets"("guestId");

-- CreateIndex
CREATE INDEX "tickets_eventId_status_idx" ON "tickets"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_organizationId_key_channel_key" ON "message_templates"("organizationId", "key", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "messages_dedupeKey_key" ON "messages"("dedupeKey");

-- CreateIndex
CREATE INDEX "messages_status_scheduledFor_idx" ON "messages"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "messages_eventId_idx" ON "messages"("eventId");

-- CreateIndex
CREATE INDEX "guest_imports_eventId_idx" ON "guest_imports"("eventId");

-- AddForeignKey
ALTER TABLE "event_listings" ADD CONSTRAINT "event_listings_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_listings" ADD CONSTRAINT "event_listings_heroAssetId_fkey" FOREIGN KEY ("heroAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_order_items" ADD CONSTRAINT "ticket_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ticket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_order_items" ADD CONSTRAINT "ticket_order_items_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ticket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_imports" ADD CONSTRAINT "guest_imports_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────
-- Inventory invariant.
--
-- TicketInventoryService reserves with a single conditional UPDATE, which is
-- atomic in Postgres and is what actually prevents overselling. This CHECK is
-- the backstop: if any future code path ever writes these counters directly,
-- the database refuses rather than quietly selling seats that do not exist.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "ticket_types"
  ADD CONSTRAINT "ticket_types_capacity_not_exceeded"
  CHECK ("quantitySold" + "quantityReserved" <= "quantityTotal");

ALTER TABLE "ticket_types"
  ADD CONSTRAINT "ticket_types_counters_non_negative"
  CHECK ("quantitySold" >= 0 AND "quantityReserved" >= 0 AND "quantityTotal" >= 0);
