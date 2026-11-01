# Gia cố bản làm việc Zane — 01/11/2026

Bổ sung sau lần gia cố đầu: xem [rà dependency, cài Python và test cách ly](DEPENDENCY-REVIEW.md).

Mốc gốc: local commit `6b18988`, khớp 29 file của upstream
`zane-tv/tiktok-live-temple-rpc@2f8b9822f1507d66c16a1fb42053906304a16d11`.

## Thay đổi

| Phát hiện audit | Cách xử lý trong bản này |
| --- | --- |
| Z1: HTTP/WS không xác thực, CORS mở, listen mọi interface | Bind cố định `127.0.0.1`; kiểm tra Host chính xác, Origin cùng host/port và Fetch Metadata; bỏ CORS; HTTP điều khiển/TTS yêu cầu Bearer token hoặc phiên đăng nhập. |
| Z1: overlay có quyền điều khiển | `/ws` luôn chỉ đọc, kể cả khi trình duyệt đã có cookie quản trị; yêu cầu gửi lệnh qua WS bị đóng với mã 1008. Overlay nhận sự kiện và URL WAV do server tạo, không giữ token và không gọi API tổng hợp giọng. |
| Z2: SSRF từ URL kết nối | Chỉ nhận username 1–24 ký tự; loại bỏ hoàn toàn `fetch`/redirect để phân giải URL. |
| Z3: prototype pollution | Bảng người xem không có prototype; dùng own-property; RPC chặn khóa nguy hiểm; sự kiện TikTok đổi khóa nguy hiểm sang khóa có tiền tố; lọc lại dữ liệu cũ khi đọc state. |
| Z4: TTS thiếu giới hạn | Tối đa 320 ký tự đầu vào, 20 câu mới/phút, 4 tác vụ gồm tác vụ đang chạy; thực thi tuần tự và gộp yêu cầu trùng. Timeout 30 giây tính cả chờ sẽ kill Python và hủy toàn bộ tác vụ chờ; timeout nạp model 120 giây. Sau lỗi cần khởi động lại app. |
| Z4: cache không giới hạn | Tối đa 128 MiB, 256 file, mỗi WAV 8 MiB/60 giây. Cache quá 24 giờ được dọn khi worker khởi động hoặc nhận tác vụ. Ghi WAV qua file tạm. |
| Z4: dependency/model thay đổi | Ghim npm đúng phiên bản từ lockfile, bỏ `cors`, mặc định chặn lifecycle script npm; Python có lock 30 package kèm SHA-256 cho CPython 3.11/macOS ARM64; model ghim revision `18d6681518a4becaed3c125ceb3c7db59905fe86`. |
| Tự kết nối kênh mẫu, chạy Python/tải model ngay khi mở app | Không tự kết nối TikTok; tắt giả lập khi khởi động; TTS mặc định tắt. Chỉ chạy Python từ `.venv` khi `ENABLE_TTS=1`. Worker mặc định chỉ dùng model đã có trong cache riêng của app; chỉ tải khi có `TTS_ALLOW_MODEL_DOWNLOAD=1`. |

Token mặc định được tạo ngẫu nhiên 256 bit mỗi lần khởi động; chỉ hiển thị trong terminal.
Không đưa token vào URL, HTML, state hoặc localStorage. Cookie phiên ngẫu nhiên có
`HttpOnly; SameSite=Strict`, hết hạn sau 8 giờ; logout thu hồi phiên trên server.
`ADMIN_TOKEN` tùy chọn phải có 32–128 ký tự chữ/số/gạch dưới/gạch ngang.
Server này dùng HTTP trên loopback, vì vậy cookie không gắn cờ Secure.

Bổ sung: CSP không cho script inline, chống nhúng iframe, giới hạn JSON 8 KiB,
rate limit quản trị/đăng nhập, WS tối đa 8 kết nối với giới hạn payload/backpressure/heartbeat.
Avatar chỉ nhận HTTPS từ một số miền CDN TikTok/ByteDance đã liệt kê trong `lib/security.js`;
avatar ngoài danh sách được bỏ. Không có request tải avatar từ backend.
State được ghi tuần tự qua file tạm rồi rename, flush khi thoát bình thường.

## Kiểm chứng và cách chạy lại

Kết quả ngày 01/11/2026:

- **19/19** kiểm thử Node đạt (`node-tests.txt`).
- **2/2** kiểm thử cache Python đạt (`python-tests.txt`).
- Browser smoke đạt: login/retry, cookie HttpOnly, reload/logout, điều khiển nhanh,
  nhận hoạt cảnh OBS và gieo quẻ, không có lỗi JavaScript hoặc vi phạm CSP (`browser-tests.txt`).
- `npm audit`: **0 advisory** cho cây đã khóa, gồm công cụ test.
- OSV: **0 package có advisory trả về** trong 30 phiên bản Python đã khóa.
- Đã kiểm tra cú pháp JS/Python, whitespace diff, URL registry và integrity của 117 package npm;
  lockfile không có package đánh dấu install script. Phiên bản trực tiếp đều được ghim chính xác.

```sh
npm ci --ignore-scripts
npm test
python3 -m unittest discover -s test -p 'test_*.py' -v
npm run test:browser
npm audit
```

Browser test dùng `playwright-core` và Chrome đã cài trên macOS; có thể đặt `CHROME_PATH`
nếu executable nằm chỗ khác. Mỗi lần chạy dùng profile và data tạm, chặn request web
bên ngoài trình duyệt. Không sử dụng profile/tài khoản Chrome của người dùng.

Các kiểm thử HTTP/WS dùng server thật trên loopback và dữ liệu giả; TikTok connector
được thay bằng fake trong bộ test sự kiện. Bộ test TTS manager dùng fake worker,
không thực thi model/native inference. Browser smoke test chạy giao diện thực tế với TTS tắt,
không kết nối phòng TikTok. Test cache Python dùng file tạm và không import ZeroTTS.

Kết quả advisory Python ở `python-advisories.json` là đối chiếu 30 phiên bản với OSV;
kết quả npm ở `npm-audit.json`. Advisory rỗng chỉ có nghĩa cơ sở dữ liệu không trả về
lỗ hổng đã biết cho các phiên bản đó tại thời điểm kiểm tra.

## Giới hạn còn lại

- Chưa kiểm thử LIVE TikTok thật, OBS/TikTok LIVE Studio thật hoặc TTS/model/native thật.
- Python lock đã được cài bằng wheel xác minh hash vào `.venv` Python 3.11.18; 30 package đã import trong sandbox. Chưa chạy model/native inference thật. Không coi
  lock/hash hoặc advisory rỗng là chứng nhận không có mã độc.
- Không audit lại toàn bộ mã nguồn từng dependency, lịch sử upstream hoặc graph ONNX.
  Review trước đó chưa phát hiện bằng chứng lấy cookie/mật khẩu/SSH key trong phạm vi đã rà.
- Process vẫn có quyền của tài khoản chạy app. Các guard HTTP không phải sandbox cho mã npm/Python
  độc hại; không chạy bằng root/admin và không cung cấp cookie/session TikTok không cần thiết.
- Không có cấu hình triển khai public/LAN. Không port-forward hoặc đặt tunnel vào server này.
- Đã cài uv 0.13.6 và Python 3.11.18 cho `.venv`; Python 3.9 hệ thống giữ nguyên. Server đã thử bằng Node 24;
  mã hỗ trợ Node 22+. Chưa xác nhận runtime Bun. TTS vẫn tắt, model cần thử riêng.
- Asset nhạc nền `public/assets/bg_chant.m4a` không có trong source tải về; giao diện có synth fallback.

Mức sử dụng đã có bằng chứng là phát triển và thử nghiệm cục bộ bản đã gia cố.
Bước tiếp theo trước vận hành là chạy thử riêng TTS và kết nối một phòng LIVE do người dùng chọn,
rồi kiểm tra hình/âm thanh trong OBS với dữ liệu thực. Không có kết luận “an toàn 100%”.
