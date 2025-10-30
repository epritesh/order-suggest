param(
  [string]$Base = 'https://ordersuggest-903975067.development.catalystserverless.com/server/order_suggest_function',
  [string]$JobId = 'job_1761775669940_umkwfo',
  [int]$Batch = 20,
  [int]$Conc = 4,
  [int]$Group = 6,
  [int]$InvoicePages = 1,
  [int]$SuccessDelayMs = 900
)

# Runs precompute/run in a loop, backing off on transient/limit errors.
# Continues until the job reports status=done or the process is stopped.
$ErrorActionPreference = 'Stop'
$noProgressCount = 0
$lastProcessed = -1
$backoffSchedule = @(30, 60, 120) # seconds
$backoffIndex = 0

while ($true) {
  try {
    $url = "$Base/precompute/run?job_id=$JobId&batch=$Batch&conc=$Conc&group=$Group&invoicePages=$InvoicePages"
    $run = Invoke-RestMethod -Method POST -Uri $url
    $msg = "status={0} processed={1}/{2} progress={3}%" -f $run.status, $run.processed_items, $run.total_items, $run.progress
    $msg | Write-Host

    if ($run.status -eq 'done') { break }

    if ($run.processed_items -gt $lastProcessed) {
      $lastProcessed = [int]$run.processed_items
      $noProgressCount = 0
      $backoffIndex = 0
      Start-Sleep -Milliseconds $SuccessDelayMs
    } else {
      # No movement this attempt; short pause to avoid hammering
      $noProgressCount += 1
      Start-Sleep -Seconds 5
    }
  } catch {
    # Transient/limit; back off gradually
    $delay = $backoffSchedule[[Math]::Min($backoffIndex, $backoffSchedule.Count - 1)]
    "Transient/limit encountered. Backing off for {0}s..." -f $delay | Write-Host
    Start-Sleep -Seconds $delay
    if ($backoffIndex -lt $backoffSchedule.Count - 1) { $backoffIndex += 1 }
  }
}
