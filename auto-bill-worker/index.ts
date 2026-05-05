/**
 * Auto-Bill Cloudflare Worker
 * Receives image from iOS Shortcut → Gemini Vision → Google Sheets
 *
 * Setup:
 * 1. Create Worker in Cloudflare Dashboard
 * 2. Add Gemini API Key as secret: GEMINI_API_KEY
 * 3. Add Google Sheets credentials as secret: GOOGLE_SHEETS_CREDENTIALS
 * 4. Set SHEET_ID and SHEET_NAME as env vars
 * 5. Deploy and use Worker URL as webhook in iOS Shortcut
 */

interface Env {
  GEMINI_API_KEY: string;
  GOOGLE_SHEETS_CREDENTIALS: string;
  SHEET_ID: string;
  SHEET_NAME: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}
const MINIMAX_PROMPT = "Phan tich anh giao dich ngan hang Techcombank. Tra ve JSON thuan tuy (khong markdown, khong code blocks). " +
  "Danh muc CHI: An uong, Tien dien nuoc, Di lai xang xe, Mua sam nap vi, Giai tri, Gui vo iu, Dau tu chung khoan, The tin dung, Quy nhom, Quy nhom Qua tang, Chi khac. " +
  "Danh muc THU: Luong, Thu nhap dau tu, Lai suat ngan hang, Thuong phuc loi, Ban be hoan tien, Vo chuyen lai, Thu khac. " +
  "BO QUA: giao dich noi bo (Sinh loi tu dong, Upoint, chuyen tien noi bo). " +
  "Dinh dang ngay: 1 thg 5, 2026 hoac dd/MM/yyyy -> chuan hoa ve dd/MM/yyyy. " +
  'Tra ve JSON: {"ngay":"dd/MM/yyyy","doi_tac":"","ngan_hang":"","noi_dung":"","chi":so|null,"thu":so|null,"loai":"CHI|THU|BỎ QUA","phan_loai":"danh muc"}';

// ============================================================
// Handle incoming request from iOS Shortcut
// POST Body: { "image": "base64...", "filename": "optional.jpg" }
// ============================================================
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  try {
    let base64Image: string;
    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('image') as File;
      if (!file) return jsonResponse({ error: 'Missing image field' }, 400, corsHeaders);
      base64Image = arrayBufferToBase64(await file.arrayBuffer());
    } else if (contentType.includes('application/json')) {
      const body = await request.json() as { image?: string };
      if (!body.image) return jsonResponse({ error: 'Missing image data' }, 400, corsHeaders);
      base64Image = body.image;
    } else {
      // Raw binary — iOS Shortcut gửi file trực tiếp
      const buffer = await request.arrayBuffer();
      if (!buffer.byteLength) return jsonResponse({ error: 'Empty body' }, 400, corsHeaders);
      base64Image = arrayBufferToBase64(buffer);
    }

    // Step 1: Call Minimax Vision API
    let parsed: any;
    try {
      parsed = await callGeminiVision(base64Image, env);
    } catch (mErr) {
      console.error('Gemini:', mErr.message);
      return jsonResponse({ error: mErr.message }, 500, corsHeaders);
    }

    if (parsed.loai === 'BỎ QUA' || parsed.error) {
      return jsonResponse({ status: 'skip', parsed }, 200, corsHeaders);
    }

    console.log('loai:', parsed.loai, 'ngay:', parsed.ngay);
    try {
      const sheetUrl = await appendToGoogleSheets(parsed, env);
      console.log('Sheets OK');
      return jsonResponse({ status: 'ok', parsed, sheetUrl }, 200, corsHeaders);
    } catch (sheetErr) {
      console.error('Sheets:', sheetErr.message);
      return jsonResponse({ status: 'sheet_error', error: sheetErr.message, parsed }, 200, corsHeaders);
    }

  } catch (err) {
    return jsonResponse({ error: err.message }, 500, corsHeaders);
  }
}

// ============================================================
// Step 1: Gemini Vision — gemini-2.0-flash
// ============================================================
async function callGeminiVision(base64Image: string, env: Env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: MINIMAX_PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
        ]
      }],
      generationConfig: { maxOutputTokens: 500, temperature: 0 }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${err}`);
  }

  const result = await response.json() as any;
  const content: string = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!content) throw new Error('Empty response from Gemini');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Gemini response: ' + content);

  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// Step 2: Append row to Google Sheets via Sheets API v4
// ============================================================
async function appendToGoogleSheets(txData: any, env: Env) {
  const credentials = env.GOOGLE_SHEETS_CREDENTIALS;
  if (!credentials) throw new Error('GOOGLE_SHEETS_CREDENTIALS not configured');
  console.log('Sheets: getting token');

  const { access_token } = await getAccessToken(credentials);
  console.log('Sheets: token OK, appending');

  const thang = formatThang(txData.ngay);
  const row = [
    thang,
    txData.ngay || '',
    txData.doi_tac || '',
    txData.ngan_hang || '',
    txData.noi_dung || '',
    txData.chi || '',
    txData.thu || '',
    txData.loai || 'CHI',
    txData.phan_loai || 'Chi khac'
  ];

  const range = `${env.SHEET_NAME}!A:I`;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [row] })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Sheets API error: ${response.status} - ${err}`);
  }

  return `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/edit`;
}

// ============================================================
// Google OAuth2: get access token from service account key
// ============================================================
async function getAccessToken(credentialsJson) {
  const credentials = typeof credentialsJson === 'string'
    ? JSON.parse(credentialsJson)
    : credentialsJson;

  const jwt = await createJWT(credentials);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OAuth error: ${response.status} - ${err}`);
  }

  return response.json();
}

async function createJWT(credentials) {
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import RSA private key and sign
  const privateKeyBytes = base64ToBytes(credentials.private_key);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '');
  return `${signingInput}.${signatureB64}`;
}

function base64ToBytes(pemKey: string): Uint8Array {
  const base64 = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\n/g, '')
    .trim();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================
// Helpers
// ============================================================
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function formatThang(ngayStr) {
  if (!ngayStr) {
    const now = new Date();
    return `T${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  }

  if (ngayStr.includes('thg')) {
    const parts = ngayStr.match(/(\d+)\s*thg\s*(\d+),\s*(\d+)/);
    if (parts) {
      return `T${('0' + parts[2]).slice(-2)}/${parts[3]}`;
    }
  }

  if (ngayStr.includes('/')) {
    const p = ngayStr.split('/');
    if (p.length === 3) {
      return `T${p[1]}/${p[2]}`;
    }
  }

  const now = new Date();
  return `T${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => handleRequest(request, env, ctx)
};