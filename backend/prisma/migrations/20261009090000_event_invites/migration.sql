-- Invitations to work on one event. A new, empty table: safe on a populated database.

-- CreateTable
CREATE TABLE "event_invites" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "EventRole" NOT NULL,
    "invitedByUserId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_invites_tokenHash_key" ON "event_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "event_invites_email_idx" ON "event_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "event_invites_eventId_email_key" ON "event_invites"("eventId", "email");

-- AddForeignKey
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

