param(
  [string]$DataRoot = "$(Join-Path $PSScriptRoot '..' 'DATA')",
  [string]$FunctionUrl,
  [string]$AdminToken,
  [int]$WindowMonths = 6,
  [string[]]$ExcludePrefixes = @('0-','800-','2000-'),
  [string]$ItemsFile = 'Item.csv',
  [string]$InvoiceDir = 'Invoice',
  [switch]$DryRun,
  [int]$BatchSize = 400,
  [string]$OutBackendCsv = "$(Join-Path $PSScriptRoot '..' 'DATA' '_suggestions_backend.csv')"
)

$ErrorActionPreference = 'Stop'

function Get-Column {
  param([object]$row, [string[]]$candidates)
  $names = @()
  if ($null -ne $row -and $row.PSObject -and $row.PSObject.Properties) {
    $names = $row.PSObject.Properties.Name
  }
  foreach ($c in $candidates) { if ($names -contains $c) { return $c } }
  return $null
}

function ParseDecimal([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return 0 }
  $t = ($s -replace '[^0-9,\.\-]', '')
  try { return [double]::Parse($t, [System.Globalization.CultureInfo]::InvariantCulture) } catch { return 0 }
}

function MonthStartStr([datetime]$d) {
  return ([datetime]::new($d.Year, $d.Month, 1)).ToString('yyyy-MM-01 00:00:00')
}

function Join-Url([string]$base, [string]$path) {
  if ([string]::IsNullOrWhiteSpace($base)) { return $path }
  if ([string]::IsNullOrWhiteSpace($path)) { return $base }
  $b = $base.TrimEnd('/')
  $p = $path.TrimStart('/')
  return "$b/$p"
}

$itemsPath = Join-Path $DataRoot $ItemsFile
$invPath = Join-Path $DataRoot $InvoiceDir
if (!(Test-Path $itemsPath)) { throw "Items file not found: $itemsPath" }
if (!(Test-Path $invPath)) { throw "Invoice dir not found: $invPath" }

$excludeRegex = '^(0-|800-|2000-)' 

Write-Host "Loading items from $itemsPath ..."
$items = Import-Csv -Path $itemsPath
$stockRows = @()
$purchaseRateCol = Get-Column -row ($items | Select-Object -First 1) -candidates @('Purchase Rate','Purchase Rate ')
$stockCol = Get-Column -row ($items | Select-Object -First 1) -candidates @('Stock On Hand','Stock On Hand ')
foreach ($row in $items) {
  $sku = $row.SKU
  if ([string]::IsNullOrWhiteSpace($sku)) { continue }
  if ($sku -match $excludeRegex) { continue }
  $stock = 0
  if ($stockCol) { [void][int]::TryParse(($row.$stockCol -replace '[^0-9\-]', ''), [ref]$stock) }
  $cost = 0
  if ($purchaseRateCol) { $cost = ParseDecimal $row.$purchaseRateCol }
  $stockRows += [pscustomobject]@{
    sku = $sku
    current_stock = $stock
    cost_price = $cost
  }
}

# Aggregate invoices to monthly levels
Write-Host "Aggregating invoices from $invPath over last $WindowMonths months ..."
$fromDate = (Get-Date).Date.AddMonths(-$WindowMonths)
$agg = @{}
$files = Get-ChildItem -Path $invPath -Filter *.csv | Sort-Object Name
foreach ($f in $files) {
  Write-Host "Reading $($f.FullName) ..."
  $rows = Import-Csv -Path $f.FullName
  foreach ($r in $rows) {
    $status = $r.'Invoice Status'
    if ($status -and $status -eq 'Void') { continue }
    $sku = $r.SKU
    if ([string]::IsNullOrWhiteSpace($sku)) { continue }
    if ($sku -match $excludeRegex) { continue }
    $ds = $r.'Invoice Date'
    if ([string]::IsNullOrWhiteSpace($ds)) { continue }
    $d = $null
    try { $d = [datetime]::ParseExact($ds, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) } catch { continue }
    if ($d -lt $fromDate) { continue }
    $qty = ParseDecimal ("" + $r.Quantity)
    if ($qty -le 0) { continue }
    $rev = ParseDecimal ("" + $r.'Item Total')
    $key = "{0}|{1}" -f (MonthStartStr $d), $sku
    if (-not $agg.ContainsKey($key)) { $agg[$key] = @{ month_start = (MonthStartStr $d); sku = $sku; qty_sold = 0.0; revenue = 0.0 } }
    $agg[$key].qty_sold += $qty
    $agg[$key].revenue += $rev
  }
}
$aggregateRows = $agg.Values | ForEach-Object { [pscustomobject]$_ } | Sort-Object month_start, sku

Write-Host ("Prepared {0} stock rows, {1} aggregate rows" -f $stockRows.Count, $aggregateRows.Count)

if ($DryRun) {
  Write-Host "DryRun: showing first 5 stock rows and first 5 aggregate rows"
  $stockRows | Select-Object -First 5 | Format-Table -AutoSize
  $aggregateRows | Select-Object -First 5 | Format-Table -AutoSize
  return
}

if (-not $FunctionUrl) { throw "-FunctionUrl is required when not -DryRun" }
if (-not $AdminToken) { throw "-AdminToken is required when not -DryRun" }

# Helper to POST JSON in chunks
function Invoke-PostChunks($url, $rows, $extra = @{}) {
  $headers = @{ 'x-admin-token' = $AdminToken; 'Content-Type' = 'application/json' }
  $i = 0; $inserted = 0
  while ($i -lt $rows.Count) {
    $chunk = $rows[$i..([math]::Min($i + $BatchSize - 1, $rows.Count - 1))]
    $bodyObj = @{ rows = $chunk }
    foreach ($k in $extra.Keys) { $bodyObj[$k] = $extra[$k] }
    $json = ($bodyObj | ConvertTo-Json -Depth 6)
    $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $json
    if ($resp -and $resp.inserted) { $inserted += [int]$resp.inserted }
    $i += $BatchSize
  }
  return $inserted
}

# Ingest stock
Write-Host "Posting stock snapshot ..."
$stockInserted = Invoke-PostChunks (Join-Url $FunctionUrl 'ingest/stock') $stockRows @{ snapshot_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
Write-Host "Inserted $stockInserted stock rows"

# Ingest aggregates
Write-Host "Posting aggregates ..."
$aggInserted = Invoke-PostChunks (Join-Url $FunctionUrl 'ingest/aggregates') $aggregateRows @{ source = 'DATA-upload'; provider = 'books' }
Write-Host "Inserted $aggInserted aggregate rows"

# Recompute suggestions from aggregates
Write-Host "Trigger recompute from aggregates ..."
$headers = @{ 'x-admin-token' = $AdminToken; 'Content-Type' = 'application/json' }
$recomputeResp = Invoke-RestMethod -Method Post -Uri (Join-Url $FunctionUrl 'recompute/from-aggregates') -Headers $headers -Body (@{ months = $WindowMonths } | ConvertTo-Json)
Write-Host ("Recompute done: job_id={0}, inserted={1}" -f $recomputeResp.job_id, $recomputeResp.inserted)

# Fetch suggestions and write to CSV
Write-Host "Fetching DB-first suggestions ..."
$sugg = Invoke-RestMethod -Method Get -Uri (Join-Url $FunctionUrl 'suggestions') -Headers @{ 'x-admin-token' = $AdminToken }
if (-not $sugg -or -not $sugg.success) { throw "Failed to fetch suggestions: $($sugg | Out-String)" }
$rows = @()
foreach ($s in $sugg.suggestions) {
  $rows += [pscustomobject]@{
    SKU = $s.sku
    Description = $s.description
    CurrentStock = $s.currentStock
    SuggestedQty = $s.suggestedQuantity
    Priority = $s.priority
    EstimatedCost = $s.estimatedCost
    DaysUntilStockout = $s.daysUntilStockout
  }
}
$rows | Export-Csv -Path $OutBackendCsv -NoTypeInformation -Encoding UTF8
Write-Host "Wrote backend suggestions to $OutBackendCsv (rows=$($rows.Count))"
