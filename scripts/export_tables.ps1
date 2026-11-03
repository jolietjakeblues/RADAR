# Exporteert de RADAR Access-tabellen naar CSV (data/csv/), als basis voor
# scripts/radar_to_rdf.py. Vereist de 32-bit "Microsoft.Jet.OLEDB.4.0"-
# provider (ingebouwd in Windows) -- draai dit daarom met 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File scripts\export_tables.ps1
# De .mdb wordt read-only geopend en staat niet in een repo (zie .gitignore).
param(
  [string]$DbPath = "$PSScriptRoot\..\RADAR2022 2026-06-23 verstuurversie.mdb",
  [string]$OutDir = "$PSScriptRoot\..\data\csv"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$conn = New-Object -ComObject ADODB.Connection
$conn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$DbPath;Mode=Read;")

function Escape-Csv($val) {
  if ($null -eq $val) { return "" }
  $s = [string]$val
  $s = $s -replace '"', '""'
  return '"' + $s + '"'
}

function Export-Table($sql, $outFile) {
  $rs = New-Object -ComObject ADODB.Recordset
  $rs.Open($sql, $conn)
  $sw = New-Object System.IO.StreamWriter($outFile, $false, [System.Text.Encoding]::UTF8)
  $headers = @()
  foreach ($f in $rs.Fields) { $headers += Escape-Csv($f.Name) }
  $sw.WriteLine(($headers -join ","))
  $n = 0
  while (-not $rs.EOF) {
    $vals = @()
    foreach ($f in $rs.Fields) { $vals += Escape-Csv($f.Value) }
    $sw.WriteLine(($vals -join ","))
    $rs.MoveNext()
    $n++
  }
  $sw.Close()
  $rs.Close()
  Write-Output "$outFile : $n rows"
}

# Hoofdtabellen. PLANTS: de lege kolommen F12 en Veld1 worden niet geexporteerd.
Export-Table "SELECT * FROM SITES" (Join-Path $OutDir "SITES.csv")
Export-Table "SELECT * FROM FEATURES" (Join-Path $OutDir "FEATURES.csv")
Export-Table "SELECT * FROM SAMPLES" (Join-Path $OutDir "SAMPLES.csv")
Export-Table "SELECT BIAX_ID, [Sample nr], Name, Id_level, [Part preserved], [Pres mode], Quantification, Min_numb, Max_numb, Remarks FROM PLANTS" (Join-Path $OutDir "PLANTS.csv")
Export-Table "SELECT * FROM REPORTS" (Join-Path $OutDir "REPORTS.csv")
# Taxonomie
Export-Table "SELECT * FROM Taxa" (Join-Path $OutDir "Taxa.csv")
Export-Table "SELECT * FROM [Taxa thesaurus ArnoldsvdM]" (Join-Path $OutDir "Taxa_thesaurus.csv")
Export-Table "SELECT * FROM Synonyms" (Join-Path $OutDir "Synonyms.csv")
# Codelijsten
Export-Table "SELECT * FROM Site_type" (Join-Path $OutDir "Site_type.csv")
Export-Table "SELECT * FROM Pres_mode" (Join-Path $OutDir "Pres_mode.csv")
Export-Table "SELECT * FROM Id_level" (Join-Path $OutDir "Id_level.csv")
Export-Table "SELECT * FROM Sample_type" (Join-Path $OutDir "Sample_type.csv")
Export-Table "SELECT * FROM Parts" (Join-Path $OutDir "Parts.csv")
Export-Table "SELECT * FROM Archeoregio" (Join-Path $OutDir "Archeoregio.csv")
Export-Table "SELECT * FROM Dates" (Join-Path $OutDir "Dates.csv")

$conn.Close()
