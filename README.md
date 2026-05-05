# Auto-Bill

Tự động phân loại giao dịch ngân hàng Techcombank từ ảnh chụp màn hình vào Google Sheets.

## Kiến trúc

```
iOS Shortcut (1 tap)
  → auto-bill-server (Node.js + MCP)
      → Minimax Vision API (phân tích ảnh)
      → Google Sheets (lưu thông tin giao dịch)
```

**Stack:**
- **iOS Shortcuts** — chụp màn hình + gửi ảnh
- **Node.js + Express** — server nhận request
- **MCP SDK** — kết nối Minimax Vision qua `minimax-mcp`
- **Google Sheets API v4** — ghi dữ liệu giao dịch
- **Google Auth Library** — xác thực service account

## Setup

### 1. Chuẩn bị

- Node.js 18+
- Google Account (với quyền chỉnh sửa Spreadsheet)
- Minimax API Key
- iPhone với app Shortcuts

### 2. Google Service Account

1. Đi đến [console.cloud.google.com](https://console.cloud.google.com)
2. Tạo project hoặc chọn project hiện tại
3. **IAM & Admin** → **Service Accounts** → **+ Create Service Account**
4. Đặt tên: `auto-bill-writer`
5. Sau khi tạo → vào **Keys** → **Add Key** → **JSON** → download file
6. Mở file JSON, copy toàn bộ nội dung

### 3. Cấp quyền Google Sheets

1. Mở file `BaoCaoThuChi_2026.xlsx` trên Google Sheets
2. Nhấn **Share** → thêm email service account:
   ```
   auto-bill-writer@[PROJECT].iam.gserviceaccount.com
   ```
3. Cấp quyền: **Editor**

### 4. Lấy Spreadsheet ID

Copy ID từ URL Google Sheets:
```
https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
```

### 5. Cài đặt server

```bash
cd auto-bill-server
cp .env.example .env
# Điền các giá trị vào .env:
#   MINIMAX_API_KEY
#   GOOGLE_SHEETS_CREDENTIALS (paste toàn bộ JSON đã download)
#   SHEET_ID
#   SHEET_NAME

npm install
npm start
```

Server sẽ chạy trên `http://localhost:3000`.

### 6. Expose server ra internet (cho iOS Shortcut gọi được)

**Cách đơn giản nhất — ngrok:**
```bash
ngrok http 3000
# Copy URL dạng https://xxxx.ngrok.io
```

**Cách khác:** deploy lên Railway, Render, hoặc VPS.

### 7. iOS Shortcut

Mở app **Shortcuts** → **+** → Thêm lần lượt:

| # | Action (VI) | Tìm kiếm |
|---|-------------|-----------|
| 1 | **Chụp ảnh màn hình** | `screenshot` |
| 2 | **Lưu ảnh** | `save photo` |
| 3 | **Mã hoá phương tiện** | `encode` — Format: **Base64** |
| 4 | **Lấy văn bản Base64** | `base64` |
| 5 | **Văn bản** | `text` — paste URL server (vd: `https://xxxx.ngrok.io`) |
| 6 | **Lấy nội dung URL** | `url` — Method: **POST** — Body: `{"image":"${b64text}"}` |
| 7 | **Hiển thị thông báo** | `notification` — Title: `Auto-Bill` |

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

**BỎ QUA:** giao dịch nội bộ (Sinh lời, Upoint, chuyển nội bộ)

## Xử lý lỗi

| Lỗi | Nguyên nhân | Cách sửa |
|-----|------------|---------|
| `npx: command not found` | Chưa cài Node.js | Cài Node.js 18+ |
| `MCP client error` | MCP server lỗi | Chạy `npx -y minimax-mcp` test riêng |
| `401 Unauthorized` | MINIMAX_API_KEY sai | Kiểm tra lại API key |
| `403 Forbidden` | Sheets chưa share cho service account | Thêm email service account vào Share |
| `404 Not Found` | SHEET_ID sai | Kiểm tra lại Spreadsheet ID |
| timeout | Ảnh quá lớn | Thêm action **Resize Image** (width: 640) trước khi encode |

## Phát triển

```bash
cd auto-bill-server
npm run start    # chạy server
```

Test endpoint:
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"image":"'"$(base64 -i ../local-data/chuyen-khoan.PNG | tr -d '\n')"'"}'
```

## License

MIT