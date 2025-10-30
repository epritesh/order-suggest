param(
  [string]$DataRoot = "$(Join-Path $PSScriptRoot '..' 'DATA')",
  [int]$WindowDays = 180,
  [int]$TargetDaysOfCover = 45,
  [string[]]$ExcludePrefixes = @('0-','800-','2000-'),
  [string]$ItemsFile = 'Item.csv',
  [string]$InvoiceDir = 'Invoice',
  [string]$OutCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_local.csv')",
  [int]$Top = 50
)

$ErrorActionPreference = 'Stop'

# Resolve paths
$itemsPath = Join-Path $DataRoot $ItemsFile
$invPath = Join-Path $DataRoot $InvoiceDir
if (!(Test-Path $itemsPath)) { throw "Items file not found: $itemsPath" }
if (!(Test-Path $invPath)) { throw "Invoice dir not found: $invPath" }

# Load Items and build stock map
Write-Host "Loading items from $itemsPath ..."
$items = Import-Csv -Path $itemsPath
# Some exports may name it 'Stock On Hand' or 'Stock On Hand ' - normalize key lookup
function Get-Column {
  param([object]$row, [string[]]$candidates)
  $names = @()
  if ($null -ne $row -and $row.PSObject -and $row.PSObject.Properties) {
    $names = $row.PSObject.Properties.Name
  }
  foreach ($c in $candidates) { if ($names -contains $c) { return $c } }
  return $null
}

# Prepare maps
$stockBySku = @{}
$descBySku = @{}
$excludeRegex = '^(0-|800-|2000-)'

foreach ($row in $items) {
  $sku = $row.SKU
  if ([string]::IsNullOrWhiteSpace($sku)) { continue }
  if ($sku -match $excludeRegex) { continue }
  $stockCol = Get-Column -row $row -candidates @('Stock On Hand','Stock On Hand ')
  $desc = $row.'Item Name'
  $stock = 0
  if ($stockCol) {
    [void][int]::TryParse(($row.$stockCol -replace '[^0-9\-]', ''), [ref]$stock)
  }
  $stockBySku[$sku] = $stock
  if ($desc) { $descBySku[$sku] = $desc }
}

# Aggregate invoice quantities by SKU within window
$cutoff = (Get-Date).Date.AddDays(-$WindowDays)
Write-Host ("Aggregating invoices since {0:yyyy-MM-dd} from {1} ..." -f $cutoff, $invPath)
$qtyBySku = @{}

Get-ChildItem -Path $invPath -Filter *.csv | ForEach-Object {
  Write-Host "Reading $($_.FullName) ..."
  $rows = Import-Csv -Path $_.FullName
  foreach ($r in $rows) {
    $sku = $r.SKU
    if ([string]::IsNullOrWhiteSpace($sku)) { continue }
    if ($sku -match $excludeRegex) { continue }
    # Parse date
    $ds = $r.'Invoice Date'
    if ([string]::IsNullOrWhiteSpace($ds)) { continue }
  $d = $null
  try { $d = [datetime]::ParseExact($ds, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) } catch { continue }
    if ($d -lt $cutoff) { continue }
  # Parse qty
  $qs = ("" + $r.Quantity).Trim()
  if ([string]::IsNullOrWhiteSpace($qs)) { continue }
  $q = $null
  try { $q = [double]::Parse($qs, [System.Globalization.CultureInfo]::InvariantCulture) } catch { continue }
  if ($q -le 0) { continue }
    if ($qtyBySku.ContainsKey($sku)) { $qtyBySku[$sku] += $q } else { $qtyBySku[$sku] = $q }
  }
}

# Compute suggestions
$results = @()
if ($WindowDays -le 0) { throw "WindowDays must be > 0" }
$avgDailyBySku = @{}
foreach ($kv in $qtyBySku.GetEnumerator()) {
  $sku = $kv.Key
  $totalQty = [double]$kv.Value
  $avgDaily = $totalQty / [double]$WindowDays
  $avgDailyBySku[$sku] = $avgDaily
  $targetQty = [math]::Ceiling($avgDaily * [double]$TargetDaysOfCover)
  $current = 0
  if ($stockBySku.ContainsKey($sku)) { $current = [int]$stockBySku[$sku] }
  $suggest = [int]([math]::Max(0, $targetQty - $current))
  $desc = $descBySku[$sku]
  $results += [pscustomobject]@{
    SKU = $sku
    Description = $desc
    CurrentStock = $current
    TotalQtyInWindow = [math]::Round($totalQty,2)
    AvgDaily = [math]::Round($avgDaily,4)
    TargetDaysOfCover = $TargetDaysOfCover
    SuggestedQty = $suggest
  }
}

# Sort by highest suggested qty
$results = $results | Sort-Object -Property SuggestedQty -Descending

# Write CSV
Write-Host "Writing output to $OutCsv ..."
$results | Export-Csv -Path $OutCsv -NoTypeInformation -Encoding UTF8

# Print top N
Write-Host "Top $Top suggestions:"
$results | Select-Object -First $Top | Format-Table -AutoSize SKU,CurrentStock,TotalQtyInWindow,AvgDaily,SuggestedQty,Description
