<?php
/**
 * GET endpoint: health/status + public game configuration.
 * Response: { ok: true, status: "up", game: { title, version }, serverTime }
 * Only non-sensitive summary fields are exposed (not the whole file path).
 */

declare(strict_types=1);
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    xbr_json_response(['ok' => true]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    xbr_json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
}

$cfg = xbr_backend_config();
$game = ['title' => 'X Battle Royale', 'version' => '1.0.0'];

if (is_file($cfg['game_config'])) {
    $raw = file_get_contents($cfg['game_config']);
    if ($raw !== false) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded) && isset($decoded['game']) && is_array($decoded['game'])) {
            if (isset($decoded['game']['title']) && is_string($decoded['game']['title'])) {
                $game['title'] = $decoded['game']['title'];
            }
            if (isset($decoded['game']['version']) && is_string($decoded['game']['version'])) {
                $game['version'] = $decoded['game']['version'];
            }
        }
    }
}

xbr_json_response([
    'ok'         => true,
    'status'     => 'up',
    'game'       => $game,
    'offlinePlay' => true,
    'serverTime' => gmdate('c'),
]);
