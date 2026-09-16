-- A queued draft has no date yet: the date is what day a lesson went out, and that is only known when it
-- goes out. `releaseEdition` stamps it. Editions built before the queue keep the date they were built for.
alter table editions alter column date drop not null;

-- The release job takes the oldest approved edition; the editions_status_date_idx above is ordered by
-- date, which is now null for everything in the queue.
create index if not exists editions_queue_idx on editions(status, n) where status = 'approved';

-- What the editor asked to be changed about a draft, recorded when they press "request changes" so the
-- next builder run can read it. Kept on the edition rather than in a side table: it is one note per draft
-- and it is only interesting while the draft is alive.
alter table editions add column if not exists revision_note text;
alter table editions add column if not exists approved_at timestamptz;

-- One queue warning a day, however many times the cron fires. `week_key` carries the local date here,
-- the same way kind='cap' uses it (see 20260908130000_cap_send_kind.sql).
create unique index if not exists sends_queue_once on sends(kind, week_key) where kind = 'queue';
