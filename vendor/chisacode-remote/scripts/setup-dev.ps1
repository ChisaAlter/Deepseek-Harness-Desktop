# ChisaCode Windows 开发环境一键设置脚本
# 用法: powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  ChisaCode 开发环境设置 (Windows)" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查 Node.js 版本
Write-Host "[1/5] 检查 Node.js ..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 未找到 Node.js。请从 https://nodejs.org 安装 Node.js 22+ 再运行。" -ForegroundColor Red
        exit 1
    }
    $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($majorVersion -lt 22) {
        Write-Host "错误: Node.js $majorVersion 太旧。需要 Node.js >= 22。" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Node.js $nodeVersion — 通过" -ForegroundColor Green
} catch {
    Write-Host "错误: 未找到 Node.js。请从 https://nodejs.org 安装 Node.js 22+。" -ForegroundColor Red
    exit 1
}

# 2. 安装依赖
Write-Host ""
Write-Host "[2/5] 检查依赖 ..." -ForegroundColor Yellow
if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Write-Host "  正在运行 npm ci（可能需要几分钟）..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        npm ci 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "错误: npm ci 失败。请检查网络连接和 npm 配置。" -ForegroundColor Red
            Pop-Location
            exit 1
        }
    } finally {
        Pop-Location
    }
    Write-Host "  依赖安装完成" -ForegroundColor Green
} else {
    Write-Host "  node_modules 已存在，跳过 npm ci" -ForegroundColor Green
}

# 3. 配置 Git hooks
Write-Host ""
Write-Host "[3/5] 配置 Git hooks ..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    npx lefthook install 2>&1 | Out-Null
    Write-Host "  Git hooks 配置完成" -ForegroundColor Green
} catch {
    Write-Host "  警告: Git hooks 配置失败（$($_.Exception.Message)），可手动运行: npx lefthook install" -ForegroundColor DarkYellow
} finally {
    Pop-Location
}

# 4. 生成 .env.development 模板（如果不存在）
Write-Host ""
Write-Host "[4/5] 检查环境配置 ..." -ForegroundColor Yellow
$envFile = "$ProjectRoot\.env.development"
if (-not (Test-Path $envFile)) {
    @"
# ChisaCode 开发环境变量
# 此文件由 scripts/setup-dev.ps1 自动生成

# 开发模式下自动连接本地 daemon
EXPO_PUBLIC_LOCAL_DAEMON=localhost:6767

# 应用变体 (development / production)
APP_VARIANT=development

# 禁止自动打开浏览器
BROWSER=none

# 日志级别 (trace / debug / info / warn / error)
CHISACODE_LOG_LEVEL=info

# 本地模型目录（语音模型）
# CHISACODE_LOCAL_MODELS_DIR=%USERPROFILE%\.chisacode\models\local-speech
"@ | Out-File -FilePath $envFile -Encoding UTF8
    Write-Host "  已生成 .env.development 模板" -ForegroundColor Green
} else {
    Write-Host "  .env.development 已存在，跳过" -ForegroundColor Green
}

# 5. 总结
Write-Host ""
Write-Host "[5/5] 设置完成！" -ForegroundColor Green
Write-Host ""
Write-Host "  启动开发环境:  npm run dev:win" -ForegroundColor Cyan
Write-Host "  仅启动 daemon:  npm run dev:server" -ForegroundColor Cyan
Write-Host "  仅启动 app:     npm run dev:app" -ForegroundColor Cyan
Write-Host ""
Write-Host "  如果没有 node_modules，请先运行: npm ci" -ForegroundColor Yellow
