<?php
/**
 * X Battle Royale — optional PHP backend configuration.
 * The offline game does NOT need this file (or PHP at all).
 * Keep real secrets out of this file in production deployments.
 */

declare(strict_types=1);

function xbr_backend_config(): array
{
    return [
        // Directory (outside the web root if possible) for result storage.
        'data_dir'        => __DIR__ . '/data',
        'results_file'    => __DIR__ . '/data/results.jsonl',
        // Game config served by get-config.php (project-root config.json).
        'game_config'     => __DIR__ . '/../config.json',
        // Hard request-size cap for save-result.php (bytes).
        'max_body_bytes'  => 4096,
        // Allowed origins for CORS ('*' is fine for a local prototype only).
        'cors_origin'     => '*',
    ];
}

/** Send a JSON response with a correct status code and end the request. */
function xbr_json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    $cfg = xbr_backend_config();
    header('Access-Control-Allow-Origin: ' . $cfg['cors_origin']);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}
