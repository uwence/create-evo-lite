[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('pretooluse', 'posttooluse', 'precompact', 'sessionstart')]
    [string]$Hook
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hooksDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $hooksDir)
$resolvedRepoRoot = (Resolve-Path -LiteralPath $repoRoot).Path

$dockerArgs = @(
    'run',
    '--rm',
    '--init',
    '-i',
    '-e', 'HOME=/data',
    '-v', 'mcp-context-mode-data:/data',
    '-v', "$resolvedRepoRoot`:/workspace",
    '-w', '/workspace',
    'mcp-context-mode:local',
    'hook',
    'vscode-copilot',
    $Hook
)

& docker @dockerArgs
if ($LASTEXITCODE -ne 0) {
    throw "context-mode hook failed with exit code $LASTEXITCODE"
}