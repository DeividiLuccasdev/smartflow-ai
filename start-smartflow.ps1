$ErrorActionPreference = "SilentlyContinue"

function Test-Porta {
    param([int]$Porta)

    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $resultado = $tcp.BeginConnect("127.0.0.1", $Porta, $null, $null)
        $sucesso = $resultado.AsyncWaitHandle.WaitOne(500)

        if ($sucesso) {
            $tcp.EndConnect($resultado)
        }

        $tcp.Close()
        return $sucesso
    }
    catch {
        return $false
    }
}

function Iniciar-Servico {
    param(
        [string]$Nome,
        [int]$Porta,
        [string]$Pasta
    )

    if (Test-Porta $Porta) {
        Write-Host "[OK] $Nome já está rodando na porta $Porta"
        return
    }

    Write-Host "[INICIANDO] $Nome..."

    Start-Process powershell.exe -ArgumentList `
        "-NoExit",
        "-Command",
        "Set-Location '$Pasta'; npm run dev"

    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "======================================"
Write-Host "       SMARTFLOW AI - INICIANDO"
Write-Host "======================================"
Write-Host ""

# Docker
docker info *> $null

if ($LASTEXITCODE -ne 0) {
    Write-Host "[INICIANDO] Docker Desktop..."

    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"

    Write-Host "Aguardando Docker..."

    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        docker info *> $null

        if ($LASTEXITCODE -eq 0) {
            break
        }
    }
}

docker info *> $null

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Docker não iniciou."
    exit
}

Write-Host "[OK] Docker online"

# Bancos PostgreSQL
$containers = @(
    "smartflow-auth-db",
    "smartflow-crm-db",
    "smartflow-erp-db"
)

foreach ($container in $containers) {
    $rodando = docker inspect `
        -f "{{.State.Running}}" `
        $container 2>$null

    if ($rodando -ne "true") {
        Write-Host "[INICIANDO] $container"
        docker start $container | Out-Null
    }
    else {
        Write-Host "[OK] $container"
    }
}

Start-Sleep -Seconds 3

# Backend
Iniciar-Servico `
    "Auth Service" `
    3001 `
    "C:\smartflow-ai\services\auth-service"

Iniciar-Servico `
    "CRM Service" `
    3002 `
    "C:\smartflow-ai\services\crm-service"

Iniciar-Servico `
    "ERP Service" `
    3003 `
    "C:\smartflow-ai\services\erp-service"

Iniciar-Servico `
    "Finance Service" `
    3004 `
    "C:\smartflow-ai\services\finance-service"

Iniciar-Servico `
    "AI Service" `
    3005 `
    "C:\smartflow-ai\services\ai-service"

Iniciar-Servico `
    "API Gateway" `
    3000 `
    "C:\smartflow-ai\gateway"

Iniciar-Servico `
    "Frontend" `
    5173 `
    "C:\smartflow-ai\frontend"

Write-Host ""
Write-Host "Aguardando serviços..."
Start-Sleep -Seconds 6

Write-Host ""
Write-Host "======================================"
Write-Host "          STATUS SMARTFLOW"
Write-Host "======================================"

$servicos = @(
    @{Nome="Gateway"; Porta=3000},
    @{Nome="Auth"; Porta=3001},
    @{Nome="CRM"; Porta=3002},
    @{Nome="ERP"; Porta=3003},
    @{Nome="Financeiro"; Porta=3004},
    @{Nome="IA"; Porta=3005},
    @{Nome="Frontend"; Porta=5173}
)

foreach ($servico in $servicos) {
    if (Test-Porta $servico.Porta) {
        Write-Host "[ONLINE] $($servico.Nome) - porta $($servico.Porta)"
    }
    else {
        Write-Host "[OFFLINE] $($servico.Nome) - porta $($servico.Porta)"
    }
}

Write-Host ""
Write-Host "SmartFlow:"
Write-Host "http://localhost:5173/"
Write-Host ""

Start-Process "http://localhost:5173/"
