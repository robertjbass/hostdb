# Exercise the same Windows archive that will be published by release-mysql.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$version = $env:VERSION
$root = Join-Path $env:RUNNER_TEMP 'mysql-qualification'
New-Item -ItemType Directory -Path $root | Out-Null
tar -xf "release-assets/mysql-$version-win32-x64.zip" -C $root
$base = Join-Path $root 'mysql'
$data = Join-Path $root 'data'
$server = Join-Path $base 'bin/mysqld.exe'
$client = Join-Path $base 'bin/mysql.exe'
$admin = Join-Path $base 'bin/mysqladmin.exe'
$dump = Join-Path $base 'bin/mysqldump.exe'
$sql = Join-Path $root 'proof.sql'
$port = 19306
$connection = @('--no-defaults', '--protocol=TCP', '--host=127.0.0.1', "--port=$port", '--user=root')

& $server --no-defaults --initialize-insecure "--basedir=$base" "--datadir=$data"
$serverArgs = @('--no-defaults', "--basedir=`"$base`"", "--datadir=`"$data`"", "--port=$port", '--bind-address=127.0.0.1', '--mysqlx=OFF', '--console')
$process = Start-Process $server -ArgumentList $serverArgs -PassThru -NoNewWindow
try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($process.HasExited) { throw "mysqld exited with code $($process.ExitCode)" }
        # A failed readiness probe is expected while the server starts.
        $PSNativeCommandUseErrorActionPreference = $false
        & $admin @connection --connect-timeout=1 --silent ping
        $PSNativeCommandUseErrorActionPreference = $true
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'mysqld did not become ready' }
    $variable = if ($version.Split('.').Count -eq 4) { '@@version_with_update' } else { '@@version' }
    $actual = & $client @connection -N -B -e "SELECT $variable"
    if ($actual -ne $version) { throw "Expected $version, got $actual" }
    & $client @connection -e 'CREATE DATABASE proof; CREATE TABLE proof.sample (n INT PRIMARY KEY); INSERT INTO proof.sample VALUES (314159)'
    & $dump @connection --single-transaction --set-gtid-purged=OFF "--result-file=$sql" proof
    & $client @connection proof -e 'DROP TABLE sample'
    Get-Content -Raw $sql | & $client @connection proof
    $row = & $client @connection proof -N -B -e 'SELECT n FROM sample'
    if ($row -ne '314159') { throw "Restored row differs: $row" }
    Write-Host "Verified Windows MySQL $actual and restored row $row"
    & $admin @connection shutdown
} finally {
    if (!$process.HasExited -and !$process.WaitForExit(5000)) { $process.Kill() }
}
