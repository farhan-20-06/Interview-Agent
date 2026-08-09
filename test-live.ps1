$body = Get-Content "data\candidates (1).json" -Raw | ConvertFrom-Json
$candidate = $body.candidates[0]

$payload = @{
  sessionId = "live-test-openrouter-002"
  candidate = $candidate
} | ConvertTo-Json -Depth 20

Write-Host "Sending request to /api/interview..."
try {
  $response = Invoke-RestMethod -Uri "http://localhost:3000/api/interview" -Method POST -ContentType "application/json" -Body $payload -TimeoutSec 60
  Write-Host ""
  Write-Host "=== SUCCESS - OpenRouter responded! ==="
  Write-Host "reply: $($response.reply)"
  Write-Host "done: $($response.done)"
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  Write-Host "HTTP Status: $statusCode"
  try {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Host "Error Body: $body"
  } catch {
    Write-Host "Could not read error body"
  }
}
