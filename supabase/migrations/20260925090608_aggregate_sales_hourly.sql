select cron.alter_job(jobid, schedule := '10 * * * *')
from cron.job
where jobname = 'process_daily_aggregates_offset';
