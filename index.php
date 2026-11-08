<?php
  // Internal project (ZADANI.md §0): never deployed anywhere public.
  $appName = 'BOULDER DASH';
  $appDescription = 'Internal remake of Boulder Dash (Atari 8-bit, 1984) — the first game on the Atari 8-bit platform of svision. Not for distribution.';
  $appPrefix = 'bd';
  $appNoscript =
    '<h1>BOULDER DASH</h1>'.
    '<p>Internal development build of a remake of the 1984 Atari 8-bit game by Peter Liepa and Chris Gray '.
    '(First Star Software). Boulder Dash and Rockford are trademarks of BBG Entertainment GmbH; this build '.
    'exists only to develop and test the Atari 8-bit platform of the svision library.</p>'.
    '<p>Please enable JavaScript to start it.</p>';
  $appJsonLd = [
    'genre' => 'Puzzle',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Boulder Dash',
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'First Star Software'],
      ],
      'datePublished' => '1984',
      'gamePlatform' => 'Atari 8-bit',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';
