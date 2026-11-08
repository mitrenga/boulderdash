<?php

class DataCommand {

  // Co se posílá při startu aplikace (M2, každý soubor dělá tools/dump*.py
  // z referenčního programu):
  //
  // - `caves`   – 20 jeskyní z tabulky $3528 (hlavička, instrukce, surové bajty)
  // - `charset` – sady $4000–$4BBF a tabulka dlaždic $3C40
  // - `texts`   – řetězce, šablony stavového řádku, titulka
  // - `global`  – mřížka, generátor, display list, pořadí jeskyní
  // - `demo`    – skript vstupů dema $3BC0 (přehrání je M5)
  // - `title`   – titulka: display list $0961, bitmapy režimu E, stavba loga $2252, animace $2425
  //
  // `screen.json` (M1: 64 KB paměti originálu) se už neposílá — zůstává jako
  // reference pro tools/matchscreen.mjs. Chybějící soubor dorazí jako null
  // a aplikace to musí přežít.
  //
  // Interní projekt (ZADANI.md §0): žádná veřejná síň slávy; hiScore je
  // z lokální tabulky, když existuje, jinak 0.
  var $files = ['caves', 'charset', 'texts', 'global', 'demo', 'title'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    $result['hiScore'] = 0;
    if (!empty($GLOBALS['dbUser']) && $GLOBALS['dbUser'] !== 'your-user-name') {
      $mysqli = @new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
      if (!$mysqli->connect_errno) {
        $data = $mysqli->query('SELECT `score` FROM `rg_bd_hallOfFame` ORDER BY `score` DESC LIMIT 1');
        if ($data && ($row = $data->fetch_object())) {
          $result['hiScore'] = $row->score;
        }
        $mysqli->close();
      }
    }

    return $result;
  } // execute

} // class DataCommand
