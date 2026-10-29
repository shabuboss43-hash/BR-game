<?php
/**
 * POST endpoint: store one finished-match result (prototype, file-based).
 *
 * Expected JSON body (all fields validated, unknown fields ignored):
 *   result          "won" | "lost"            (required)
 *   kills           int 0..64
 *   shots           int 0..100000
 *   hits            int 0..shots
 *   durationSeconds int 0..7200
 *   damageDealt     int 0..1000000
 *
 * IMPORTANT: client-submitted scores are NOT authoritative. This storage is
 * for casual local statistics only — a real competitive backend would need
 * server-authoritative match simulation.
 */

declare(strict_types=1);
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    xbr_json_response(['ok' => true]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    xbr_json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
}

$cfg = xbr_backend_config();
$length = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($length <= 0 || $length > $cfg['max_body_bytes']) {
    xbr_json_response(['ok' => false, 'error' => 'Invalid request size'], 413);
}

$raw = file_get_contents('php://input', false, null, 0, $cfg['max_body_bytes'] + 1);
if ($raw === false || strlen($raw) > $cfg['max_body_bytes']) {
    xbr_json_response(['ok' => false, 'error' => 'Invalid request body'], 400);
}

$data = json_decode($raw, true);
if (!is_array($data) || json_last_error() !== JSON_ERROR_NONE) {
    xbr_json_response(['ok' => false, 'error' => 'Malformed JSON'], 400);
}

/** Validate an integer field inside a permitted range. */
function xbr_int_field(array $data, string $key, int $min, int $max, int $default): int
{
    if (!array_key_exists($key, $data)) {
        return $default;
    }
    $v = filter_var($data[$key], FILTER_VALIDATE_INT, [
        'options' => ['min_range' => $min, 'max_range' => $max],
    ]);
    if ($v === false) {
        xbr_json_response(['ok' => false, 'error' => "Invalid value for {$key}"], 422);
    }
    return $v;
}

$result = $data['result'] ?? null;
if ($result !== 'won' && $result !== 'lost') {
    xbr_json_response(['ok' => false, 'error' => 'Invalid value for result'], 422);
}

$record = [
    'result'          => $result,
    'kills'           => xbr_int_field($data, 'kills', 0, 64, 0),
    'shots'           => xbr_int_field($data, 'shots', 0, 100000, 0),
    'hits'            => xbr_int_field($data, 'hits', 0, 100000, 0),
    'durationSeconds' => xbr_int_field($data, 'durationSeconds', 0, 7200, 0),
    'damageDealt'     => xbr_int_field($data, 'damageDealt', 0, 1000000, 0),
    'recordedAt'      => gmdate('c'),
];
if ($record['hits'] > $record['shots']) {
    xbr_json_response(['ok' => false, 'error' => 'hits cannot exceed shots'], 422);
}

// Append one JSON line with an exclusive lock. The storage directory and
// filename are fixed server-side values — never taken from the request.
if (!is_dir($cfg['data_dir']) && !mkdir($cfg['data_dir'], 0750, true) && !is_dir($cfg['data_dir'])) {
    xbr_json_response(['ok' => false, 'error' => 'Storage unavailable'], 500);
}
$line = json_encode($record, JSON_UNESCAPED_SLASHES);
if ($line === false || file_put_contents($cfg['results_file'], $line . PHP_EOL, FILE_APPEND | LOCK_EX) === false) {
    xbr_json_response(['ok' => false, 'error' => 'Storage unavailable'], 500);
}

xbr_json_response(['ok' => true, 'stored' => true]);
