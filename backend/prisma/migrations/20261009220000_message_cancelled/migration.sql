-- A message withdrawn before sending (B58): a reminder to answer, for a
-- household that answered while it waited in the outbox.
ALTER TYPE "MessageStatus" ADD VALUE 'CANCELLED';
