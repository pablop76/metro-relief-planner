<?php
// Parser pre-wypakowanych XML -> JSON
// php parse_xml.php <sharedStrings.xml> <sheetN.xml> <maxRows>
$ssFile = $argv[1];
$sheetFile = $argv[2];
$maxRows = (int)($argv[3] ?? 40);

$shared = [];
if (is_file($ssFile)) {
    $x = simplexml_load_file($ssFile);
    foreach ($x->si as $si) {
        $text = '';
        if (isset($si->t)) $text = (string)$si->t;
        if (isset($si->r)) foreach ($si->r as $r) $text .= (string)$r->t;
        $shared[] = $text;
    }
}

function colToIdx($ref){ preg_match('/^([A-Z]+)(\d+)$/',$ref,$m); $col=$m[1]; $n=0;
  for($i=0;$i<strlen($col);$i++) $n=$n*26+(ord($col[$i])-64); return $n-1; }
function excelTime($v){ $frac=$v-floor($v); $secs=round($frac*86400);
  $h=intdiv($secs,3600); $m=intdiv($secs%3600,60); return sprintf('%02d:%02d',$h,$m); }

$x = simplexml_load_file($sheetFile);
$rowsOut=[]; $count=0;
foreach ($x->sheetData->row as $row) {
    $rnum=(int)$row['r']; $cells=[];
    foreach ($row->c as $c) {
        $ci=colToIdx((string)$c['r']); $t=(string)$c['t']; $v=(string)$c->v;
        if ($t==='s') $val=$shared[(int)$v]??'';
        elseif ($t==='inlineStr') $val=(string)$c->is->t;
        elseif ($v==='') $val='';
        else { $fv=(float)$v; $val=($fv>0&&$fv<1)?excelTime($fv):$v; }
        if ($val!=='') $cells[$ci]=$val;
    }
    if (!empty($cells)){ $rowsOut[$rnum]=$cells; $count++; }
    if ($count>=$maxRows) break;
}
echo json_encode($rowsOut, JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT);
