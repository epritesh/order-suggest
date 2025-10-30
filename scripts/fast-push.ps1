param(
  [string]$Base = 'https://ordersuggest-903975067.development.catalystserverless.com/server/order_suggest_function',
  [string]$JobId = 'job_1761775669940_umkwfo',
  [int]$Batch = 24,
  [int]$Conc = 5,
  [int]$Group = 8,
  [int]$InvoicePages = 1,
  [int]$DelayMs = 900,
  [int]$Max = 60
)

$ErrorActionPreference = 'Stop'
for ($i=1; $i -le $Max; $i++) {
  try {
    $url = "$Base/precompute/run?job_id=$JobId&batch=$Batch&conc=$Conc&group=$Group&invoicePages=$InvoicePages"
    $run = Invoke-RestMethod -Method POST -Uri $url
    "{0}: status={1} processed={2}/{3} progress={4}%" -f $i, $run.status, $run.processed_items, $run.total_items, $run.progress | Write-Host
    if ($run.status -eq 'done') { break }
    Start-Sleep -Milliseconds $DelayMs
  } catch {
    "Run {0} limit/transient; stopping fast push." -f $i | Write-Host
    break
  }
}
