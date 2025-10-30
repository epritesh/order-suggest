param(
  [string]$LocalCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_local.csv')",
  [string]$OutJson = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_local.json')"
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $LocalCsv)) { throw "Local suggestions not found: $LocalCsv. Run validate-from-data.ps1 first." }

$rows = Import-Csv -Path $LocalCsv
$payload = @()
foreach ($r in $rows) {
  $sku = $r.SKU
  if ([string]::IsNullOrWhiteSpace($sku)) { continue }
  $sq = 0; [void][int]::TryParse("" + $r.SuggestedQty, [ref]$sq)
  $cs = 0; [void][int]::TryParse("" + $r.CurrentStock, [ref]$cs)
  if ($sq -le 0) { continue }
  if ($sku -like '0-*' -or $sku -like '800-*' -or $sku -like '2000-*') { continue }
  $payload += [pscustomobject]@{
    sku = $sku
    description = $r.Description
    current_stock = $cs
    suggested_quantity = $sq
    priority_level = 'medium'
    reason = 'CSV ingestion baseline (export)'
    estimated_cost = 0
    days_until_stockout = $null
  }
}

$jobId = "local_" + (Get-Date -Format 'yyyyMMddHHmmss')
$doc = [pscustomobject]@{ job_id = $jobId; rows = $payload }
$doc | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -Path $OutJson
Write-Host ("Wrote {0} rows to {1}" -f $payload.Count, $OutJson)
