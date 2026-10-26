# Dot-source this file from the PowerShell profile.
# It asks which session record to use before claude, copilot, or ai <tool>.

function Get-SessionRecordExternal {
    param([Parameter(Mandatory = $true)][string]$Name)
    $cmd = Get-Command -Name $Name -All -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandType -eq 'Application' -or $_.CommandType -eq 'ExternalScript' } |
        Select-Object -First 1
    if (-not $cmd) { return $null }
    return $cmd.Source
}

function Invoke-SessionRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$ToolArgs
    )

    if (-not $ToolArgs) { $ToolArgs = @() }
    $resolved = Get-SessionRecordExternal $Tool
    if (-not $resolved) {
        Write-Error "Could not find $Tool on PATH."
        return
    }

    $cli = Get-Command session-record -CommandType Application -ErrorAction SilentlyContinue
    if (-not $cli) {
        & $resolved @ToolArgs
        return
    }

    $resultFile = Join-Path ([System.IO.Path]::GetTempPath()) "session-record-$PID-$Tool.json"
    & session-record begin --tool $Tool --terminal-id $PID --result-file $resultFile
    if ($LASTEXITCODE -ne 0) { return }
    if (-not (Test-Path $resultFile)) {
        Write-Error "session-record did not record a choice."
        return
    }

    $result = Get-Content -Raw $resultFile | ConvertFrom-Json
    Remove-Item $resultFile -ErrorAction SilentlyContinue

    if ($result.action -eq 'attach') {
        $env:SESSION_RECORD_PATH = $result.path
        $env:SESSION_RECORD_ID = $result.id
        $env:SESSION_RECORD_TOOL = $Tool
        $env:SESSION_RECORD_TERMINAL = "$PID"
        if ($result.instructionDir) {
            if ($env:COPILOT_CUSTOM_INSTRUCTIONS_DIRS) {
                $env:COPILOT_CUSTOM_INSTRUCTIONS_DIRS = "$($result.instructionDir),$($env:COPILOT_CUSTOM_INSTRUCTIONS_DIRS)"
            } else {
                $env:COPILOT_CUSTOM_INSTRUCTIONS_DIRS = $result.instructionDir
            }
        }
        if ($Tool -eq 'claude' -and $result.instructionFile) {
            $prompt = Get-Content -Raw $result.instructionFile
            & $resolved --append-system-prompt $prompt @ToolArgs
            return
        }
    }

    & $resolved @ToolArgs
}

function global:claude {
    Invoke-SessionRecord -Tool claude @args
}

function global:copilot {
    Invoke-SessionRecord -Tool copilot @args
}

function global:ai {
    if ($args.Count -lt 1) {
        Write-Error "Usage: ai <tool> [arguments]"
        return
    }
    $toolName = $args[0]
    $rest = @()
    if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }
    Invoke-SessionRecord -Tool $toolName @rest
}
