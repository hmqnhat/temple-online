# ZeroTTS đã cài và thử thật — 01/11/2026

## Đã cài

- uv 0.13.6, Python 3.11.18 và 30 dependency theo `requirements.lock` trong `.venv`.
- Model `zeroweight-ai/ZeroTTS` ghim revision `18d6681518a4becaed3c125ceb3c7db59905fe86`.
- 38 file model/config/tokenizer/codec/voice; tổng **1.047.985.886 byte**, khoảng 1,05 GB hoặc 0,976 GiB.
- 8 giọng: `baotrang`, `giahuy`, `hamy`, `huuduc`, `kimoanh`, `maichi`, `quangminh`, `tiendat`.
- Cache riêng ở `data/model-cache/hub`; không đưa model vào Git.
- Tải ẩn danh từ Hugging Face, không dùng token/tài khoản; không cài PyTorch hoặc web UI.

Script setup xác nhận revision trả về đúng SHA đã ghim. File LFS được đối chiếu SHA-256;
file Git thông thường đối chiếu Git blob OID (SHA-1 gồm header), đồng thời ghi SHA-256 cục bộ
cho mọi file. **38/38 file khớp**. Hash chứng minh khớp artifact được công bố, không chứng nhận
model không có lỗ hổng/độc hại. Manifest đầy đủ ở `zerotts-model-install.json`.

## Kiểm thử thực tế

`scripts/smoke-zerotts.cjs` chạy HTTP server thực trên loopback và gọi `temple.speak`
bằng credential tạm. Worker Python thực chạy trong macOS sandbox: mạng bị chặn,
không tạo tiến trình con, chỉ ghi WAV trong cache; model chỉ nạp từ ổ đĩa.
Không kết nối TikTok hoặc dùng tài khoản thật. Không thay điểm/trạng thái người xem.

Kết quả trên **Apple M1 Pro, RAM 16 GB**, ONNX CPU, 3 inference threads:

| Phép đo | Kết quả |
| --- | --- |
| Khởi động và nạp model | 4,35 giây |
| Mẫu tiếng Việt 1 | Tạo trong 1,68 giây; WAV dài 3,60 giây |
| Mẫu tiếng Việt 2 | Tạo trong 1,90 giây; WAV dài 3,60 giây |
| WAV và HTTP audio | PCM 16-bit, mono, 48 kHz; tải được qua HTTP, biên độ hợp lệ/không im lặng |
| Gọi lại câu đã tạo | Cache hit đạt |
| RSS của worker khi ready | 1.050,6 MiB |
| RSS sau từng mẫu | 1.126,5 và 1.198,7 MiB |

RAM là ảnh chụp RSS của riêng worker, không phải peak hay tổng RAM LIVE.
Đây là hai câu ngắn, chưa phải benchmark tải dài hoặc đánh giá nghe/phát âm.
Không áp dụng con số first-chunk streaming của upstream cho app: app hiện tạo cả câu
rồi phát WAV. Khi chạy lại có thể hit cache, nên không dùng thời gian cache để suy ra tốc độ tổng hợp.

Mẫu nghe trong `data/tts-samples/maichi-1.wav` và `maichi-2.wav`.
Kết quả máy đọc ở `zerotts-runtime-test.json`. Server/worker thử đã được dừng.

## Chạy app có TTS

Trong thư mục source:

```sh
npm run start:tts
```

Mở `http://127.0.0.1:3000/admin`, nhập mã quản trị từ terminal, đợi trạng thái `ready`
và dùng nút đọc thử Mai Chi. Trên màn hình live/OBS cần cho phép phát âm thanh hoặc thao tác
mở khóa âm thanh theo giao diện/phần mềm phát. Chưa có kiểm thử OBS thực hoặc LIVE TikTok thực.

Lệnh `start:tts` bật giọng nhưng không cho worker tự tải model, không tự kết nối phòng TikTok.
`npm start` thông thường vẫn giữ TTS tắt. Normal launcher không tự áp dụng OS sandbox của bài test.

Để cài lại hoặc kiểm tra trên máy khác:

```sh
uv venv --python 3.11.18 .venv
uv pip sync --python .venv/bin/python --require-hashes --only-binary :all: --index-url https://pypi.org/simple requirements.lock
.venv/bin/python scripts/setup-zerotts.py
node scripts/smoke-zerotts.cjs
```

Smoke script dùng `sandbox-exec` và `ps` của macOS. Nó chỉ kiểm thử local, không bật LIVE.
