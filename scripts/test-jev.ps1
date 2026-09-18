# A small synthetic experiment. The API key is never a command-line argument or file.
[CmdletBinding()]
param(
    [switch]$FromClipboard,
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$taskPreviousKey = $env:TYPESAFE_API_KEY
$taskKey = $null
try {
    if ($FromClipboard) {
        $taskKey = (Get-Clipboard -Raw).Trim()
        if ($taskKey.Length -lt 16 -or $taskKey.Length -gt 4096 -or $taskKey -match '\s') {
            throw 'The clipboard must contain a single API key. Its value was not displayed.'
        }
        $env:TYPESAFE_API_KEY = $taskKey
    } elseif (-not $env:TYPESAFE_API_KEY) {
        $taskSecureKey = Read-Host 'Jev API key (hidden)' -AsSecureString
        $taskCredential = [pscredential]::new('jev', $taskSecureKey)
        $env:TYPESAFE_API_KEY = $taskCredential.GetNetworkCredential().Password
    }
    $taskScript = Join-Path $PSScriptRoot '../benchmarks/jev-trial.mjs'
    $taskArguments = @($taskScript, '--live', '--allow-network')
    if ($OutputPath) { $taskArguments += @('--output', $OutputPath) }
    & node @taskArguments
    if ($LASTEXITCODE -ne 0) { throw 'The Jev experiment did not pass. See the non-secret report above.' }
} finally {
    if ($null -eq $taskPreviousKey) { Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue }
    else { $env:TYPESAFE_API_KEY = $taskPreviousKey }
    $taskKey = $null
    $taskSecureKey = $null
    $taskCredential = $null
}
