param(
  [string]$Base = 'https://ordersuggest-903975067.development.catalystserverless.com/server/order_suggest_function',
  [string]$JobId = 'job_1761775669940_umkwfo'
)

$ErrorActionPreference = 'Stop'
for ($i=1; $i -le 10; $i++) {
  try {
    $url = "$Base/precompute/run?job_id=$JobId&batch=8&conc=2&group=4&invoicePages=2"
    $run = Invoke-RestMethod -Method POST -Uri $url
    "{0}: status={1} processed={2}/{3} progress={4}%" -f $i, $run.status, $run.processed_items, $run.total_items, $run.progress | Write-Host
    if ($run.status -eq 'done') { break }
    Start-Sleep -Seconds 120
  } catch {
    "Run {0} limit/transient; stopping slow probe." -f $i | Write-Host
    break
  }
}
