# 🪷 Chùa Linh Ứng Online — TikTok Live RPC (9:16 Interactive Buddhist Sanctuary)

> **Bản làm việc đã gia cố bảo mật (01/11/2026).** Chạy local bằng Node 22+;
> đăng nhập quản trị bằng mã hiển thị trong terminal. WebSocket chỉ nhận sự kiện;
> kết nối TikTok bằng username và bấm thủ công. TTS mặc định tắt, không tự tải model.
> Xem [phạm vi sửa, kiểm thử và giới hạn](docs/security/SECURITY-REVIEW.md).


Hệ thống phát trực tiếp tương tác (**Interactive TikTok Live Stream & JSON-RPC 2.0**) chuẩn khung dọc **9:16 (`1080×1920`)** dành cho **OBS Studio / TikTok Live Studio**, chạy siêu nhẹ trên **Node.js** và tích hợp giọng đọc AI tiếng Việt **ZeroTTS (`zeroweight-ai/ZeroTTS`)**.

Người xem trên TikTok Live tương tác trực tiếp qua **Bình luận (Comment)**, **Thả tim (Like)**, **Chia sẻ / Follow** và **Tặng quà (Gift)** để thực hiện các nghi thức tâm linh trên màn hình Chánh Điện **Đức Phật A Di Đà**:
- 🔥 **Thắp hương & Đảnh lễ Tam Bái (8-Frame Walking & Prostration)**: Nhân vật Phật tử mặc áo lam bước đi từng bước dọc thảm đỏ hoa sen lên trước Lư Hương Đỉnh Đồng, hạ gối quỳ và thực hiện 3 lạy Ngũ thể đầu địa hướng về Đức Phật A Di Đà.
- 🏮 **Thả Đèn Hoa Đăng / Sớ Cầu Nguyện**: Bình luận lời khấn sẽ bay lên thành Đèn Hoa Đăng kèm giọng đọc AI đọc lời cầu nguyện.
- 🎋 **Xin Xăm / Gieo Quẻ Đầu Năm (Đồng bộ Giọng đọc & Tờ Giải Quẻ)**: Tự động lắc ống xăm và mở tờ Giải Quẻ (Thượng Thượng Cát, Đại Cát, Thượng Cát...) đúng thời điểm giọng đọc bắt đầu vang lên.
- 🪵 **Gõ Mõ & 🔔 Thỉnh Đại Hồng Chung**: Thả tim gõ mõ tích điểm Công Đức, chia sẻ/follow thỉnh chuông đồng lan tỏa sóng âm vàng và kích hoạt làn sóng vái lạy của 40+ Phật tử trong Đạo Tràng.
- 📜 **Bảng Vàng Công Đức (`TẤM LÒNG THÀNH` & 6 Đệm Quỳ VIP)**: Vinh danh trực tiếp người xem thật có điểm Công Đức cao nhất trên 6 đệm quỳ gấm đỏ trước bàn thờ Phật.

---

## 📸 Hình Ảnh Demo Giao Diện

### 1. Màn hình Chánh Điện 9:16 & Bảng Điều Khiển Nhanh (`http://127.0.0.1:3000`)
![Màn hình Chánh Điện và Điều Khiển Nhanh](docs/demo/demo-main-stage.png)

### 2. Chế độ OBS Browser Source 9:16 Sạch (`http://127.0.0.1:3000/?obs=1`) & Gieo Quẻ Linh Xăm
| Màn hình OBS 9:16 (`?obs=1`) | Tờ Giải Quẻ Linh Xăm (Đồng bộ Giọng Đọc) |
| :---: | :---: |
| ![OBS 9:16 Mode](docs/demo/demo-obs-9x16.png) | ![Fortune Oracle Modal](docs/demo/demo-fortune-oracle.png) |

### 3. Bảng Điều Khiển JSON-RPC 2.0 & Admin (`http://127.0.0.1:3000/admin`)
![Admin JSON-RPC Panel](docs/demo/demo-admin-panel.png)

---

## ⚡ Kiến Trúc & Tối Ưu Hóa Hiệu Suất (Siêu Nhẹ CPU/GPU)

- **Runtime**: Chạy trực tiếp trên **Node.js** (`~0.1% CPU` khi chờ).
- **Canvas Particle Engine (`public/js/particles.js`)**:
  - Khóa tốc độ vẽ ở **30 FPS** ổn định, tự động tạm dừng khi ẩn tab (`document.hidden`).
  - Pre-render toàn bộ Khói hương, Hạt vàng và Cánh hoa sen ra Offscreen Canvas 1 lần duy nhất lúc khởi tạo (`drawImage`), không gọi `createRadialGradient` hay `shadowBlur` trong vòng lặp frame.
- **Zero-Flicker 8-Frame Sprite Stack (`public/js/live.js` & `public/css/live.css`)**:
  - Nạp sẵn cả 8 khung hình chuyển động (`walk1`, `walk2`, `kneelDown`, `kneel`, `forehead`, `bowMid`, `prostrate`, `prostrateDeep`) vào GPU với bóng đổ (drop-shadow) đã bake sẵn trong PNG, loại bỏ hoàn toàn hiện tượng nháy/mất hình khi chuyển tư thế.
- **ZeroTTS Worker (`tts_worker.py`)**:
  - Tiến trình Python thường trú nạp sẵn model `zeroweight-ai/ZeroTTS` (`intra_op_num_threads=3`, `OMP_WAIT_POLICY=PASSIVE` → **`0.0% CPU` khi chờ**).
  - Tổng hợp nguyên câu trong 1 lần gọi (`single-pass synthesis`), khử DC offset, chuẩn hóa đỉnh âm lượng (`peak <= 0.90`) và làm mượt 2 đầu sóng âm (`cosine fade-in/out`) chống xước/rè tiếng.
- **Bộ Lọc Chặn Ký Tự Lạ & Spam (`server.js` & `tts_worker.py`)**:
  - Chặn tự động các ký tự Cuneiform (`𒐫`), chữ Ả Rập gây lag, Braille, Zalgo, bình luận chỉ toàn dấu chấm (`...`) hoặc từ ngữ phản cảm.
  - Tự động chuẩn hóa Unicode (`NFKC` → `NFC`) chuyển tên kiểu chữ toán học về tiếng Việt sạch trước khi đọc TTS.

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Nhanh

### 1. Chạy giao diện và bảng điều khiển

Cần **Node.js 22+** và npm. Không cần cài Python/TTS để thử hình ảnh.

```bash
npm ci --ignore-scripts
npm start
# Tự reload khi sửa mã:
npm run dev
```

- Live: [http://127.0.0.1:3000/](http://127.0.0.1:3000/)
- OBS Browser Source: [http://127.0.0.1:3000/?obs=1](http://127.0.0.1:3000/?obs=1), kích thước `1080 × 1920`.
- Admin: [http://127.0.0.1:3000/admin](http://127.0.0.1:3000/admin).

Dùng nút **Đăng nhập quản trị** và nhập mã từ terminal. Mã mới được tạo mỗi lần
khởi động; phiên đăng nhập hết hạn sau 8 giờ hoặc khi khởi động lại server.
Token không được đưa vào link OBS. Chọn username TikTok đang LIVE rồi bấm kết nối;
app không tự mở LIVE, không tự kết nối kênh mẫu và không nhận URL/short-link.
Chỉ dùng một host nhất quán (`127.0.0.1` hoặc `localhost`) cho trang đang điều khiển.

Mặc định cổng `3000`, có thể đặt `PORT`. `APP_DATA_DIR` tùy chọn đổi thư mục lưu state/cache.
Nếu đặt `ADMIN_TOKEN` qua môi trường thì phải dùng chuỗi ngẫu nhiên 32–128 ký tự chữ,
số, gạch dưới hoặc gạch ngang. App không tự đọc file `.env`.

### 2. TTS tùy chọn — mặc định tắt

Lockfile hiện nhắm **CPython 3.11 trên macOS ARM64**. Model đã được cài và thử tạo WAV thật trên máy M1 Pro; xem [kết quả TTS](docs/security/ZEROTTS-SETUP.md).
Cần uv và Python phù hợp để chuẩn bị môi trường riêng. Không dùng lệnh cài dependency không ghim phiên bản.

```bash
uv venv --python 3.11.18 .venv
uv pip sync --python .venv/bin/python --require-hashes --only-binary :all: --index-url https://pypi.org/simple requirements.lock

# Chuẩn bị model lần đầu: tải khoảng 1,05 GB và xác minh hash từng file.
.venv/bin/python scripts/setup-zerotts.py
# Chạy app với TTS; worker chỉ đọc model đã có trong cache.
npm run start:tts
```

TTS có ngân sách riêng: 20 câu/phút cho tương tác thường, 5 câu/phút cho mỗi tầng quà
(tổng tối đa 40 câu/phút); mỗi hàng tối đa 4 tác vụ gồm tác vụ đang chạy cùng tầng.
Đầu vào tối đa 320 ký tự (worker chuẩn hóa và rút gọn trước khi tổng hợp).
Nếu nạp quá 120 giây hoặc tổng hợp một câu quá 30 giây, worker bị dừng và cần khởi động lại app.
Tác vụ chờ quá hạn chỉ bị loại riêng, không dừng worker đang xử lý quà.
Giao diện vẫn nhận sự kiện khi TTS tắt hoặc gặp lỗi.

### Hàng đợi và ưu tiên quà

Mỗi tầng có hàng riêng cho trình diễn và tạo giọng, theo giá trị `coins` của sự kiện:

| Ưu tiên từ cao xuống thấp | Giá trị |
| --- | --- |
| Kim Long | Từ 100 xu |
| Mâm ngũ quả | 20–99 xu |
| Đèn lưu ly | 5–19 xu |
| Hoa sen | 1–4 xu |
| Tương tác thường | Bình luận, tim, follow/share và đọc thử thủ công |

Cùng tầng xử lý FIFO. Quà tầng cao ngắt hiệu ứng/giọng đang phát của tầng thấp;
quà bị ngắt được đưa về đầu hàng của nó và trình diễn/đọc lại từ đầu, bình luận bị ngắt được bỏ.
Tương tác thường không ghi đè người tặng quà. Ưu tiên nghiêm ngặt: tương tác tầng thấp
có thể chờ hoặc hết hạn nếu tầng cao đến liên tục.

Hiệu ứng nhận ngay qua `temple.event`, không chờ TTS; audio được ghép sau qua `tts.ready`
theo ID sự kiện. Model chỉ tổng hợp một câu tại một thời điểm: câu đang tổng hợp được
hoàn thành, sau đó chọn tầng cao nhất đang chờ; không tải lại model để ngắt câu.

Mỗi overlay giữ tối đa 10 tương tác thường chờ và 20 quà mỗi tầng (gồm quà đang trình diễn).
Tương tác thường chờ quá 15 giây, quà chờ quá 120 giây sẽ bị loại. Hàng đầy từ chối
sự kiện trình diễn mới trong chính tầng đó và ghi cảnh báo console; điểm/bảng sự kiện
đã ghi ở server vẫn được giữ. Một lượt hiện tối thiểu 8 giây, tối đa 45 giây nếu đang
chờ/phát giọng. TTS chờ tối đa 30 giây cho tương tác thường, 120 giây cho quà.
Quá tải/hết lượt TTS vẫn có hiệu ứng, có thể không có giọng đọc. Hàng trình diễn nằm
trong bộ nhớ mỗi overlay, chưa khôi phục sau reload hoặc mất kết nối.


---

## 🎮 Bảng Quy Tắc Tương Tác TikTok Live

| Sự kiện TikTok Live | Điều kiện / Từ khóa | Nghi thức trên Chánh Điện | Điểm Công Đức |
| :--- | :--- | :--- | :---: |
| **Thả tim (Like)** | Mỗi đợt thả tim | Gõ mõ gỗ tụng kinh + Làn sóng Phật tử vái lạy | `+1` / tim |
| **Follow / Share** | Theo dõi hoặc chia sẻ | Thỉnh Đại Hồng Chung ngân vang + Sóng âm vàng | `+10` |
| **Bình luận Thắp hương** | `thắp hương`, `dâng hương`, `bái phật`, `lạy phật` | Phật tử bước dọc thảm đỏ lên trước Lư Hương, quỳ đảnh lễ 3 lạy + Đọc tên khấn | `+15` |
| **Bình luận Cầu nguyện** | `cầu ...`, `nguyện ...`, `nam mô`, `a di đà phật`, `bình an`, `chúc ...` | Bước lên đảnh lễ + Thả Đèn Hoa Đăng mang lời khấn bay lên trời + Đọc lời cầu nguyện | `+10` |
| **Bình luận Xin xăm** | `xin xăm`, `gieo quẻ`, `rút quẻ`, `quẻ` | Lắc ống xăm + Mở tờ Giải Quẻ đồng bộ đúng lúc giọng đọc bắt đầu vang lên | `+10` |
| **Tặng quà Nhỏ (1–4 xu)** | Hoa hồng (Rose), Heart Me... | Bước lên dâng Đài Hoa Sen Vàng + Thắp 3 nén hương + Đọc lời cảm tạ | `+20` / xu |
| **Tặng quà Vừa (5–99 xu)** | Đèn lưu ly, Mâm ngũ quả... | Dâng Đèn Lưu Ly / Mâm Ngũ Quả + Thỉnh Chuông + Đọc lời chúc phúc | `+30` / xu |
| **Tặng quà Lớn (≥ 100 xu)** | Quà ≥ 100 xu | **Đại Lễ Kim Long Chầu Phật**: Mưa hoa sen vàng, Hào quang vạn trượng, Chuông đồng ngân vang | `+50` / xu |

---

## 🔌 JSON-RPC điều khiển (`POST /rpc`) và WebSocket chỉ đọc (`/ws`)

Lệnh điều khiển dùng HTTP kèm Bearer token từ terminal, hoặc cookie phiên từ giao diện.
WebSocket chỉ phát trạng thái/sự kiện, yêu cầu Origin cùng host/port và từ chối mọi lệnh gửi lên.
Không mở cổng/tunnel để nhận webhook bên ngoài.
Các ví dụ dưới đây dùng token mẫu; thay bằng mã từ terminal:

```bash
# 1. Thắp hương cầu an
curl -X POST http://127.0.0.1:3000/rpc \
  -H "Content-Type: application/json" \
  -H 'Authorization: Bearer THAY_BANG_MA_QUAN_TRI' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "temple.burnIncense",
    "params": {
      "user": "Thí Chủ Minh Tâm",
      "count": 3,
      "wish": "Cầu gia đình bình an, vạn sự cát tường như ý"
    }
  }'

# 2. Xin xăm / Gieo quẻ đầu năm
curl -X POST http://127.0.0.1:3000/rpc \
  -H "Content-Type: application/json" \
  -H 'Authorization: Bearer THAY_BANG_MA_QUAN_TRI' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "temple.drawFortune",
    "params": {
      "user": "Thí Chủ Minh Tâm",
      "topic": "Cầu tài lộc và gia đạo bình an"
    }
  }'

# 3. Kết nối tới phòng TikTok Live (chỉ @username)
curl -X POST http://127.0.0.1:3000/rpc \
  -H "Content-Type: application/json" \
  -H 'Authorization: Bearer THAY_BANG_MA_QUAN_TRI' \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "live.connect",
    "params": {
      "username": "@zenfacts_vn"
    }
  }'
```

### Danh sách JSON-RPC Methods hỗ trợ:
- `temple.getState`: Lấy toàn bộ trạng thái Chánh Điện và Bảng Vàng Công Đức.
- `temple.burnIncense`: Thắp nhang & bước lên đảnh lễ (`user`, `avatar`, `count`, `wish`).
- `temple.sendPrayer`: Thả đèn hoa đăng cầu nguyện (`user`, `avatar`, `wish`).
- `temple.drawFortune`: Lắc ống xăm & gieo quẻ (`user`, `avatar`, `topic`).
- `temple.strikeWoodenFish`: Gõ mõ tích công đức (`user`, `count`).
- `temple.ringBell`: Thỉnh Đại Hồng Chung (`user`, `count`, `wish`).
- `temple.offerGift`: Dâng lễ vật (`user`, `giftType`: `lotus` | `fruit` | `lamp` | `dragon`, `coins`, `giftName`).
- `temple.grandCeremony`: Kích hoạt Đại Lễ Kim Long Chầu Phật (`user`, `coins`, `giftName`).
- `temple.updateSettings`: Cập nhật âm lượng nhạc nền (`musicVolume`), giọng đọc (`ttsVolume`), bật/tắt TTS.
- `temple.resetMerit`: Đặt lại bảng thống kê Công Đức.
- `live.connect` / `live.disconnect`: Kết nối / Ngắt kết nối phòng TikTok Live.

---

## 📁 Cấu Trúc Thư Mục

```text
├── server.js                  # Node.js HTTP RPC + WebSocket chỉ đọc & TikTok Live Connector
├── tts_worker.py              # Tiến trình Python ZeroTTS thường trú (48kHz, chống rè/clipping, lọc ký tự lạ)
├── data/
│   ├── merit-state.json       # Lưu trữ bền vững Bảng Vàng Công Đức của người xem thật
│   └── tts-cache/             # Bộ đệm file âm thanh WAV đã tổng hợp
├── public/
│   ├── index.html             # Giao diện Chánh Điện 9:16 + Bảng điều khiển nhanh
│   ├── admin.html             # Trang quản trị JSON-RPC 2.0 đầy đủ
│   ├── css/live.css           # Stylesheet tối ưu GPU Compositor
│   ├── js/
│   │   ├── live.js            # Điều phối 8-frame prostration, Đạo Tràng 40 chỗ ngồi & WebSocket RPC
│   │   ├── particles.js       # 30 FPS Offscreen-Sprite Particle Engine (Khói hương, Hoa sen, Sóng âm)
│   │   └── audio.js           # Quản lý nhạc nền auto-ducking, Pháp khí Web Audio & hàng đợi đồng bộ TTS
│   └── assets/                # Hình nền Đức Phật A Di Đà, 8 frame Phật tử áo lam & nhạc nền
└── docs/
    ├── demo/                  # Hình ảnh chụp màn hình demo thực tế
    └── superpowers/specs/     # Tài liệu thiết kế kỹ thuật (Design Spec)
```
