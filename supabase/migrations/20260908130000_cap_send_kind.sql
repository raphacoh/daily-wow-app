-- New send kind for the parent notice when a kid hits the free assistant cap.
-- (An enum value must be committed before anything uses it, hence its own migration.)
alter type send_kind add value if not exists 'cap';
