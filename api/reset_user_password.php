<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if ($argc < 2 || trim($argv[1]) === '') { fwrite(STDERR, "Usage: php reset_user_password.php <username>\n"); exit(1); }
$password = getenv('BUNGAHIN_NEW_USER_PASSWORD') ?: readline('New password (minimum 16 characters): ');
if (strlen($password) < 16) { fwrite(STDERR, "Password must be at least 16 characters.\n"); exit(1); }
try {
    $local = __DIR__ . '/config.local.php';
    $config = require (file_exists($local) ? $local : __DIR__ . '/config.php');
    $pdo = new PDO("mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4", $config['db_user'], $config['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $stmt = $pdo->prepare('UPDATE users SET password_hash=? WHERE username=?');
    $stmt->execute([password_hash($password, PASSWORD_DEFAULT), trim($argv[1])]);
    if (!$stmt->rowCount()) { fwrite(STDERR, "User not found or password is unchanged.\n"); exit(1); }
    fwrite(STDOUT, "Password updated.\n");
} catch (Throwable $e) { fwrite(STDERR, "Could not update the password. Check database configuration.\n"); exit(1); }
