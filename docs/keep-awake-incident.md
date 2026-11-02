# Keep-awake correction — 2026-11-02

GitHub's public workflow history showed scheduled runs at 12:41, 18:08, 22:00 UTC on November 1 and 01:28 UTC on November 2 despite the five-minute cron. Successful runs hours apart cannot prevent Render's 15-minute idle shutdown. The pasted shutdown/startup log does not identify whether that particular restart was deployment, idle shutdown, or platform maintenance.

The frontend now immediately requests the configured API's `/api/health` on any visible page, including pre-login, then every two minutes after success. Failures retry after 20 seconds; a request has a 90-second cold-start timeout. Requests never overlap, contain no credentials, make no AI/Sheets calls, and stop on unmount, offline, or hidden tabs. Returning to the tab or reconnecting requests health again. No page reload discards student work.

GitHub Actions remains a best-effort fallback; workflow/script pushes also trigger an immediate check. It is not a reliable unattended scheduler.

## Required for unattended idle prevention

No external scheduler account is connected yet. Create a free account at https://console.cron-job.org/signup and create this job:

- Title: Dawnstudy API keep-awake
- URL: `https://dawnstudy-api.onrender.com/api/health`
- Method: GET; no credentials or request body
- Schedule: every 5 minutes, all hours and days
- Enable failure and recovery notifications
- Run once manually, then confirm recurring executions in its history

Monitor the Render API directly. Requesting only the Vercel homepage does not reach Render. Configure a separate homepage monitor if desired.

An external job reduces idle sleeping; it cannot stop deployments or Render platform restarts. An always-on compute plan is a hosting decision requiring the owner's approval.

References: https://docs.github.com/en/actions/how-tos/troubleshoot-workflows , https://render.com/docs/free , https://cron-job.org/en/
