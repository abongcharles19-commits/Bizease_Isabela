<?php
// Copy this file to config.local.php and set credentials outside source control.
return [
    'db_host' => '127.0.0.1',
    'db_name' => 'barangay_bungahin',
    'db_user' => 'root',
    'db_pass' => '',
    'textbee_api_key' => getenv('TEXTBEE_API_KEY') ?: '',
    'textbee_base_url' => 'https://api.textbee.dev/api/v1',
    'textbee_device_id' => getenv('TEXTBEE_DEVICE_ID') ?: '',
];
