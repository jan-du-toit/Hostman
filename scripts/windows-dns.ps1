param([ValidateSet('enable','disable','start','stop','restart','status')][string]$Action='status')
$ErrorActionPreference='Stop'
$Data = Join-Path $env:ProgramData 'Hostman'
$Snapshot = Join-Path $Data 'dns-system.json'
$Task = 'ByDT Hostman DNS'

function Test-Admin {
    $id=[Security.Principal.WindowsIdentity]::GetCurrent()
    ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Test-Resolver {
    for ($i=0; $i -lt 40; $i++) {
        try {
            $u=New-Object Net.Sockets.UdpClient
            $u.Client.ReceiveTimeout=250
            $u.Connect('127.0.0.1',53)
            [byte[]]$q=0x48,0x4d,1,0,0,1,0,0,0,0,0,0,9,108,111,99,97,108,104,111,115,116,0,0,1,0,1
            [void]$u.Send($q,$q.Length)
            $ep=New-Object Net.IPEndPoint([Net.IPAddress]::Any,0)
            $r=$u.Receive([ref]$ep)
            if ($r.Length -ge 12 -and $r[0] -eq 0x48 -and $r[1] -eq 0x4d -and ($r[3] -band 15) -eq 0) { return }
        } catch {} finally { if($u){$u.Close()} }
        Start-Sleep -Milliseconds 100
    }
    throw 'Hostman DNS is not responding. DNS settings have not been redirected.'
}
function Save-Snapshot($Value) {
    $temp=$Snapshot+'.tmp'
    $Value | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $temp
    Move-Item -Force $temp $Snapshot
}
function Restore-Settings {
    if (Test-Path $Snapshot) {
        $saved=Get-Content -Raw $Snapshot | ConvertFrom-Json
        foreach ($row in @($saved.interfaces)) {
            # Resolve by GUID so interface-index changes do not target another adapter.
            $adapter=Get-NetAdapter -IncludeHidden | Where-Object { $_.InterfaceGuid.ToString() -eq $row.guid }
            if (!$adapter) { throw "Adapter $($row.guid) is missing; reconnect it and run dns disable again." }
            $obj=Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily $row.family
            if ($row.automatic) { $obj | Set-DnsClientServerAddress -ResetServerAddresses }
            else { $obj | Set-DnsClientServerAddress -ServerAddresses @($row.servers) }
        }
        Remove-Item $Snapshot
        Clear-DnsClientCache
    }
}
if ($Action -eq 'status') {
    Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue | Select-Object TaskName,State
    Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses -contains '127.0.0.1' -or $_.ServerAddresses -contains '::1' } | Format-Table
    exit 0
}
if (!(Test-Admin)) { throw 'Open PowerShell as Administrator.' }
if ($env:HOSTMAN_DATA_DIR -or $env:HOSTMAN_HOSTS_FILE) { throw 'System operations are disabled with test path overrides.' }
# Serialize DNS reconfiguration separately from hosts operations.
$mutex=New-Object Threading.Mutex($false,'Global\ByDT.Hostman.DNS')
if (!$mutex.WaitOne(30000)) { throw 'Another DNS operation is running.' }
try {
    switch ($Action) {
        'enable' {
            if (Test-Path $Snapshot) {
                $saved=Get-Content -Raw $Snapshot | ConvertFrom-Json
                if ($saved.phase -ne 'enabled') { throw 'Run hostman dns disable to recover the interrupted setup first.' }
                # Previously disconnected adapters may now be available. Restore before taking a fresh snapshot.
                Restore-Settings
            }
            Enable-ScheduledTask -TaskName $Task | Out-Null
            Start-ScheduledTask -TaskName $Task
            Test-Resolver
            $rows=@()
            foreach ($adapter in @(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Loopback' })) {
                foreach ($family in @('IPv4','IPv6')) {
                    $obj=Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily $family -ErrorAction SilentlyContinue
                    if (!$obj) { continue }
                    $service=if($family -eq 'IPv4'){'Tcpip'}else{'Tcpip6'}
                    $key="HKLM:\SYSTEM\CurrentControlSet\Services\$service\Parameters\Interfaces\{$($adapter.InterfaceGuid)}"
                    $static=(Get-ItemProperty -Path $key -Name NameServer -ErrorAction SilentlyContinue).NameServer
                    $rows+=@{guid=$adapter.InterfaceGuid.ToString(); family=$family; automatic=[string]::IsNullOrWhiteSpace($static); servers=@($obj.ServerAddresses)}
                }
            }
            if (!$rows.Count) { throw 'No active network adapters found.' }
            Save-Snapshot @{platform='windows';phase='pending';interfaces=$rows}
            try {
                foreach ($row in $rows) {
                    $adapter=Get-NetAdapter -IncludeHidden | Where-Object {$_.InterfaceGuid.ToString() -eq $row.guid}
                    $obj=Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily $row.family
                    $address=if($row.family -eq 'IPv4'){'127.0.0.1'}else{'::1'}
                    $obj | Set-DnsClientServerAddress -ServerAddresses @($address)
                }
                Save-Snapshot @{platform='windows';phase='enabled';interfaces=$rows}
                Enable-ScheduledTask -TaskName $Task | Out-Null
                Clear-DnsClientCache
                Write-Host 'Hostman DNS priority enabled on the active adapters.'
            } catch { Restore-Settings; throw }
        }
        'start' { Enable-ScheduledTask -TaskName $Task | Out-Null; Start-ScheduledTask -TaskName $Task; Test-Resolver }
        'restart' { Stop-ScheduledTask -TaskName $Task; Start-Sleep -Milliseconds 500; Start-ScheduledTask -TaskName $Task; Test-Resolver }
        default {
            Restore-Settings
            Stop-ScheduledTask -TaskName $Task
            Disable-ScheduledTask -TaskName $Task | Out-Null
            Write-Host 'System DNS settings restored; Hostman DNS stopped.'
        }
    }
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
