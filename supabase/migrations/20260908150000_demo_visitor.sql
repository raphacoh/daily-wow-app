-- demo sessions remember the (daily-rotating, anonymous) visitor hash so one visitor cannot drain the shared demo pool
alter table arto_sessions add column if not exists visitor text;
