param(
  [int]$ListenPort = 5051,
  [string]$TargetHost = '127.0.0.1',
  [int]$TargetPort = 5050,
  [string]$ListenIP = '0.0.0.0'
)

Write-Host "TCP Proxy: ${ListenIP}:${ListenPort} -> ${TargetHost}:${TargetPort}" -ForegroundColor Green

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($ListenIP), $ListenPort)
$listener.Start()
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    Start-Job -ScriptBlock {
      param($c, $targetHost, $targetPort)
      try {
        $cs = $c.GetStream()
        $s = New-Object System.Net.Sockets.TcpClient($targetHost, $targetPort)
        $ss = $s.GetStream()
        $copy = {
          param($from,$to)
          $buf = New-Object byte[] 65536
          try { while(($n=$from.Read($buf,0,$buf.Length)) -gt 0){ $to.Write($buf,0,$n); $to.Flush() } } catch {}
          try { $to.Close() } catch {}
        }
        Start-Job -ScriptBlock $copy -ArgumentList $cs, $ss | Out-Null
        Start-Job -ScriptBlock $copy -ArgumentList $ss, $cs | Out-Null
      } catch {}
    } -ArgumentList $client, $TargetHost, $TargetPort | Out-Null
  }
} finally {
  $listener.Stop()
}
