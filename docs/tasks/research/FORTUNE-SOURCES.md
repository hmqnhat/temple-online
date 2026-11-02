# Nghiên cứu sơ bộ nguồn quẻ và audit legacy

Ngày kiểm tra: 02/11/2026. Baseline code: `f422785`.
Phạm vi hoàn tất: đọc 10 quẻ trong source; đối chiếu 10 số tương ứng ở một ấn bản có nguồn; tìm nguồn sơ cấp cho task T11. **Chưa nhập đủ bộ 100 quẻ hoặc sửa runtime.**

## Kết luận đối với bộ đang có

Trong code không có URL, sách, chùa, edition hoặc tác giả/bản dịch cho FORTUNE_DECK. Có 10 mục, tất cả nhãn cát; comment nói 18 không phản ánh số bản ghi.
Khi so với bản Quan Âm linh xăm của Chinese Temples Committee (CTC), cả 10 tên/chủ đề thơ đều khác số tương ứng. Một số hạng cũng khác rõ rệt (ví dụ 24/52/99 ở CTC là hạ).
Kết luận sử dụng: **10/10 chưa đạt tiêu chí quẻ truyền thống có nguồn kiểm chứng của người dùng; không đưa tiếp vào production với nhãn đã xác thực nếu không bổ sung được chứng cứ.**
Đây KHÔNG phải bằng chứng rằng chúng chắc chắn do AI bịa hoặc không tồn tại trong mọi dị bản. Đối chiếu này chỉ xác lập không thể coi bộ code là bản dịch đúng của ấn bản CTC đang so sánh. Chưa tìm thấy nguồn sơ cấp cho chính các bài Việt trong code qua đợt research này.

## Nguồn đã mở/đọc

### 1. Chinese Temples Committee — bản Quan Âm 100 quẻ

[Trang giới thiệu và tra quẻ](https://www.ctc.org.hk/chim-search/) cho phép tra số 1–100. CTC giải thích đã đối chiếu/chỉnh lý các dị bản, coi bản của họ là bổ sung tham khảo, không thống nhất mọi phiên bản. Vì vậy phải ghi đúng edition CTC, không gọi là bản duy nhất của tất cả chùa.

Đây là ứng viên dữ liệu có xuất xứ, chưa phải quyết định cuối thay mặt người dùng về ấn bản. Các trang sau đã được kiểm tra, không chỉ lấy từ snippet:

| Số | Tên legacy trong code | Tích truyện và hạng ở bản CTC | Kết quả |
| --- | --- | --- | --- |
| 1 | Nhật Xuất Đông Phương | [鍾離成道 — thượng](https://www.ctc.org.hk/chim/觀音籤-第一籤/) | Khác tích/chủ đề |
| 8 | Kim Liên Khai Nở | [姚能遇仙 — thượng](https://www.ctc.org.hk/chim/觀音籤-第八籤/) | Nguồn nói hình ảnh rừng tùng, không phải thơ sen legacy |
| 12 | Long Vân Tương Hội | [武吉遇師 — thượng](https://www.ctc.org.hk/chim/觀音籤-第十二籤/) | Khác tích/chủ đề |
| 18 | Xuân Phong Đắc Ý | [曹國舅為仙 — thượng](https://www.ctc.org.hk/chim/觀音籤-第十八籤/) | Khác tích/chủ đề |
| 24 | Vũ Quá Thiên Thanh | [殷郊遇師 — hạ](https://www.ctc.org.hk/chim/觀音籤-第二十四籤/) | Khác nội dung/hạng với Trung Cát legacy |
| 36 | Phúc Tinh Cao Chiếu | [湘子遇賓 — trung](https://www.ctc.org.hk/chim/觀音籤-第三十六籤/) | Khác nội dung/hạng với Thượng Thượng Cát legacy |
| 52 | Ngọc Xuất Côn Sơn | [太白醉撈明月 — hạ](https://www.ctc.org.hk/chim/觀音籤-第五十二籤/) | Khác nội dung/hạng với Thượng Cát legacy |
| 68 | Lộc Mã Đồng Hương | [郭汾陽祝壽 — thượng](https://www.ctc.org.hk/chim/觀音籤-第六十八籤/) | Khác tích/chủ đề |
| 81 | Nguyệt Nhập Trung Thiên | [風送滕王閣 — thượng](https://www.ctc.org.hk/chim/觀音籤-第八十一籤/) | Khác tích/chủ đề |
| 99 | Vạn Sự Viên Thành | [陶三春掛帥 — hạ](https://www.ctc.org.hk/chim/觀音籤-第九十九籤/) | Khác nội dung/hạng với Thượng Thượng Cát legacy |

Các tên/hạng Hán ở đây là metadata tham chiếu, chưa phải bản dịch tiếng Việt đầy đủ được duyệt. Không sao chép nguyên các bài giải hiện đại chỉ vì truy cập được trang; T11 phải ghi điều kiện tái sử dụng phù hợp.

### 2. Chùa Long Sơn (Đài Bắc) — bằng chứng thực hành từ chính chùa

[Hướng dẫn chính thức của Long Sơn](https://lungshan.org.tw/Tour_Guide/search) mô tả xin Quan Thế Âm linh xăm, lấy tờ theo số và tra sách chú giải tại chùa. Nguồn này xác nhận một chùa có thực hành và tài liệu xăm; không được dùng nó để tự gán toàn bộ nội dung bản CTC là của Long Sơn.

Số quẻ không đủ định danh văn bản: edition, thơ và tích truyện đều phải đối chiếu. Không trộn bản Long Sơn, Quan Âm CTC và Hoàng Đại Tiên theo cùng số.

### 3. Nguồn sơ cấp bổ sung để T11 tiếp tục tra

[Cơ quan Dân chính Đài Nam — tài liệu quẻ cho chùa/miếu](https://bca.tainan.gov.tw/cp.aspx?n=13618) yêu cầu nơi sử dụng đối chiếu nguyên văn của mình với bộ đã cung cấp trước khi dùng bản giải/dịch. Đây là đầu mối tìm bản có provenance, không có nghĩa mọi bản trên đó là cùng một bộ hay đã có quyền tái phân phối vào app.

## Cách lựa chọn dữ liệu tiếp theo

1. Ưu tiên nguyên văn và ấn bản có chùa/đơn vị xuất bản xác định; tìm bản Việt có thể đối chiếu, nếu không có thì giữ bản gốc và dịch nghĩa minh bạch.
2. Dùng đúng số quẻ/hạng/thơ của một bộ đầy đủ, không tự đổi thành mục tiêu 64–100 hoặc chỉ chọn toàn quẻ tốt.
3. Một record = collection + edition + number; kèm source URL, nguyên văn, bản dịch, nơi xuất bản, thời điểm truy cập và mức kiểm chứng.
4. Tóm tắt TTS không được mạo nhận là nguyên văn, không thêm kết quả mà nguồn không nói. Quà/xu không thay đổi kết quả quẻ.
5. Sau khi chọn nguồn và kiểm chứng/nhập từng mục, chạy chống lặp và nghiệm thu nội dung ở T11 rồi T10. Bảng trên là audit, không phải dataset replacement.

## Cập nhật T11 (02/11/2026)

Người dùng chọn ấn bản **CTC Quan Âm 100 quẻ**. Đã nhập đủ 100/100 quẻ (34 thượng, 46 trung, 20 hạ) bằng `scripts/import-fortunes.py` từ trang CTC đã lưu cục bộ; mỗi trang phải parse đủ 4 câu thơ và 4 câu giải, nếu không importer dừng. Ledger từng quẻ: [fortune-ledger-ctc-100.json](fortune-ledger-ctc-100.json). Dữ liệu runtime: `content/fortunes/ctc-guanyin-100/` (`source.json` nguyên văn Hán, `vi.json` lớp tiếng Việt tách riêng). Bảng audit 10 quẻ cũ ở trên vẫn đúng; 10 quẻ cũ đã bị gỡ khỏi runtime.
Quyền tái phân phối chưa xác nhận (người dùng chấp nhận lưu nguyên văn kèm cảnh báo). Lớp tiếng Việt (tên tích, Hán-Việt, thơ poemVi, lời giải) đã được người dùng review; runtime đọc và hiển thị poemVi.
