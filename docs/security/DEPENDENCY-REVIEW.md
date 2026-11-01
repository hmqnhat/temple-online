# Rà dependency và chuẩn bị Python — 01/11/2026

## Kết luận trong phạm vi đã kiểm tra

Chưa tìm thấy bằng chứng mã độc trong những đường mã được đọc kỹ và hành vi đã quan sát.
Đây là kiểm tra tính toàn vẹn, triage toàn cây, review có trọng tâm và thử hành vi giới hạn;
không phải chứng nhận toàn bộ thư viện/native/model an toàn.

| Kiểm tra | Kết quả |
| --- | --- |
| npm | 117 package từ registry.npmjs.org; tarball khớp integrity trong lockfile; **4.108 file đang cài khớp tarball**, không có archive symlink. |
| Chữ ký npm | `npm audit signatures` kết thúc thành công; kết quả `invalid: []`, `missing: []`. Không đồng nghĩa tác giả/package không thể độc hại. |
| Script npm | Không có `preinstall`, `install`, `postinstall` trong các package đã kiểm tra. Có 4 script `prepare` phục vụ build/phát hành; cài registry theo lock và `.npmrc` chặn lifecycle scripts. Không cài dependency từ Git. |
| Python | 30 wheel đúng phiên bản/hash được cho phép trong `requirements.lock`; **5.227 file trong RECORD** được xác minh nội bộ; không có đường dẫn archive traversal. |
| Native | Inventory có 146 file native trong wheel Python; npm có 1 WASM thuộc Playwright. Đã ghi hash, chưa disassemble hoặc rebuild các binary để đối chiếu source. |
| Advisory | npm audit: 0; OSV với 30 phiên bản Python: không trả về advisory. Chỉ phản ánh thông tin đã biết trong cơ sở dữ liệu lúc kiểm tra. |
| Môi trường | CPython 3.11.18 và đúng 30 distribution của lock trong `.venv`; `uv pip check` đạt. Đã bỏ pip/setuptools/wheel dùng tạm để tải artifact khỏi môi trường TTS. |

Bằng chứng ở thư mục `dependency-audit/`: `npm-inventory.json`, `npm-static-review.json`,
`npm-signatures.json`, `npm-advisories.json`, `python-static-review.json`,
`python-advisories.json`, `python-installed.json`, `python-setup.json`.

## Các điểm đã đọc kỹ

Triage rà **1.443 file JS/CJS/MJS/script npm** và **4.023 file Python/script trong wheel**,
tìm dấu hiệu đường dẫn bí mật, persistence, tạo tiến trình, thực thi chuỗi và deserialize không an toàn.
Có 256 lead npm và 1.066 lead Python. Đây là hit regex, gồm comment/test/hàm hợp lệ;
không diễn giải chúng thành số lỗ hổng hoặc số file có mã độc. Không đọc tay từng dòng của toàn bộ cây.

- **TikTok connector 2.5.0 và SDK liên quan:** có đường gọi TikTok/Euler Stream để lấy thông tin
  phòng và chữ ký WebSocket. Đây là kết nối chức năng được công khai trong mã, không phải chỉ TikTok.
  Có hỗ trợ session/cookie và API key khi người vận hành tự cấu hình; app hiện không cấp các thông tin đó.
  Đường xác thực WS có nhánh gửi cookie tới dịch vụ ký khi được bật rõ ràng. Không đưa cookie/password
  vào app để thử phòng công khai; cấu hình mới liên quan tài khoản cần đánh giá lại.
- **Playwright Core:** có code tạo tiến trình, AppleScript và đọc `Local State` của profile Chrome
  phục vụ các tính năng điều khiển trình duyệt. Đây là dependency phát triển; app không import nó
  trong lượt thử runtime. Browser test của dự án dùng profile tạm. Có thể cài `npm ci --omit=dev --ignore-scripts`
  cho môi trường chỉ chạy app, rồi cài đầy đủ lại khi cần browser test.
- **ZeroTTS:** đường app dùng là chuẩn hóa/tokenize văn bản và nạp model/voice qua NumPy/ONNX;
  chưa thấy lệnh shell ẩn trong các đường này. Các lệnh `np.load` được xem không bật `allow_pickle=True`;
  NumPy đã khóa mặc định `allow_pickle=False`. Chưa kiểm tra graph/model thật.
- **`coloredlogs.pth`:** có một dòng Python chạy khi interpreter khởi động. Dòng này chỉ import
  coloredlogs và bật cấu hình logging nếu `COLOREDLOGS_AUTO_INSTALL` có giá trị cho phép.
  Đã xem `auto_install()`/`install()`, chưa thấy tải mã hoặc persistence ẩn trong đường đó.
  Worker dùng môi trường tối thiểu và không truyền biến bật này.
- **Hugging Face Hub:** có chức năng token cache, login, Git credential helper, CLI job/SSH và HTTP.
  Những khả năng đó không tự đồng nghĩa đánh cắp thông tin. Đã đọc đường chọn token, cache/model download,
  telemetry và đối chiếu cách worker gọi. Worker không nhận biến môi trường bí mật từ parent,
  dùng cache riêng; nay tắt implicit token, telemetry và `DO_NOT_TRACK=1`.
- **httpx2:** có `NetRCAuth` đọc `.netrc` khi được chọn rõ ràng; không thấy app tạo đối tượng này.
- **SymPy/NumPy/SciPy:** có eval/pickle/process API và code test hợp lệ; app không cung cấp endpoint
  đưa bình luận trực tiếp vào các API đó. Chưa chứng minh mọi sink trong thư viện đều không thể bị khai thác.
- Wheel ZeroTTS có metadata **0.1.5**, nhưng thuộc tính nội bộ `__version__` vẫn **0.1.2**.
  Artifact khớp hash đã khóa và metadata; ghi nhận như sự không nhất quán của upstream, không tự quy là mã độc.

Một điểm được gia cố thêm sau review: ZeroTTS trước đây tự tìm voice pack ở `~/.zerotts/voices`.
Worker nay đặt `ZEROTTS_VOICES_HOME` về `data/voices` của app để không tự nạp voice ngoài vùng dự án.

## Test cách ly phát hiện được gì?

Đã chạy `scripts/run-isolated-audit.py` trên macOS bằng Seatbelt (`sandbox-exec`).
Test dùng môi trường tối thiểu, dữ liệu tạm và token giả; không dùng tài khoản TikTok,
không đọc bí mật thật, không tải/nạp model và không tổng hợp/thu/phát âm thanh.

Trước khi chạy dependency, mỗi runtime thử bốn canary:

| Hành vi canary | Node | Python |
| --- | --- | --- |
| Đọc file “private key” giả ngoài vùng cho phép | EPERM | EPERM |
| Ghi file ngoài thư mục làm việc tạm | EPERM | EPERM |
| Tạo tiến trình `/usr/bin/true` | EPERM | EPERM |
| Nối tới server canary localhost đang lắng nghe ở cổng không được phép | EPERM | EPERM |

Server canary bên ngoài sandbox không nhận kết nối. Đây là bằng chứng kiểm tra quyền,
không dùng timeout Internet để suy đoán mạng đã bị chặn.

Sau đó server thật chạy, import dependency thật và xử lý một RPC tương tác giả thành công;
TTS tắt, TikTok chưa kết nối. Hook JS ghi nhận hai kết nối localhost do chính bài test tạo;
không thấy kết nối mạng khác trong trace. Python import đủ 30 thư viện, thực hiện phép toán NumPy,
chuẩn hóa tiếng Việt và truy vấn provider ONNX thành công; không ghi nhận socket/process event
qua Python audit hook trong pha import/thử này.

Bằng chứng: `dependency-audit/isolation-results.json`, `dependency-audit/isolation-profile.sb`.
Profile lưu lại là bằng chứng của một lượt chạy với đường dẫn tạm/cổng tạm; chạy lại script
để sinh profile mới, không dùng nguyên file bằng chứng làm launcher.

Nếu có hành vi lạ xuất hiện, trace/denial là đầu mối để truy nguyên file và hàm gọi. Nhưng
malware có thể chờ lâu, cần trigger chưa thử hoặc nhận ra sandbox. Hook JS/Python không thấy
mọi syscall của native binary. Policy không chặn toàn bộ Mach IPC và vẫn cho đọc thư viện/hệ thống
để runtime khởi tạo. Đây không phải máy ảo hay biện pháp bảo vệ đầy đủ cho mọi quyền macOS.
`npm start` bình thường **không tự chạy trong sandbox này**.

Để thử tích hợp có Internet và model ở mức cách ly cao hơn, dùng VM/máy thử không chứa tài khoản,
khóa hoặc thư mục cá nhân; không mount home, không chia sẻ clipboard; chỉ mở các đích mạng cần thiết
và lưu trace. Sau thử, khôi phục snapshot. Test vẫn chỉ cung cấp bằng chứng cho kịch bản đã chạy.

## Python đã cài và cách dùng

- uv **0.13.6** qua Homebrew: `/opt/homebrew/bin/uv`.
- CPython **3.11.18** do uv quản lý trong thư mục người dùng; cài với `--no-bin`, không đổi lệnh Python mặc định.
- Python hiện có `/usr/bin/python3` vẫn **3.9.6**.
- Dự án ghim `.python-version` là `3.11.18`; `.venv` đã cài 30 dependency bằng wheel đã xác minh/hash.
- TTS vẫn mặc định tắt; chưa tải model, chưa chạy inference thật.

```sh
# Trong thư mục dự án:
source .venv/bin/activate
python --version
# Python 3.11.18
deactivate
python3 --version
# Python 3.9.6 (theo PATH hiện tại của máy)

# Quản lý phiên bản khác khi cần, ví dụ:
uv python install 3.12 --no-bin
uv venv --python 3.12 /duong-dan-du-an-khac/.venv

# Kiểm tra môi trường dự án hiện tại:
uv pip check --python .venv/bin/python
```

Quy trình cài lại dùng `uv venv --python 3.11.18 .venv`, sau đó
`uv pip sync --python .venv/bin/python --require-hashes --only-binary :all: --index-url https://pypi.org/simple requirements.lock`.
Không cần pip global hoặc kích hoạt venv để app dùng Python: server gọi trực tiếp `.venv/bin/python`.
`.venv` chỉ tách package/version, không ngăn dependency đọc dữ liệu hoặc mở mạng.

Tài liệu gốc: [uv quản lý Python](https://docs.astral.sh/uv/guides/install-python/),
[cài uv qua Homebrew](https://docs.astral.sh/uv/getting-started/installation/#homebrew).
