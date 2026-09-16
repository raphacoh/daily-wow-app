-- The reviewed queue: the builder works ahead, the editor approves at their own pace, and one approved
-- edition is released per day. `approved` is the state between "a draft exists" and "families got it".
-- (An enum value must be committed before anything uses it, hence its own migration.)
alter type edition_status add value if not exists 'approved';

-- Mail the app now sends on the editor's behalf, so the pipeline needs no personal mail account:
--   'menu'   — the topic slate, with one-click picks
--   'review' — a draft is ready, with preview / approve / hold links
--   'queue'  — the queue is running low, or ran dry on a release morning
alter type send_kind add value if not exists 'menu';
alter type send_kind add value if not exists 'review';
alter type send_kind add value if not exists 'queue';
