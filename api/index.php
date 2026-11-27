<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ['http://localhost:5173', 'http://127.0.0.1:5173'], true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
session_start();

function reply(int $status, array $body): never {
    http_response_code($status); echo json_encode($body, JSON_UNESCAPED_UNICODE); exit;
}
function body(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) reply(400, ['error' => 'Expected a JSON object']);
    return $data;
}
function required(array $data, array $fields): void {
    foreach ($fields as $field) if (!isset($data[$field]) || trim((string)$data[$field]) === '') reply(422, ['error' => "$field is required"]);
}
function phone_e164(string $phone): ?string {
    $digits = preg_replace('/\D+/', '', $phone);
    if (preg_match('/^0(9\d{9})$/', $digits, $m)) return '+63' . $m[1];
    if (preg_match('/^63(9\d{9})$/', $digits, $m)) return '+' . $digits;
    if (preg_match('/^9\d{9}$/', $digits)) return '+63' . $digits;
    if (preg_match('/^\d{8,15}$/', $digits) && str_starts_with($phone, '+')) return '+' . $digits;
    return null;
}
function branded_sms(string $message): string {
    $message = trim($message);
    if (preg_match('/^Barangay Bungahin\s*:/i', $message)) return $message;
    return 'Barangay Bungahin: ' . $message;
}
function textbee_send(array $config, string $message, array $recipients): array {
    $apiKey = trim((string)($config['textbee_api_key'] ?? ''));
    if ($apiKey === '') $apiKey = trim((string)(getenv('TEXTBEE_API_KEY') ?: ''));
    if ($apiKey === '') return ['configured' => false, 'accepted' => false, 'error' => 'TextBee API key is not configured.'];
    if (!function_exists('curl_init')) return ['configured' => true, 'accepted' => false, 'error' => 'PHP cURL extension is not enabled.'];
    $base = rtrim((string)($config['textbee_base_url'] ?? 'https://api.textbee.dev/api/v1'), '/');
    $payload = ['message' => branded_sms($message), 'recipients' => array_values($recipients)];
    $deviceId = trim((string)($config['textbee_device_id'] ?? ''));
    if ($deviceId === '') $deviceId = trim((string)(getenv('TEXTBEE_DEVICE_ID') ?: ''));
    if ($deviceId !== '') $payload['deviceId'] = $deviceId;
    $curl = curl_init($base . '/gateway/send-sms');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . $apiKey],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    $raw = curl_exec($curl); $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE); $curlError = curl_error($curl); curl_close($curl);
    if ($raw === false) return ['configured' => true, 'accepted' => false, 'error' => $curlError ?: 'Could not connect to TextBee.'];
    $decoded = json_decode($raw, true);
    $data = $decoded['data'] ?? $decoded ?? [];
    if ($status < 200 || $status >= 300 || empty($data['success'])) {
        $messageText = $decoded['message'] ?? $data['message'] ?? 'TextBee rejected the SMS batch.';
        return ['configured' => true, 'accepted' => false, 'error' => substr((string)$messageText, 0, 240), 'http_status' => $status];
    }
    return ['configured' => true, 'accepted' => true, 'batch_id' => $data['smsBatchId'] ?? null, 'recipient_count' => (int)($data['recipientCount'] ?? count($recipients))];
}
try {
    $configFile = __DIR__ . '/config.local.php';
    $config = require (file_exists($configFile) ? $configFile : __DIR__ . '/config.php');
    $pdo = new PDO("mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4", $config['db_user'], $config['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) { reply(503, ['error' => 'Database unavailable. Check api/config.local.php and import database.sql.']); }

$method = $_SERVER['REQUEST_METHOD'];
$resource = $_GET['resource'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
if ($resource === 'health' && $method === 'GET') reply(200, ['ok' => true, 'database' => 'connected']);

if ($resource === 'auth' && $method === 'POST') {
    $d = body();
    $action = $d['action'] ?? '';
    if ($action === 'login') {
        required($d, ['username', 'password']);
        $loginName = trim($d['username']);
        $stmt = $pdo->prepare('SELECT id, full_name, username, password_hash, role, resident_id FROM users WHERE username = ? OR email = ? ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END LIMIT 1');
        $stmt->execute([$loginName, $loginName, $loginName]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($d['password'], $user['password_hash'])) reply(401, ['error' => 'Incorrect username or password.']);
        session_regenerate_id(true);
        if ($user['role'] === 'resident') {
            if (empty($user['resident_id'])) reply(403, ['error' => 'This resident account is not linked to a resident record.']);
            $profile = $pdo->prepare('SELECT 1 FROM residents WHERE id=? LIMIT 1'); $profile->execute([$user['resident_id']]);
            if (!$profile->fetchColumn()) reply(403, ['error' => 'The resident profile linked to this account could not be found. Ask staff to relink the account.']);
        }
        $_SESSION['user'] = ['id' => (int)$user['id'], 'full_name' => $user['full_name'], 'username' => $user['username'], 'role' => $user['role'], 'resident_id' => $user['resident_id'] ? (int)$user['resident_id'] : null];
        reply(200, ['user' => $_SESSION['user']]);
    }
    if ($action === 'logout') { $_SESSION = []; session_destroy(); reply(200, ['ok' => true]); }
    reply(422, ['error' => 'Unsupported authentication action']);
}
if ($resource === 'auth' && $method === 'GET') {
    if (empty($_SESSION['user'])) reply(401, ['error' => 'Not signed in']);
    $stmt = $pdo->prepare('SELECT id,full_name,username,role,resident_id FROM users WHERE id=? LIMIT 1');
    $stmt->execute([$_SESSION['user']['id']]);
    $user = $stmt->fetch();
    if (!$user) { $_SESSION = []; session_destroy(); reply(401, ['error' => 'This account no longer exists. Sign in again.']); }
    if ($user['role'] === 'resident') {
        $profile = $pdo->prepare('SELECT 1 FROM residents WHERE id=? LIMIT 1'); $profile->execute([$user['resident_id']]);
        if (!$profile->fetchColumn()) reply(403, ['error' => 'The resident profile linked to this account could not be found. Ask staff to relink the account.']);
    }
    $_SESSION['user'] = ['id'=>(int)$user['id'],'full_name'=>$user['full_name'],'username'=>$user['username'],'role'=>$user['role'],'resident_id'=>$user['resident_id'] ? (int)$user['resident_id'] : null];
    reply(200, ['user' => $_SESSION['user']]);
}
if (empty($_SESSION['user'])) reply(401, ['error' => 'Please sign in to continue.']);
$currentUser = $_SESSION['user'];
$isResident = $currentUser['role'] === 'resident';
$canManageRecords = in_array($currentUser['role'], ['admin','secretary','staff'], true);
$isAdmin = $currentUser['role'] === 'admin';

// Document attachments are stored in a web-denied directory and streamed only to admins.
if ($resource === 'document-file' && $method === 'GET') {
    if (!$isAdmin) reply(403, ['error' => 'Only an administrator can access barangay documents.']);
    try {
        $stmt = $pdo->prepare('SELECT original_file_name, stored_file_name FROM documents WHERE id=? AND stored_file_name IS NOT NULL LIMIT 1');
        $stmt->execute([$id]);
        $documentFile = $stmt->fetch();
        if (!$documentFile) reply(404, ['error' => 'Document attachment not found.']);
        $filePath = __DIR__ . '/storage/documents/' . basename((string)$documentFile['stored_file_name']);
        if (!is_file($filePath)) reply(404, ['error' => 'The document file is missing from server storage.']);
        $downloadName = preg_replace('/[^A-Za-z0-9._ -]/', '_', basename((string)$documentFile['original_file_name']));
        header_remove('Content-Type');
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $downloadName) . '"');
        header('Content-Length: ' . filesize($filePath));
        header('X-Content-Type-Options: nosniff');
        readfile($filePath);
        exit;
    } catch (Throwable $e) { reply(500, ['error' => 'Could not retrieve document attachment.']); }
}

try {
    if ($resource === 'documents') {
        if (!$isAdmin) reply(403, ['error' => 'Only an administrator can manage barangay documents.']);
        if ($method === 'GET') {
            $stmt = $pdo->query("SELECT d.id,d.title,d.document_type,d.description,d.status,DATE_FORMAT(d.document_date,'%b %e, %Y') AS document_date,d.original_file_name,d.created_at,u.full_name AS added_by FROM documents d LEFT JOIN users u ON u.id=d.created_by ORDER BY d.document_date DESC,d.created_at DESC LIMIT 1000");
            reply(200, ['data' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $title = trim((string)($_POST['title'] ?? ''));
            $documentType = trim((string)($_POST['document_type'] ?? ''));
            $description = trim((string)($_POST['description'] ?? ''));
            $status = (string)($_POST['status'] ?? 'implemented');
            $documentDate = (string)($_POST['document_date'] ?? '');
            if ($title === '' || $documentType === '' || $documentDate === '') reply(422, ['error' => 'Title, document type, and date are required.']);
            if (mb_strlen($title) > 160 || mb_strlen($documentType) > 80 || mb_strlen($description) > 2000) reply(422, ['error' => 'Title, document type, or description exceeds the allowed length.']);
            if (!in_array($status, ['draft','implemented','archived'], true)) reply(422, ['error' => 'Choose a valid document status.']);
            $date = DateTime::createFromFormat('!Y-m-d', $documentDate);
            if (!$date || $date->format('Y-m-d') !== $documentDate) reply(422, ['error' => 'Enter a valid document date.']);

            $originalName = null; $storedName = null; $filePath = null;
            if (isset($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE) {
                $file = $_FILES['file'];
                if ($file['error'] !== UPLOAD_ERR_OK) reply(422, ['error' => 'The attachment could not be uploaded.']);
                if ((int)$file['size'] > 10 * 1024 * 1024) reply(422, ['error' => 'The attachment must be 10 MB or smaller.']);
                $extension = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));
                if ($extension !== 'pdf') reply(422, ['error' => 'Only PDF attachments are supported.']);
                $finfo = new finfo(FILEINFO_MIME_TYPE);
                if ($finfo->file($file['tmp_name']) !== 'application/pdf') reply(422, ['error' => 'The attachment must be a valid PDF file.']);
                $originalName = basename((string)$file['name']);
                $storedName = bin2hex(random_bytes(20)) . '.pdf';
                $storage = __DIR__ . '/storage/documents';
                if (!is_dir($storage) && !mkdir($storage, 0700, true) && !is_dir($storage)) reply(500, ['error' => 'Could not create private document storage.']);
                $filePath = $storage . DIRECTORY_SEPARATOR . $storedName;
                if (!move_uploaded_file($file['tmp_name'], $filePath)) reply(500, ['error' => 'Could not save the uploaded attachment.']);
            }

            try {
                $stmt = $pdo->prepare('INSERT INTO documents(title,document_type,description,status,document_date,original_file_name,stored_file_name,created_by) VALUES(?,?,?,?,?,?,?,?)');
                $stmt->execute([$title,$documentType,$description !== '' ? $description : null,$status,$documentDate,$originalName,$storedName,(int)$currentUser['id']]);
                reply(201, ['id' => (int)$pdo->lastInsertId()]);
            } catch (Throwable $e) {
                if ($filePath && is_file($filePath)) unlink($filePath);
                throw $e;
            }
        }
    }

    if ($resource === 'residents') {
        if ($method === 'GET') {
            $q = trim($_GET['q'] ?? '');
            $accountFields = $isAdmin ? ',u.email,(u.id IS NOT NULL) AS has_login' : ',NULL AS email,0 AS has_login';
            $sql = "SELECT r.id AS db_id,r.resident_code AS id,r.resident_code,CONCAT_WS(' ',r.first_name,NULLIF(r.middle_name,''),r.last_name) AS name,COALESCE(h.household_name,'') AS household,r.purok,r.birth_date,IF(r.birth_date IS NULL,NULL,TIMESTAMPDIFF(YEAR,r.birth_date,CURDATE())) AS age,r.phone,CASE r.status WHEN 'active' THEN 'Active' WHEN 'senior' THEN 'Senior' ELSE 'Inactive' END AS status,r.sms_opt_in$accountFields FROM residents r LEFT JOIN households h ON h.id=r.household_id LEFT JOIN users u ON u.id=(SELECT MIN(ru.id) FROM users ru WHERE ru.resident_id=r.id AND ru.role='resident')";
            $params = [];
            $filters = [];
            if ($isResident) { $filters[] = 'r.id=?'; $params[] = $currentUser['resident_id']; }
            if ($q !== '') { $filters[] = "CONCAT_WS(' ',r.first_name,r.middle_name,r.last_name,r.resident_code,r.purok) LIKE ?"; $params[] = "%$q%"; }
            if ($filters) $sql .= ' WHERE ' . implode(' AND ', $filters);
            $sql .= ' ORDER BY r.last_name,r.first_name LIMIT 1000';
            $stmt = $pdo->prepare($sql); $stmt->execute($params); reply(200, ['data' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            if (!$canManageRecords) reply(403, ['error' => 'Only staff can register residents.']);
            $d = body(); required($d, ['first_name','last_name','purok','email','password']);
            $email = strtolower(trim((string)$d['email']));
            $password = (string)$d['password'];
            if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) reply(422, ['error' => 'Enter a valid resident email address.']);
            if (strlen($password) < 10 || strlen($password) > 200) reply(422, ['error' => 'Resident password must be between 10 and 200 characters.']);
            $pdo->beginTransaction();
            $householdId = null;
            if (trim($d['household'] ?? '') !== '') {
                $h = $pdo->prepare('SELECT id FROM households WHERE household_name=? AND purok=? LIMIT 1'); $h->execute([trim($d['household']),$d['purok']]); $householdId = $h->fetchColumn();
                if (!$householdId) { $h = $pdo->prepare('INSERT INTO households(household_name,purok) VALUES(?,?)'); $h->execute([trim($d['household']),$d['purok']]); $householdId=(int)$pdo->lastInsertId(); }
            }
            $code = $d['resident_code'] ?? ('BRG-' . date('Y') . '-' . strtoupper(bin2hex(random_bytes(3))));
            $stmt = $pdo->prepare('INSERT INTO residents (resident_code,household_id,first_name,middle_name,last_name,birth_date,sex,civil_status,phone,purok,address,status,sms_opt_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
            $stmt->execute([$code,$householdId,$d['first_name'],$d['middle_name'] ?? null,$d['last_name'],$d['birth_date'] ?: null,$d['sex'] ?? 'unspecified',$d['civil_status'] ?? null,$d['phone'] ?? null,$d['purok'],$d['address'] ?? null,$d['status'] ?? 'active',(int)($d['sms_opt_in'] ?? 0)]);
            $newId=(int)$pdo->lastInsertId();
            $fullName = trim(implode(' ', array_filter([$d['first_name'],$d['middle_name'] ?? null,$d['last_name']])));
            $username = 'resident-' . $newId;
            $account = $pdo->prepare("INSERT INTO users(full_name,username,email,password_hash,role,resident_id) VALUES(?,?,?,?, 'resident',?)");
            $account->execute([$fullName,$username,$email,password_hash($password, PASSWORD_DEFAULT),$newId]);
            $pdo->commit(); reply(201, ['db_id' => $newId, 'id' => $code, 'account_created' => true]);
        }
        if ($method === 'PATCH' && $id) {
            $d = body();
            if ($isResident) {
                if ($id !== (int)$currentUser['resident_id']) reply(403, ['error' => 'You can only update your own contact preferences.']);
                $unknown = array_diff(array_keys($d), ['phone','sms_opt_in']);
                if ($unknown) reply(403, ['error' => 'Residents may only update their phone number and SMS consent.']);
                if (array_key_exists('phone',$d)) {
                    $d['phone'] = trim((string)$d['phone']);
                    if (strlen($d['phone']) > 20) reply(422, ['error' => 'Phone number must be 20 characters or fewer.']);
                }
                if (array_key_exists('sms_opt_in',$d)) {
                    $d['sms_opt_in'] = filter_var($d['sms_opt_in'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                    if ($d['sms_opt_in'] === null) reply(422, ['error' => 'SMS consent must be enabled or disabled.']);
                    $d['sms_opt_in'] = (int)$d['sms_opt_in'];
                }
                if (($d['sms_opt_in'] ?? 0) === 1 && !phone_e164((string)($d['phone'] ?? ''))) reply(422, ['error' => 'Enter a valid mobile number before enabling SMS notifications.']);
                if (!$d) reply(422, ['error' => 'No contact preferences supplied.']);
                $sets=[]; $values=[];
                foreach (['phone','sms_opt_in'] as $field) if (array_key_exists($field,$d)) { $sets[]="$field = ?"; $values[]=$d[$field] === '' ? null : $d[$field]; }
                $values[]=$id;
                $stmt=$pdo->prepare('UPDATE residents SET '.implode(',',$sets).' WHERE id=?'); $stmt->execute($values);
                reply(200, ['updated'=>true]);
            }
            if (!$canManageRecords) reply(403, ['error' => 'Only staff can edit resident records.']);
            $credentialsRequested = array_key_exists('email', $d) || array_key_exists('password', $d);
            if ($credentialsRequested && !$canManageRecords) reply(403, ['error' => 'Only authorized staff can change resident login credentials.']);
            $accountEmail = null;
            $newPassword = null;
            if (array_key_exists('email', $d)) {
                $accountEmail = strtolower(trim((string)$d['email']));
                if (strlen($accountEmail) > 254 || !filter_var($accountEmail, FILTER_VALIDATE_EMAIL)) reply(422, ['error' => 'Enter a valid resident email address.']);
                unset($d['email']);
            }
            if (array_key_exists('password', $d)) {
                $newPassword = (string)$d['password'];
                if ($newPassword !== '' && (strlen($newPassword) < 10 || strlen($newPassword) > 200)) reply(422, ['error' => 'Resident password must be between 10 and 200 characters.']);
                unset($d['password']);
            }
            if ($credentialsRequested) {
                $residentExists = $pdo->prepare('SELECT 1 FROM residents WHERE id=? LIMIT 1');
                $residentExists->execute([$id]);
                if (!$residentExists->fetchColumn()) reply(404, ['error'=>'Resident record not found.']);
                $pdo->beginTransaction();
            }
            if (array_key_exists('household',$d)) {
                $householdId = null;
                if (trim((string)$d['household']) !== '' && !empty($d['purok'])) {
                    $h=$pdo->prepare('SELECT id FROM households WHERE household_name=? AND purok=? LIMIT 1'); $h->execute([trim($d['household']),$d['purok']]); $householdId=$h->fetchColumn();
                    if (!$householdId) { $h=$pdo->prepare('INSERT INTO households(household_name,purok) VALUES(?,?)'); $h->execute([trim($d['household']),$d['purok']]); $householdId=(int)$pdo->lastInsertId(); }
                }
                $d['household_id']=$householdId; unset($d['household']);
            }
            if (($d['status'] ?? '') === 'Active') $d['status']='active'; if (($d['status'] ?? '') === 'Senior') $d['status']='senior'; if (($d['status'] ?? '') === 'Inactive') $d['status']='inactive';
            $allowed = ['household_id','first_name','middle_name','last_name','birth_date','sex','civil_status','phone','purok','address','status','sms_opt_in'];
            $sets=[]; $values=[]; foreach ($allowed as $f) if (array_key_exists($f,$d)) { $sets[]="$f = ?"; $values[]=$d[$f]; }
            if (!$sets && !$credentialsRequested) reply(422,['error'=>'No editable fields supplied']);
            if ($sets) { $values[]=$id; $stmt=$pdo->prepare('UPDATE residents SET '.implode(',',$sets).' WHERE id=?'); $stmt->execute($values); }
            if ($credentialsRequested) {
                $accountQuery = $pdo->prepare("SELECT id FROM users WHERE resident_id=? AND role='resident' ORDER BY id LIMIT 1");
                $accountQuery->execute([$id]);
                $accountId = $accountQuery->fetchColumn();
                $profile=$pdo->prepare("SELECT CONCAT_WS(' ',first_name,NULLIF(middle_name,''),last_name) FROM residents WHERE id=? LIMIT 1");
                $profile->execute([$id]); $fullName=(string)$profile->fetchColumn();
                if ($accountId) {
                    $accountSets = ['full_name=?']; $accountValues = [$fullName];
                    if ($accountEmail !== null) { $accountSets[]='email=?'; $accountValues[]=$accountEmail; }
                    if ($newPassword !== null && $newPassword !== '') { $accountSets[]='password_hash=?'; $accountValues[]=password_hash($newPassword, PASSWORD_DEFAULT); }
                    if ($accountSets) { $accountValues[]=$accountId; $updateAccount=$pdo->prepare('UPDATE users SET '.implode(',',$accountSets).' WHERE id=?'); $updateAccount->execute($accountValues); }
                } else {
                    if ($accountEmail === null || $newPassword === null || $newPassword === '') { $pdo->rollBack(); reply(422, ['error'=>'This resident has no login yet. Enter an email and a password of at least 10 characters to create one.']); }
                    $username='resident-'.$id;
                    $createAccount=$pdo->prepare("INSERT INTO users(full_name,username,email,password_hash,role,resident_id) VALUES(?,?,?,?, 'resident',?)");
                    $createAccount->execute([$fullName,$username,$accountEmail,password_hash($newPassword,PASSWORD_DEFAULT),$id]);
                }
                $pdo->commit();
            }
            reply(200,['updated'=>1,'credentials_updated'=>$credentialsRequested]);
        }
        if ($method === 'DELETE' && $id) { if (!$canManageRecords) reply(403,['error'=>'Only staff can delete resident records.']); $s=$pdo->prepare('DELETE FROM residents WHERE id=?'); $s->execute([$id]); reply(200,['deleted'=>$s->rowCount()]); }
    }
    if ($resource === 'requests') {
        if ($method === 'GET') { $sql="SELECT c.id AS db_id,c.request_code AS id,CONCAT_WS(' ',r.first_name,NULLIF(r.middle_name,''),r.last_name) AS resident,r.resident_code,r.address,r.purok,c.document_type AS type,DATE_FORMAT(c.requested_at,'%b %e, %Y') AS date,DATE_FORMAT(c.estimated_pickup_date,'%Y-%m-%d') AS estimated_pickup_date,c.purpose,CASE c.status WHEN 'ready_for_pickup' THEN 'Ready for pickup' WHEN 'processing' THEN 'Processing' WHEN 'completed' THEN 'Completed' WHEN 'rejected' THEN 'Rejected' ELSE 'Pending' END AS status FROM certificate_requests c JOIN residents r ON r.id=c.resident_id"; if($isResident){$sql.=' WHERE c.resident_id=?';$s=$pdo->prepare($sql.' ORDER BY c.requested_at DESC LIMIT 1000');$s->execute([$currentUser['resident_id']]);}else{$s=$pdo->query($sql.' ORDER BY c.requested_at DESC LIMIT 1000');} reply(200,['data'=>$s->fetchAll()]); }
        if ($method === 'POST') { $d=body(); required($d,['resident_id','document_type','purpose']); if($isResident && (int)$d['resident_id'] !== (int)$currentUser['resident_id']) reply(403,['error'=>'You can only request documents for your own resident record.']); $code=$d['request_code']??('REQ-'.date('Y').'-'.strtoupper(bin2hex(random_bytes(3)))); $s=$pdo->prepare('INSERT INTO certificate_requests(request_code,resident_id,document_type,purpose) VALUES(?,?,?,?)'); $s->execute([$code,$d['resident_id'],$d['document_type'],$d['purpose']]); reply(201,['db_id'=>(int)$pdo->lastInsertId(),'id'=>$code]); }
        if ($method === 'PATCH' && $id) {
            if (!$canManageRecords) reply(403, ['error' => 'Only staff can update certificate requests.']);
            $d = body();
            $hasPickupDate = array_key_exists('estimated_pickup_date', $d);
            $pickupDate = null;
            if ($hasPickupDate && $d['estimated_pickup_date'] !== null && $d['estimated_pickup_date'] !== '') {
                if (!is_string($d['estimated_pickup_date'])) reply(422, ['error' => 'Enter a valid estimated pickup date.']);
                $pickupDate = $d['estimated_pickup_date'];
                $date = DateTime::createFromFormat('!Y-m-d', $pickupDate);
                if (!$date || $date->format('Y-m-d') !== $pickupDate) reply(422, ['error' => 'Enter a valid estimated pickup date.']);
            }
            if (!array_key_exists('status', $d)) {
                if (!$hasPickupDate) reply(422, ['error' => 'No request update supplied.']);
                $exists = $pdo->prepare('SELECT 1 FROM certificate_requests WHERE id=? LIMIT 1');
                $exists->execute([$id]);
                if (!$exists->fetchColumn()) reply(404, ['error' => 'Certificate request not found.']);
                $saveDate = $pdo->prepare('UPDATE certificate_requests SET estimated_pickup_date=? WHERE id=?');
                $saveDate->execute([$pickupDate,$id]);
                reply(200, ['updated'=>true, 'estimated_pickup_date'=>$pickupDate]);
            }
            $statuses = ['Pending'=>'pending','Processing'=>'processing','Ready for pickup'=>'ready_for_pickup','Completed'=>'completed','Rejected'=>'rejected'];
            $status = $statuses[$d['status'] ?? ''] ?? ($d['status'] ?? '');
            if (!in_array($status, ['pending','processing','ready_for_pickup','completed','rejected'], true)) reply(422, ['error' => 'Invalid status']);

            $lookup = $pdo->prepare('SELECT c.status,c.request_code,c.document_type,c.resident_id,r.phone,CONCAT_WS(\' \',r.first_name,NULLIF(r.middle_name,\'\'),r.last_name) AS resident_name FROM certificate_requests c JOIN residents r ON r.id=c.resident_id WHERE c.id=? LIMIT 1');
            $lookup->execute([$id]);
            $request = $lookup->fetch();
            if (!$request) reply(404, ['error' => 'Certificate request not found.']);
            if ($request['status'] === $status) {
                if ($hasPickupDate) {
                    $saveDate = $pdo->prepare('UPDATE certificate_requests SET estimated_pickup_date=? WHERE id=?');
                    $saveDate->execute([$pickupDate,$id]);
                }
                reply(200, ['updated'=>0, 'changed'=>false, 'notification'=>null]);
            }

            $pdo->beginTransaction();
            if ($hasPickupDate) {
                $updateRequest = $pdo->prepare('UPDATE certificate_requests SET status=?,estimated_pickup_date=? WHERE id=?');
                $updateRequest->execute([$status,$pickupDate,$id]);
            } else {
                $updateRequest = $pdo->prepare('UPDATE certificate_requests SET status=? WHERE id=?');
                $updateRequest->execute([$status,$id]);
            }
            $statusLabel = [
                'pending'=>'Pending',
                'processing'=>'Processing',
                'ready_for_pickup'=>'Ready for pickup',
                'completed'=>'Completed',
                'rejected'=>'Rejected',
            ][$status];
            $smsText = 'Barangay Bungahin: Your ' . $request['document_type'] . ' request (' . $request['request_code'] . ') status is now ' . $statusLabel . '. Please contact the barangay office if you need assistance.';
            $notification = ['status'=>'skipped','message'=>'No valid mobile number is registered for this resident.'];
            $logId = null;
            if (!empty($request['phone'])) {
                $phone = phone_e164((string)$request['phone']);
                if ($phone === null) {
                    $log = $pdo->prepare("INSERT INTO sms_logs(certificate_request_id,resident_id,phone,message,status,error_message) VALUES(?,?,?,?,'failed',?)");
                    $log->execute([$id,$request['resident_id'],$request['phone'],$smsText,'Invalid phone number format.']);
                    $notification = ['status'=>'failed','message'=>'The resident phone number is not valid for SMS.'];
                } else {
                    $log = $pdo->prepare("INSERT INTO sms_logs(certificate_request_id,resident_id,phone,message,status) VALUES(?,?,?,?,'queued')");
                    $log->execute([$id,$request['resident_id'],$request['phone'],$smsText]);
                    $logId = (int)$pdo->lastInsertId();
                    $notification = ['status'=>'queued','message'=>'Status saved; SMS is queued until TextBee is configured.'];
                }
            }
            $pdo->commit();

            if ($logId !== null) {
                $provider = textbee_send($config, $smsText, [phone_e164((string)$request['phone'])]);
                if (!empty($provider['accepted'])) {
                    $saveProviderId = $pdo->prepare('UPDATE sms_logs SET provider_message_id=? WHERE id=?');
                    $saveProviderId->execute([$provider['batch_id'] ?? null,$logId]);
                    $notification = ['status'=>'accepted','message'=>'TextBee accepted the SMS. Phone delivery is still pending.'];
                } elseif (!empty($provider['configured'])) {
                    $failure = substr((string)($provider['error'] ?? 'TextBee could not send the SMS.'),0,240);
                    $markFailed = $pdo->prepare("UPDATE sms_logs SET status='failed',error_message=? WHERE id=?");
                    $markFailed->execute([$failure,$logId]);
                    $notification = ['status'=>'failed','message'=>'Status saved, but TextBee could not accept the SMS.'];
                } else {
                    $failure = substr((string)($provider['error'] ?? 'TextBee is not configured.'),0,240);
                    $markFailed = $pdo->prepare("UPDATE sms_logs SET status='failed',error_message=? WHERE id=?");
                    $markFailed->execute([$failure,$logId]);
                    $notification = ['status'=>'failed','message'=>'Status saved, but TextBee is not configured. No SMS was sent.'];
                }
            }
            reply(200, ['updated'=>1, 'changed'=>true, 'notification'=>$notification]);
        }
    }
    if ($resource === 'announcements') {
        if ($method === 'GET') {
            $sql="SELECT a.id,a.title,a.message AS text,DATE_FORMAT(a.created_at,'%b %e, %Y') AS date,CASE WHEN a.audience='purok' THEN CONCAT(a.audience_purok) ELSE 'All residents' END AS audience,COUNT(CASE WHEN l.status IN ('queued','sent') THEN 1 END) AS sent FROM announcements a LEFT JOIN sms_logs l ON l.announcement_id=a.id";
            if ($isResident) {
                $sql.=" WHERE a.audience='all' OR (a.audience='purok' AND a.audience_purok=(SELECT r.purok FROM residents r WHERE r.id=?))";
                $s=$pdo->prepare($sql.' GROUP BY a.id ORDER BY a.created_at DESC LIMIT 500');
                $s->execute([$currentUser['resident_id']]);
            } else $s=$pdo->query($sql.' GROUP BY a.id ORDER BY a.created_at DESC LIMIT 500');
            reply(200,['data'=>$s->fetchAll()]);
        }
        if ($method === 'POST') {
            if (!$canManageRecords) reply(403,['error'=>'Only staff can post announcements.']);
            $d=body(); required($d,['title','message']); if (mb_strlen($d['message'])>300) reply(422,['error'=>'Message must be at most 300 characters']);
            $audience=$d['audience']??'all'; if (!in_array($audience,['all','purok'],true)) reply(422,['error'=>'Invalid audience']);
            if ($audience === 'purok' && empty($d['audience_purok'])) reply(422,['error'=>'A purok must be selected.']);
            $pdo->beginTransaction(); $s=$pdo->prepare('INSERT INTO announcements(title,message,audience,audience_purok) VALUES(?,?,?,?)'); $s->execute([trim($d['title']),$d['message'],$audience,$d['audience_purok']??null]); $announcementId=(int)$pdo->lastInsertId();
            $sql="SELECT id,phone FROM residents WHERE phone IS NOT NULL AND phone <> '' AND sms_opt_in=1"; $params=[]; if($audience==='purok'){ $sql.=' AND purok=?'; $params[]=$d['audience_purok']??''; }
            $recipients=$pdo->prepare($sql); $recipients->execute($params); $recipientRows=$recipients->fetchAll();
            $smsMessage=branded_sms((string)$d['message']);
            $log=$pdo->prepare("INSERT INTO sms_logs(announcement_id,resident_id,phone,message,status) VALUES(?,?,?,?, 'queued')");
            $validRecipients=[]; $invalidCount=0;
            foreach($recipientRows as $r) {
                $phone=phone_e164((string)$r['phone']);
                $log->execute([$announcementId,$r['id'],$r['phone'],$smsMessage]);
                $logId=(int)$pdo->lastInsertId();
                if ($phone === null) {
                    $pdo->prepare("UPDATE sms_logs SET status='failed',error_message='Invalid phone number; use a Philippine mobile number or international E.164 format.' WHERE id=?")->execute([$logId]);
                    $invalidCount++;
                } else $validRecipients[]=['id'=>$logId,'phone'=>$phone];
            }
            $pdo->commit();

            $providerResult=null;
            if ($validRecipients) {
                $providerResult=textbee_send($config,$smsMessage,array_column($validRecipients,'phone'));
                if (!empty($providerResult['accepted'])) {
                    $update=$pdo->prepare("UPDATE sms_logs SET provider_message_id=? WHERE id=?");
                    foreach($validRecipients as $recipient) $update->execute([$providerResult['batch_id'],$recipient['id']]);
                } elseif (!empty($providerResult['configured'])) {
                    $update=$pdo->prepare("UPDATE sms_logs SET status='failed',error_message=? WHERE id=?");
                    foreach($validRecipients as $recipient) $update->execute([substr((string)($providerResult['error']??'TextBee send failed.'),0,240),$recipient['id']]);
                }
            }
            reply(201,[
                'id'=>$announcementId,
                'queued'=>count($validRecipients),
                'accepted'=>!empty($providerResult['accepted']) ? (int)($providerResult['recipient_count']??count($validRecipients)) : 0,
                'invalid'=> $invalidCount,
                'provider'=>empty($providerResult['configured']) ? 'not_configured' : (!empty($providerResult['accepted']) ? 'textbee' : 'error'),
                'batch_id'=>$providerResult['batch_id']??null,
                'provider_error'=>$providerResult['error']??null,
            ]);
        }
    }
    reply(404,['error'=>'Unknown resource or unsupported method']);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($e->getCode()==='23000') reply(409,['error'=>'That email or resident code is already registered.']);
    reply(500,['error'=>'Database operation failed']);
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); reply(500,['error'=>'Request failed']); }
