-- CreateTable
CREATE TABLE "email_send_quotas" (
    "scope" TEXT NOT NULL,
    "credits" BIGINT NOT NULL,
    "refilledAt" TIMESTAMP(3) NOT NULL,
    "dayStartedAt" TIMESTAMP(3) NOT NULL,
    "usedToday" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_send_quotas_pkey" PRIMARY KEY ("scope")
);


ALTER TABLE "email_send_quotas" ADD CONSTRAINT "email_quota_nonnegative" CHECK ("credits" >= 0 AND "usedToday" >= 0);
