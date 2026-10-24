# Anonymous asset retention

`npm run cleanup` is a **dry run**. It reports counts, never identifiers, signed URLs or credentials. `npm run cleanup -- --execute` removes private assets, jobs and expired anonymous reels after RETENTION_DAYS (default 7), preserving active worker jobs, unresolved/future publications and all non-anonymous users. The script does not delete auth users. Keep server credentials in a protected environment file outside source control.

No cleanup has been scheduled or executed by this change. On a trusted host you may schedule a daily invocation of `npm run cleanup -- --execute` with your scheduler and an exclusive execution lock. Review a dry run first and retain backups according to your policy. Avoid running cleanup concurrently with active writes; use a maintenance window. Storage removal happens before database deletion so failures remain discoverable and retriable.
