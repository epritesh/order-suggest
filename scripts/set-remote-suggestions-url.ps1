param(
  [string]$FunctionUrl,
  [string]$AdminToken,
  [string]$Url
)

$ErrorActionPreference = 'Stop'
if (-not $FunctionUrl) { throw "-FunctionUrl is required" }
if (-not $AdminToken) { throw "-AdminToken is required" }
if (-not $Url) { throw "-Url is required (Stratus object URL)" }

function Join-Url([string]$base, [string]$path) {
  if ([string]::IsNullOrWhiteSpace($base)) { return $path }
  if ([string]::IsNullOrWhiteSpace($path)) { return $base }
  $b = $base.TrimEnd('/'); $p = $path.TrimStart('/'); "$b/$p"
}

$headers = @{ 'x-admin-token' = $AdminToken; 'Content-Type' = 'application/json' }
$setUri = Join-Url $FunctionUrl 'suggestions/remote'
$body = @{ url = $Url } | ConvertTo-Json
$resp = Invoke-RestMethod -Method Post -Uri $setUri -Headers $headers -Body $body
Write-Host ("Set remote_url: {0}" -f $resp.remote_url)

# Optional: clear cache so GET /suggestions serves remote
$clearUri = Join-Url $FunctionUrl 'suggestions/cache/clear'
try { Invoke-RestMethod -Method Post -Uri $clearUri -Headers $headers | Out-Null } catch {}

# Verify
$sugg = Invoke-RestMethod -Method Get -Uri (Join-Url $FunctionUrl 'suggestions')
if ($sugg -and $sugg.success) {
  Write-Host ("Backend serving {0} suggestions from {1}" -f $sugg.suggestions.Count, $sugg.source)
} else {
  Write-Host ("Fetch result: {0}" -f ($sugg | ConvertTo-Json -Depth 5))
}
