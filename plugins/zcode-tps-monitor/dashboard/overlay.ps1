# zcode-tps-monitor: StatsLine estilo DSH no rodape do composer do ZCode.
# Texto cinza 12px, sem fundo, dentro do card. Fechar: encerrar o processo overlay.
# Uma instancia so (mutex). Segue a janela principal do ZCode.

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  public static bool SameProcess(IntPtr a, IntPtr b) {
    uint pa, pb;
    GetWindowThreadProcessId(a, out pa);
    GetWindowThreadProcessId(b, out pb);
    return pa != 0 && pa == pb;
  }
  public static bool IsZCodeFront(IntPtr zHwnd, IntPtr overlayHwnd) {
    if (zHwnd == IntPtr.Zero || !IsWindow(zHwnd) || IsIconic(zHwnd)) return false;
    IntPtr fg = GetForegroundWindow();
    if (fg == zHwnd || fg == overlayHwnd) return true;
    if (fg == IntPtr.Zero) return false;
    return SameProcess(fg, zHwnd);
  }
  public static IntPtr FindLargestWindow(int[] pids) {
    IntPtr best = IntPtr.Zero;
    long bestArea = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      bool match = false;
      for (int i = 0; i < pids.Length; i++) if (pids[i] == (int)pid) { match = true; break; }
      if (!match) return true;
      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (area > bestArea) { bestArea = area; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
"@

[void][Win32]::SetProcessDPIAware()
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::InvariantCulture

$mutex = New-Object System.Threading.Mutex($false, "Global\ZCodeTpsMonitorOverlay")
if (-not $mutex.WaitOne(0)) { exit 0 }

$script:STRIP_W = 640
$STRIP_H = 18
$FSZ = 12
$URL = "http://127.0.0.1:7423/api/token-rate"
# Padding interno do card, abaixo da toolbar (send ~48px do fundo da janela).
$script:offY = -30
$script:zHwnd = [IntPtr]::Zero
$script:lastRect = $null
$script:isLight = $null
$script:S = 1.0
$DOT = [char]0x00B7
$inv = [System.Globalization.CultureInfo]::InvariantCulture

$INK = @{
  dark  = @{ main = "#FF8B94AD" }
  light = @{ main = "#FF8A8F99" }
}

function Get-ZCodeLuminance($r) {
  try {
    $x = $r.Left + [int](($r.Right - $r.Left) * 0.45)
    $y = $r.Bottom - 56
    if ($y -lt $r.Top + 40) { $y = $r.Top + 40 }
    $bmp = New-Object System.Drawing.Bitmap(4, 8)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size(4, 8)))
    $g.Dispose()
    $c = $bmp.GetPixel(2, 4)
    $bmp.Dispose()
    return ($c.R * 0.299 + $c.G * 0.587 + $c.B * 0.114)
  } catch { return $null }
}

function Convert-Hex([string]$hex) {
  $a = [byte]::Parse($hex.Substring(1, 2), 'HexNumber')
  $r = [byte]::Parse($hex.Substring(3, 2), 'HexNumber')
  $g = [byte]::Parse($hex.Substring(5, 2), 'HexNumber')
  $b = [byte]::Parse($hex.Substring(7, 2), 'HexNumber')
  return [Windows.Media.Color]::FromArgb($a, $r, $g, $b)
}

function BrushFrom([string]$hex) {
  return [Windows.Media.SolidColorBrush]::new((Convert-Hex $hex))
}

function Apply-Theme([bool]$light) {
  $t = if ($light) { $INK.light } else { $INK.dark }
  $line.Foreground = BrushFrom $t.main
}

function Apply-Scale {
  $win.Width = [Math]::Round($script:STRIP_W / $script:S, 1)
  $win.Height = [Math]::Round($STRIP_H / $script:S, 1)
  $line.FontSize = [Math]::Round($FSZ / $script:S, 1)
}

function Place-At([int]$physX, [int]$physY) {
  $win.Left = $physX / $script:S
  $win.Top = $physY / $script:S
}

function Format-Dec([double]$n) {
  $r = [Math]::Round($n * 10) / 10
  if ($r -eq [Math]::Floor($r)) { return ([int]$r).ToString($inv) }
  return $r.ToString("0.0", $inv)
}

function Format-Duration([double]$ms) {
  $s = $ms / 1000.0
  if ($s -lt 60) { return ((Format-Dec $s) + "s") }
  $whole = [int][Math]::Round($s)
  $m = [int][Math]::Floor($whole / 60)
  $sec = $whole % 60
  return ($m.ToString($inv) + "m" + $sec.ToString($inv) + "s")
}

function Format-Tps($v) {
  if ($null -eq $v) { return $null }
  $n = [Math]::Max(0, [double]$v)
  if ($n -ge 10) { return ([Math]::Round($n)).ToString($inv) }
  return (Format-Dec $n)
}

function Format-Tokens([double]$n) {
  if ($n -lt 1000) { return ([int]$n).ToString($inv) }
  $scaled = {
    param($v)
    if ($v -ge 100) { return ([Math]::Round($v)).ToString($inv) }
    return (Format-Dec $v)
  }
  if ($n -lt 1000000) { return ((& $scaled ($n / 1000)) + "K") }
  return ((& $scaled ($n / 1000000)) + "M")
}

function Format-Line($d) {
  $s = $d.session
  $l = $d.latest
  if (-not $s -and -not $l) { return "" }
  $groups = New-Object System.Collections.Generic.List[string]
  $turns = 0
  $steps = 0
  if ($s) {
    $turns = if ($s.turns) { [int]$s.turns } else { [int]$s.requests }
    $steps = [int]$s.requests
  }
  if ($steps -gt 0) {
    [void]$groups.Add("$turns turns $DOT $steps steps")
    if ($s.totalGenMs -gt 0) {
      [void]$groups.Add("LLM $(Format-Duration $s.totalGenMs)")
    }
    $speeds = New-Object System.Collections.Generic.List[string]
    $ttft = $null
    if ($s.avgTtftMs -ne $null) { $ttft = [double]$s.avgTtftMs }
    elseif ($l -and $l.ttftMs -ne $null) { $ttft = [double]$l.ttftMs }
    if ($null -ne $ttft) { [void]$speeds.Add("TTFT avg $(Format-Duration $ttft)") }
    $tps = $null
    if ($s.tokPerSec -ne $null) { $tps = Format-Tps $s.tokPerSec }
    elseif ($l -and $l.tokPerSec -ne $null) { $tps = Format-Tps $l.tokPerSec }
    if ($tps) { [void]$speeds.Add("$tps tok/s") }
    if ($speeds.Count -gt 0) { [void]$groups.Add(($speeds -join " $DOT ")) }
  }
  if ($s -and $s.totalInput -gt 0) {
    $hit = [int][Math]::Round(100.0 * $s.totalCacheRead / $s.totalInput)
    [void]$groups.Add("Cache hit $hit%")
    $inTok = Format-Tokens $s.totalInput
    $outTok = Format-Tokens ([double]($s.totalOutput + $s.totalReasoning))
    [void]$groups.Add("Input $inTok tok $DOT Output $outTok tok")
  }
  return ($groups -join " | ")
}

function Get-ZCodeHwnd {
  $pids = @(Get-Process ZCode -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $pids -or $pids.Count -eq 0) { return [IntPtr]::Zero }
  return [Win32]::FindLargestWindow($pids)
}

function Get-ZCodeRect {
  $h = Get-ZCodeHwnd
  if ($h -eq [IntPtr]::Zero) { return $null }
  $script:zHwnd = $h
  $r = New-Object RECT
  [void][Win32]::GetWindowRect($h, [ref]$r)
  return $r
}

function Place-Default([object]$r) {
  if (-not $r) { return }
  $winW = $r.Right - $r.Left
  $sidebar = 248
  $right = 0
  if ($winW -lt 900) { $sidebar = 0 }
  if ($winW -gt 1400) { $right = 360 }
  $contentW = [Math]::Max(420, $winW - $sidebar - $right - 24)
  $cardW = [Math]::Min(768, $contentW - 48)
  $script:STRIP_W = [Math]::Max(420, $cardW - 32)
  Apply-Scale
  $cardLeft = $r.Left + $sidebar + [int](($contentW - $cardW) / 2)
  $px = $cardLeft + [int](($cardW - $script:STRIP_W) / 2)
  $py = $r.Bottom + $script:offY
  $minX = $r.Left + 8
  $maxX = [Math]::Max($minX, $r.Right - $script:STRIP_W - 8)
  $minY = $r.Top + 8
  $maxY = [Math]::Max($minY, $r.Bottom - $STRIP_H - 8)
  $px = [Math]::Max($minX, [Math]::Min($px, $maxX))
  $py = [Math]::Max($minY, [Math]::Min($py, $maxY))
  Place-At $px $py
}

function Assert-ZOrder([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return }
  $front = [Win32]::IsZCodeFront($script:zHwnd, $hwnd)
  if (-not $front) {
    $win.Opacity = 0
    [void][Win32]::ShowWindow($hwnd, 0)
    return
  }
  $win.Opacity = 1
  [void][Win32]::ShowWindow($hwnd, 4)
  # HWND_NOTOPMOST, depois HWND_TOP — nunca TOPMOST (vaza para a barra do Windows).
  [void][Win32]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x13)
  [void][Win32]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x13)
}

$xamlText = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" Topmost="False" Opacity="1" ShowInTaskbar="False"
        ShowActivated="False" ResizeMode="NoResize"
        FontFamily="Segoe UI">
  <TextBlock x:Name="Line" Text="" TextAlignment="Center"
             VerticalAlignment="Center" FontWeight="Regular"
             LineHeight="20" TextTrimming="CharacterEllipsis"/>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$xamlText)
$win = [Windows.Markup.XamlReader]::Load($reader)
$line = $win.FindName("Line")

$script:tickCount = 0
$script:overlayHwnd = [IntPtr]::Zero
$timer = [Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
  try {
    $script:tickCount++
    $r = Get-ZCodeRect
    if ($r -and ($script:tickCount % 5) -eq 1) {
      $lum = Get-ZCodeLuminance $r
      if ($null -ne $lum) {
        $l = ($lum -gt 127)
        if ($l -ne $script:isLight) { $script:isLight = $l; Apply-Theme $l }
      }
    }
    if ($r) {
      Place-Default $r
      $script:lastRect = $r
      Assert-ZOrder $script:overlayHwnd
    } else {
      $win.Opacity = 0
      if ($script:overlayHwnd -ne [IntPtr]::Zero) {
        [void][Win32]::ShowWindow($script:overlayHwnd, 0)
      }
    }
    $d = Invoke-RestMethod -Uri $URL -TimeoutSec 2
    $txt = Format-Line $d
    if ($txt) { $line.Text = $txt }
  } catch {
    $line.Text = ""
  }
})
$timer.Start()

$win.Add_SourceInitialized({
  $hwnd = ([System.Windows.Interop.WindowInteropHelper]::new($win)).Handle
  $script:overlayHwnd = $hwnd
  if ($hwnd -ne [IntPtr]::Zero) {
    $cur = [Win32]::GetWindowLongPtr($hwnd, -20)
    # WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_LAYERED
    [void][Win32]::SetWindowLongPtr($hwnd, -20, [IntPtr]([int64]$cur -bor 0x8000000 -bor 0x80 -bor 0x20 -bor 0x80000))
  }
  $zHwnd = Get-ZCodeHwnd
  if ($zHwnd -ne [IntPtr]::Zero -and $hwnd -ne [IntPtr]::Zero) {
    [void][Win32]::SetWindowLongPtr($hwnd, -8, $zHwnd)
  }
  $src = [System.Windows.PresentationSource]::FromVisual($win)
  if ($src -and $src.CompositionTarget) {
    $script:S = [Math]::Max(1.0, $src.CompositionTarget.TransformToDevice.M11)
  }
  Apply-Scale
  $rInit = Get-ZCodeRect
  if ($rInit) {
    Place-Default $rInit
    $script:lastRect = $rInit
  }
  Assert-ZOrder $hwnd
})
$win.Add_Closed({
  try { $mutex.ReleaseMutex() } catch {}
  $win.Dispatcher.InvokeShutdown()
})

$r0 = Get-ZCodeRect
if ($r0) {
  $lum0 = Get-ZCodeLuminance $r0
  if ($null -ne $lum0) { $script:isLight = ($lum0 -gt 127) }
}
if ($null -eq $script:isLight) { $script:isLight = $true }
Apply-Theme $script:isLight
$win.Show()
[System.Windows.Threading.Dispatcher]::Run()
