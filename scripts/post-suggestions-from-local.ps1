param(
  [string]$FunctionUrl,
  [string]$AdminToken,
  [string]$LocalCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_local.csv')",
  [int]$Months = 6,
  [int]$BatchSize = 400
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $LocalCsv)) { throw "Local suggestions not found: $LocalCsv. Run validate-from-data.ps1 first." }
if (-not $FunctionUrl) { throw "-FunctionUrl is required" }
if (-not $AdminToken) { throw "-AdminToken is required" }

function Join-Url([string]$base, [string]$path) {
  if ([string]::IsNullOrWhiteSpace($base)) { return $path }
  if ([string]::IsNullOrWhiteSpace($path)) { return $base }
  $b = $base.TrimEnd('/')
  $p = $path.TrimStart('/')
  return "$b/$p"
}

$rows = Import-Csv -Path $LocalCsv
$payload = @()
foreach ($r in $rows) {
  $sku = $r.SKU
  if ([string]::IsNullOrWhiteSpace($sku)) { continue }
  $sq = 0; [void][int]::TryParse("" + $r.SuggestedQty, [ref]$sq)
  $cs = 0; [void][int]::TryParse("" + $r.CurrentStock, [ref]$cs)
  if ($sq -le 0) { continue }
  $payload += [pscustomobject]@{
    sku = $sku
    description = $r.Description
    current_stock = $cs
    suggested_quantity = $sq
    priority_level = 'medium'
    reason = 'CSV ingestion baseline'
    estimated_cost = 0
    days_until_stockout = $null
  }
}

Write-Host ("Posting {0} suggestions from local CSV ..." -f $payload.Count)
$headers = @{ 'x-admin-token' = $AdminToken; 'Content-Type' = 'application/json' }
$uri = Join-Url $FunctionUrl 'suggestions/ingest'
$body = @{ rows = $payload; months = $Months } | ConvertTo-Json -Depth 6
$resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body

Write-Host ("Ingested suggestions: job_id={0}, inserted={1}" -f $resp.job_id, $resp.inserted)

Write-Host "Fetching DB-first suggestions ..."
$sugg = Invoke-RestMethod -Method Get -Uri (Join-Url $FunctionUrl 'suggestions')
if ($sugg -and $sugg.success) {
  Write-Host ("Backend now serving {0} suggestions from job {1}" -f $sugg.suggestions.Count, $sugg.job_id)
} else {
  Write-Host ("Fetch result: {0}" -f ($sugg | ConvertTo-Json -Depth 5))
}
