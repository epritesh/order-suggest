param(
  [string]$LocalCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_local.csv')",
  [string]$BackendCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_backend.csv')",
  [string]$OutDiffCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_diff.csv')",
  [int]$Top = 50
)

$ErrorActionPreference = 'Stop'
if (!(Test-Path $LocalCsv)) { throw "Local suggestions not found: $LocalCsv" }
if (!(Test-Path $BackendCsv)) { throw "Backend suggestions not found: $BackendCsv" }

$local = Import-Csv -Path $LocalCsv
$back = Import-Csv -Path $BackendCsv

$mapL = @{}
foreach ($r in $local) { if ($r.SKU) { $mapL[$r.SKU] = $r } }
$mapB = @{}
foreach ($r in $back) { if ($r.SKU) { $mapB[$r.SKU] = $r } }

$skus = New-Object System.Collections.Generic.HashSet[string]
foreach ($k in $mapL.Keys) { [void]$skus.Add($k) }
foreach ($k in $mapB.Keys) { [void]$skus.Add($k) }

$diff = @()
foreach ($sku in $skus) {
  $l = $mapL[$sku]
  $b = $mapB[$sku]
  $lq = 0; if ($l) { [void][int]::TryParse("" + $l.SuggestedQty, [ref]$lq) }
  $bq = 0; if ($b) { [void][int]::TryParse("" + $b.SuggestedQty, [ref]$bq) }
  if ($lq -ne $bq) {
    $diff += [pscustomobject]@{
      SKU = $sku
      LocalSuggested = $lq
      BackendSuggested = $bq
      AbsDiff = [math]::Abs($lq - $bq)
      LocalCurrent = if ($l) { $l.CurrentStock } else { '' }
      BackendCurrent = if ($b) { $b.CurrentStock } else { '' }
      LocalDescription = if ($l) { $l.Description } else { '' }
      BackendDescription = if ($b) { $b.Description } else { '' }
    }
  }
}

$diff = $diff | Sort-Object -Property AbsDiff -Descending
$diff | Export-Csv -Path $OutDiffCsv -NoTypeInformation -Encoding UTF8

Write-Host ("Found {0} SKUs with differing suggestions. Top {1}:" -f $diff.Count, [math]::Min($Top, $diff.Count))
$diff | Select-Object -First $Top | Format-Table -AutoSize SKU,LocalSuggested,BackendSuggested,AbsDiff
