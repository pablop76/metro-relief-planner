<?php
// Prosty parser xlsx -> JSON (bez zewnętrznych bibliotek)
// Użycie: php parse_xlsx.php <plik.xlsx> <numer_arkusza 1|2> <max_wierszy>

$file = $argv[1] ?? null;
$sheetNo = (int)($argv[2] ?? 1);
$maxRows = (int)($argv[3] ?? 40);
if (!$file || !is_file($file)) { fwrite(STDERR, "Brak pliku\n"); exit(1); }

$zip = new ZipArchive();
if ($zip->open($file) !== true) { fwrite(STDERR, "Nie moge otworzyc zip\n"); exit(1); }

// shared strings
$shared = [];
if (($ss = $zip->getFromName('xl/sharedStrings.xml')) !== false) {
    $x = new SimpleXMLElement($ss);
    foreach ($x->si as $si) {
        // może mieć wiele <r><t>
        $text = '';
        if (isset($si->t)) { $text = (string)$si->t; }
        if (isset($si->r)) { foreach ($si->r as $r) { $text .= (string)$r->t; } }
        $shared[] = $text;
    }
}

$sheetXml = $zip->getFromName("xl/worksheets/sheet{$sheetNo}.xml");
if ($sheetXml === false) { fwrite(STDERR, "Brak arkusza\n"); exit(1); }
$zip->close();

function colToIdx($ref) {
    preg_match('/^([A-Z]+)(\d+)$/', $ref, $m);
    $col = $m[1]; $row = (int)$m[2];
    $n = 0;
    for ($i=0; $i<strlen($col); $i++) { $n = $n*26 + (ord($col[$i]) - 64); }
    return [$n-1, $row];
}
function excelTime($v) {
    // część ułamkowa = czas w dobie
    $frac = $v - floor($v);
    $secs = round($frac * 86400);
    $h = intdiv($secs, 3600); $m = intdiv($secs % 3600, 60);
    return sprintf('%02d:%02d', $h, $m);
}

$x = new SimpleXMLElement($sheetXml);
$rowsOut = [];
$count = 0;
foreach ($x->sheetData->row as $row) {
    $rnum = (int)$row['r'];
    $cells = [];
    foreach ($row->c as $c) {
        $ref = (string)$c['r'];
        [$ci, $ri] = colToIdx($ref);
        $t = (string)$c['t'];
        $v = (string)$c->v;
        if ($t === 's') { $val = $shared[(int)$v] ?? ''; }
        elseif ($t === 'inlineStr') { $val = (string)$c->is->t; }
        elseif ($v === '') { $val = ''; }
        else {
            // liczba: jeśli 0<v<1 traktuj jako czas
            $fv = (float)$v;
            if ($fv > 0 && $fv < 1) { $val = excelTime($fv) . ' (#'.$v.')'; }
            else { $val = $v; }
        }
        if ($val !== '') { $cells[$ci] = $val; }
    }
    if (!empty($cells)) {
        $rowsOut[$rnum] = $cells;
        $count++;
    }
    if ($count >= $maxRows) break;
}

echo json_encode($rowsOut, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
