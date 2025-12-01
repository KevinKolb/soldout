<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!isset($data['xml'])) {
    http_response_code(400);
    echo json_encode(['error' => 'No XML data provided']);
    exit;
}

$xmlContent = $data['xml'];

// Validate XML
$doc = new DOMDocument();
$doc->preserveWhiteSpace = false;
$doc->formatOutput = true;

if (!@$doc->loadXML($xmlContent)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid XML']);
    exit;
}

// Format XML nicely
$formattedXml = $doc->saveXML();

// Save to file
$filePath = '../web/shows.xml';

if (file_put_contents($filePath, $formattedXml) !== false) {
    echo json_encode(['success' => true, 'message' => 'Shows saved successfully']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write file']);
}
?>
