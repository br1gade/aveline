-- Reconfirming the same choices must not evict every personalized page.
CREATE OR REPLACE FUNCTION refresh_venue_attendance(target_event text, target_guest text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE rsvps r SET status = summary.status, "respondedAt" = summary.responded_at, "updatedAt" = CURRENT_TIMESTAMP
  FROM (
    SELECT g.id,
      CASE WHEN bool_or(a.status = 'ATTENDING') THEN 'ATTENDING'
           WHEN count(v.id) = 0 OR count(a.id) < count(v.id) OR bool_or(a.status = 'PENDING') THEN 'PENDING'
           WHEN bool_or(a.status = 'UNDECIDED') THEN 'UNDECIDED'
           ELSE 'DECLINED' END::"RsvpStatus" AS status,
      min(a."respondedAt") AS responded_at
    FROM guests g JOIN events e ON e.id = g."eventId" AND e."attendanceMode" = 'PER_VENUE'
    LEFT JOIN venues v ON v."eventId" = e.id AND v.role <> 'PREPARATION'
      AND (NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND t."isInternal")
        OR EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND NOT t."isInternal"))
    LEFT JOIN attendance_responses a ON a."guestId" = g.id AND a.revision = e."attendanceRevision" AND a."venueId" = v.id
    WHERE e.id = target_event AND (target_guest IS NULL OR g.id = target_guest)
    GROUP BY g.id
  ) summary WHERE r."guestId" = summary.id AND (r.status, r."respondedAt") IS DISTINCT FROM (summary.status, summary.responded_at);
$$;
