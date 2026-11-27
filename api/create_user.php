<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if ($argc < 4) {
    fwrite(STDERR, "Usage: php create_user.php <username> <full-name> <admin|staff|resident> [resident-code]\n");
    exit(1);
}
$username = trim($argv[1]);
$fullName = trim($argv[2]);
$role = $argv[3];
if ($username === '' || $fullName === '' || !in_array($role, ['staff', 'secretary', 'admin', 'resident'], true)) {
    fwrite(STDERR, "Username/full name are required. Role must be admin, staff, or resident.\n"); exit(1);
}
if ($role === 'resident' && empty($argv[4])) { fwrite(STDERR, "A resident account must be linked to a registered resident code.\n"); exit(1); }
$password = getenv('BUNGAHIN_NEW_USER_PASSWORD') ?: readline('Password (minimum 10 characters): ');
if (strlen($password) < 10) { fwrite(STDERR, "Password must be at least 10 characters.\n"); exit(1); }
try {
    $local = __DIR__ . '/config.local.php';
    $config = require (file_exists($local) ? $local : __DIR__ . '/config.php');
    $pdo = new PDO("mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4", $config['db_user'], $config['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $residentId = null;
    if ($role === 'resident') {
        $lookup = $pdo->prepare('SELECT id FROM residents WHERE resident_code=? LIMIT 1');
        $lookup->execute([trim($argv[4])]);
        $residentId = $lookup->fetchColumn();
        if (!$residentId) { fwrite(STDERR, "No resident found with code {$argv[4]}.\n"); exit(1); }
    }
    $stmt = $pdo->prepare('INSERT INTO users(full_name,username,password_hash,role,resident_id) VALUES(?,?,?,?,?)');
    $stmt->execute([$fullName, $username, password_hash($password, PASSWORD_DEFAULT), $role, $residentId]);
    fwrite(STDOUT, $role === 'resident' ? "Resident account created and linked.\n" : "Staff account created. You can now sign in to the staff dashboard.\n");
} catch (PDOException $e) {
    fwrite(STDERR, $e->getCode() === '23000' ? "That username already exists.\n" : "Could not create user. Check your database configuration.\n");
    exit(1);
}
