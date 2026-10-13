-- Feedback reconciliation uses receipt keys and pending-work clocks. There
-- is no message-id lookup in the provider-neutral implementation.
DROP INDEX "email_feedback_messageId_idx";
