param(
  [string]$Base = 'https://ordersuggest-903975067.development.catalystserverless.com/server/order_suggest_function',
  [string]$JobId = 'job_1761775669940_umkwfo',
  [int]$Batch = 30,
  [int]$Conc = 6,
  [int]$Group = 10,
  [int]$InvoicePages = 1,
  [int]$SuccessDelayMs = 500
)

# Aggressive loop: short delay on success, short progressive backoff on errors.
# Continues until job is done or process is stopped.
$ErrorActionPreference = 'Stop'
$lastProcessed = -1
$backoffSchedule = @(10, 20, 40) # seconds
$backoffIndex = 0

while ($true) {
  try {
    $url = "$Base/precompute/run?job_id=$JobId&batch=$Batch&conc=$Conc&group=$Group&invoicePages=$InvoicePages"
    $run = Invoke-RestMethod -Method POST -Uri $url
    "status={0} processed={1}/{2} progress={3}%" -f $run.status, $run.processed_items, $run.total_items, $run.progress | Write-Host
    if ($run.status -eq 'done') { break }

    if ([int]$run.processed_items -gt $lastProcessed) {
      $lastProcessed = [int]$run.processed_items
      $backoffIndex = 0
      Start-Sleep -Milliseconds $SuccessDelayMs
    } else {
      # No movement; tiny pause
      Start-Sleep -Milliseconds 400
    }
  } catch {
    $delay = $backoffSchedule[[Math]::Min($backoffIndex, $backoffSchedule.Count - 1)]
    "Transient/limit. Backoff {0}s" -f $delay | Write-Host
    Start-Sleep -Seconds $delay
    if ($backoffIndex -lt $backoffSchedule.Count - 1) { $backoffIndex += 1 }
  }
}
