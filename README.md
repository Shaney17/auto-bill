# Auto-Bill

Tự động phân loại giao dịch ngân hàng Techcombank từ ảnh chụp màn hình và ghi vào Google Sheets.

## Kiến trúc

```
iOS Shortcut (1 tap)
  → auto-bill-server (Node.js)
      → minimax-mcp (MCP SDK — Minimax Vision)
      → Google Sheets API v4
```

## Stack

- **iOS Shortcuts** — chụp màn hình + gửi ảnh base64
- **Node.js + Express** — server nhận request, orchestrate
- **@modelcontextprotocol/sdk** — kết nối MCP Minimax Vision
- **googleapis + google-auth-library** — xác thực service account + ghi Sheets

## Setup

### 1. Chuẩn bị

- Node.js 18+
- Google Account (quyền chỉnh sửa Spreadsheet)
- Minimax API Key
- iPhone với app Shortcuts

### 2. Google Service Account

1. [console.cloud.google.com](https://console.cloud.google.com) → **IAM & Admin** → **Service Accounts** → **+ Create Service Account**
2. Đặt tên: `auto-bill-writer`
3. Sau khi tạo → **Keys** → **Add Key** → **JSON** → download
4. Copy toàn bộ nội dung file JSON (sẽ paste vào `GOOGLE_SHEETS_CREDENTIALS`)

### 3. Cấp quyền Google Sheets

1. Mở `BaoCaoThuChi_2026.xlsx` trên Google Sheets
2. **Share** → thêm email service account:
   ```
   auto-bill-writer@[PROJECT].iam.gserviceaccount.com
   ```
3. Cấp quyền: **Editor**

### 4. Cài đặt server

```bash
cd auto-bill-server
cp .env.example .env
```

Điền vào `.env`:

| Variable | Giá trị |
|----------|---------|
| `MINIMAX_API_KEY` | Minimax API key của bạn |
| `GOOGLE_SHEETS_CREDENTIALS` | Toàn bộ JSON của service account file |
| `SHEET_ID` | ID từ URL Google Sheets |
| `SHEET_NAME` | `📋 Dữ liệu gốc` |

```bash
npm install
npm start
```

Server chạy trên `http://localhost:3000`.

### 5. Expose server ra internet

iOS Shortcut không gọi được `localhost`, cần expose:

**Cách 1 — ngrok (nhanh nhất):**
```bash
ngrok http 3000
# Copy URL: https://xxxx.ngrok.io
```

**Cách 2 — Cloudflare Tunnel:**
```bash
cloudflared tunnel --url http://localhost:3000
```

**Cách 3 — Deploy lên Railway/Render/VPS:**
Deploy `auto-bill-server` như một Node.js app bình thường.

### 6. iOS Shortcut

Mở app **Shortcuts** → **+** → Thêm lần lượt:

| # | Action (VI) | Tìm kiếm | Cài đặt |
|---|-------------|-----------|---------|
| 1 | **Chụp ảnh màn hình** | `screenshot` | *(không cần đặt gì)* |
| 2 | **Lưu ảnh** | `save photo` | Album: **Recents** |
| 3 | **Thay đổi kích thước ảnh** | `resize` | Input: `Ảnh vừa chụp` — Chiều rộng: **640** |
| 4 | **Mã hoá phương tiện** | `encode` | Input: `Ảnh đã thay đổi kích thước` — Format: **Base64** — Variable: `b64` |
| 5 | **Lấy văn bản Base64** | `base64` | Input: `b64` — Variable: `b64text` |
| 6 | **Văn bản** | `text` | Dán URL server (vd: `https://xxxx.ngrok.io`) — Variable: `serverUrl` |
| 7 | **Lấy nội dung URL** | `url` | URL: `serverUrl` — Method: **POST** — Headers: `Content-Type: application/json` — Body: `{"image":"${b64text}"}` |
| 8 | **Hiển thị thông báo** | `notification` | Title: `Auto-Bill` — Body: `Đã lưu giao dịch` |

> **Lưu ý:** Action **Thay đổi kích thước ảnh** giúp giảm ảnh từ ~1.6MB xuống ~50-80KB, tránh timeout trên mobile.

## Sử dụng

1. Mở app **Techcombank** → thực hiện chuyển khoản
2. Khi màn hình xác nhận hiện lên → chụp màn hình
3. Mở shortcut **Auto-Bill**
4. Chờ ~5 giây → notification thành công
5. Mở Google Sheets → kiểm tra sheet **📋 Dữ liệu gốc**

## Danh mục phân loại

**CHI:**
- Ăn uống
- Tiền điện/nước
- Đi lại/Xăng xe
- Mua sắm/Nạp ví
- Giải trí
- Gửi vợ iu
- Đầu tư/Chứng khoán
- Thẻ tín dụng
- Quỹ nhóm
- Quỹ nhóm/Quà tặng
- Chi khác

**THU:**
- Lương
- Thu nhập đầu tư
- Lãi suất ngân hàng
- Thưởng/Phúc lợi
- Bạn bè hoàn tiền
- Vợ chuyển lại
- Thu khác

**BỎ QUA:** giao dịch nội bộ (Sinh lời tự động, Upoint, chuyển nội bộ)

## Xử lý lỗi

| Lỗi | Nguyên nhân | Cách sửa |
|-----|------------|---------|
| `npx: command not found` | Chưa cài Node.js | Cài [nodejs.org](https://nodejs.org) |
| `MCP client error` | MCP server lỗi | Chạy `npx -y minimax-mcp` để test |
| `401 Unauthorized` | MINIMAX_API_KEY sai | Kiểm tra lại API key |
| `403 Forbidden` | Sheets chưa share cho service account | Thêm service account email vào Share |
| `404 Not Found` | SHEET_ID sai | Kiểm tra lại Spreadsheet ID |
| timeout trên mobile | Ảnh quá lớn | Thêm action **Thay đổi kích thước ảnh** (640px) |
| Connection refused | Server chưa chạy | `npm start` trong thư mục `auto-bill-server` |

## Phát triển

```bash
# Chạy server
cd auto-bill-server && npm start

# Test với ảnh mẫu
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"image":"'"$(base64 -i ../local-data/chuyen-khoan.PNG | tr -d '\n')"'"}'
```

## Files

```
auto-bill/
├── README.md
├── .gitignore
├── minimax-prompt.txt
├── local-data/                 # Ảnh mẫu & dữ liệu test (không push lên git)
│   ├── chuyen-khoan.PNG
│   └── BaoCaoThuChi_2026.xlsx
├── auto-bill-server/           # Server chính (Node.js)
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── auto-bill-worker/           # Fallback: Cloudflare Worker
    ├── index.ts
    └── wrangler.toml
```

## License

MIT