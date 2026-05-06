'use strict';
require('dotenv').config();
const express = require('express');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');

const app = express();
app.use(express.json({ limit: '20mb' }));

const PROMPT =
  'Phan tich anh giao dich ngan hang Techcombank. Tra ve JSON thuan tuy (khong markdown, khong code blocks). ' +
  'Danh muc CHI: An uong, Tien dien nuoc, Di lai xang xe, Mua sam nap vi, Giai tri, Gui vo iu, Dau tu chung khoan, The tin dung, Quy nhom, Quy nhom Qua tang, Chi khac. ' +
  'Danh muc THU: Luong, Thu nhap dau tu, Lai suat ngan hang, Thuong phuc loi, Ban be hoan tien, Vo chuyen lai, Thu khac. ' +
  'BO QUA: giao dich noi bo (Sinh loi tu dong, Upoint, chuyen tien noi bo). ' +
  'Dinh dang ngay: 1 thg 5, 2026 hoac dd/MM/yyyy -> chuan hoa ve dd/MM/yyyy. ' +
  'Tra ve JSON: {"ngay":"dd/MM/yyyy","doi_tac":"","ngan_hang":"","noi_dung":"","chi":so|null,"thu":so|null,"loai":"CHI|THU|BO QUA","phan_loai":"danh muc"}';

async function analyzeImage(base64Image) {
  const imageUrl = `data:image/jpeg;base64,${base64Image}`;

  const res = await fetch(`${process.env.MINIMAX_API_HOST}/v1/coding_plan/vlm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`
    },
    body: JSON.stringify({ prompt: PROMPT, image_url: imageUrl }),
    signal: AbortSignal.timeout(120000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Minimax API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content ?? '';
  const jsonMatch = text.match(/\{"[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Minimax response: ' + text.slice(0, 200));
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('JSON parse failed: ' + e.message + ' | raw: ' + jsonMatch[0].slice(0, 100));
  }
}

async function appendToSheets(txData) {
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
  } catch (e) {
    throw new Error('GOOGLE_SHEETS_CREDENTIALS invalid JSON: ' + e.message);
  }
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
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

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  return `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit`;
}

function formatThang(ngayStr) {
  if (!ngayStr) {
    const now = new Date();
    return `T${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  }
  if (ngayStr.includes('thg')) {
    const parts = ngayStr.match(/(\d+)\s*thg\s*(\d+),\s*(\d+)/);
    if (parts) return `T${('0' + parts[2]).slice(-2)}/${parts[3]}`;
  }
  if (ngayStr.includes('/')) {
    const p = ngayStr.split('/');
    if (p.length === 3) return `T${p[1]}/${p[2]}`;
  }
  const now = new Date();
  return `T${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

app.get('/', (req, res) => res.json({ status: 'ok', message: 'Auto-Bill running' }));

app.post('/', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Missing image' });

    const parsed = await analyzeImage(image);
    console.log('Parsed:', parsed.loai, parsed.ngay, parsed.noi_dung);

    if (parsed.loai === 'BỎ QUA' || parsed.loai === 'BO QUA' || parsed.error) {
      return res.json({ status: 'skip', parsed });
    }

    const sheetUrl = await appendToSheets(parsed);
    res.json({ status: 'ok', parsed, sheetUrl });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auto-Bill server on port ${PORT}`));
