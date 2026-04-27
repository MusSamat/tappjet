-- Add 'viewed' to the bookings status check constraint
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status::text = ANY (ARRAY[
    'pending', 'viewed', 'accepted', 'rejected',
    'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_late',
    'no_show', 'completed', 'expired'
  ]::text[]));
