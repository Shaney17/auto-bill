'use strict';
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');

const app = express();
app.use(express.json({ limit: '20mb' }));

const PROMPT =
  'Phân tích ảnh giao dịch ngân hàng Techcombank. Trả về JSON thuần túy (không markdown, không code block). ' +
  'Danh mục CHI: Ăn uống, Tiền điện nước, Đi lại xăng xe, Chi hàng ngày, Giải trí, Gửi vợ yêu, Thẻ tín dụng, Quỹ nhóm, Quỹ nhóm quà tặng, Chi khác. ' +
  'Lưu ý trong Danh mục CHI có 1 số bên nhận là siêu thị như T-mart, Wincommerce, Aeon thì ghi nhận là Chi hàng ngày. Các bên nhận là cửa hàng như GS25, Mixue, Cua hang am ap, Uno, Bingxue, Winggo thì ghi nhận vào Ăn uống' +
  'Danh mục THU: Lương, Thu nhập đầu tư, Lãi suất ngân hàng, Thưởng phúc lợi, Bạn bè hoàn tiền, Vợ chuyển lại, Thu khác. ' +
  'BỎ QUA: giao dịch nội bộ (Sinh lời tự động, Upoint, chuyển tiền nội bộ, trừ những giao dịch có nội dung là lương, thưởng). ' +
  'Danh mục TIET_KIEM: Đầu tư chứng khoán, gửi tiết kiệm, mua vàng' +
  'Định dạng ngày: 1 thg 5, 2026 hoặc dd/MM/yyyy -> chuẩn hóa về dd/MM/yyyy. ' +
  'Trả về JSON: {"ma_gd":"mã giao dịch nếu có, nếu không có thì null","ngay":"dd/MM/yyyy","doi_tac":"","ngan_hang":"","noi_dung":"","chi":so|null,"thu":so|null,"loai":"CHI|THU|BỎ QUA","phan_loai":"danh muc"}';

let mcpClient = null;

async function getMcpClient() {
  if (mcpClient) return mcpClient;

  const transport = new StdioClientTransport({
    command: 'minimax-coding-plan-mcp',
    args: [],
    env: { ...process.env, MINIMAX_API_HOST: 'https://api.minimax.io' }
  });

  mcpClient = new Client({ name: 'auto-bill', version: '1.0.0' }, {});
  await mcpClient.connect(transport);
  console.log('MCP client connected');

  mcpClient.onclose = () => { mcpClient = null; };

  return mcpClient;
}

async function analyzeImage(base64Image) {
  const tmpPath = path.join(os.tmpdir(), `auto-bill-${Date.now()}.jpg`);
  fs.writeFileSync(tmpPath, Buffer.from(base64Image, 'base64'));

  try {
    const client = await getMcpClient();
    const result = await client.callTool(
      {
        name: 'understand_image',
        arguments: { image_source: tmpPath, prompt: PROMPT }
      },
      undefined,
      { timeout: 120000 }
    );

    const text = result.content?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{"[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in MCP response: ' + text.slice(0, 200));
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('JSON parse failed: ' + e.message + ' | raw: ' + jsonMatch[0].slice(0, 100));
    }
  } finally {
    fs.unlinkSync(tmpPath);
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
    txData.phan_loai || 'Chi khác',
    txData.ma_gd || ''
  ];

  const headerRange = `${process.env.SHEET_NAME}!A1:J1`;
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: headerRange });
  if (!existing.data.values) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: { values: [['Tháng', 'Ngày', 'Đối tác', 'Ngân hàng', 'Nội dung', 'Chi', 'Thu', 'Loại', 'Phân loại', 'Mã GD']] }
    });
  }

  if (txData.ma_gd) {
    const maGdCol = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: `${process.env.SHEET_NAME}!J:J` });
    const existingIds = (maGdCol.data.values || []).flat();
    if (existingIds.includes(String(txData.ma_gd))) {
      return null;
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: `${process.env.SHEET_NAME}!A2`,
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
    if (sheetUrl === null) {
      return res.json({ status: 'duplicate', parsed });
    }
    res.json({ status: 'ok', parsed, sheetUrl });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auto-Bill server on port ${PORT}`));
