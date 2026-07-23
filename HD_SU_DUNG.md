# HƯỚNG DẪN SỬ DỤNG - CÔNG CỤ AUTO RESIZE VIDEO

Công cụ này giúp bạn tự động chèn nền mờ (blurred background) cho video để chuyển đổi sang các định dạng kích thước khác nhau (như tỉ lệ vuông 1:1 cho TikTok/Reels, hoặc tỉ lệ ngang 16:9) một cách dễ dàng và nhanh chóng.

---

## I. CÁC LỆNH CHÍNH (SỬ DỤNG TRÊN TERMINAL HOẶC START MENU)

Bạn có thể mở cửa sổ Command Prompt (CMD), PowerShell hoặc tìm kiếm trực tiếp trên thanh Start Menu của Windows:

1. **`rs` hoặc `auto_resize`**:
   * **Mục đích**: Tự động chuyển đổi các video trong thư mục hiện tại.
   * **Cách dùng**:
     * Chạy `rs` không tham số: Quét toàn bộ file `.mp4` trong thư mục đang mở.
     * Chạy `rs "tên_file.mp4"`: Chỉ xử lý duy nhất file video được chỉ định.
     * Chạy `rs "thư_mục_video"`: Xử lý toàn bộ file `.mp4` trong thư mục đó.

2. **`srs` (Select Resize - Giao diện chọn file)**:
   * **Mục đích**: Mở hộp thoại đồ họa của Windows giúp bạn chọn một hoặc nhiều file `.mp4` bằng chuột (giữ `CTRL` hoặc `SHIFT` để chọn nhiều file).
   * **Cách dùng**: Nhập `srs` trên terminal hoặc tìm kiếm `"Select Resize (srs)"` trên Start Menu.

3. **`rss` (Resize Settings - Cài đặt cấu hình)**:
   * **Mục đích**: Quản lý danh sách kích thước xuất ra, thay đổi từ khóa thay thế tên file, hoặc đổi kiểu làm mờ nền (Blur).
   * **Cách dùng**: Nhập `rss` trên terminal, hoặc tìm kiếm `"Resize Settings (rss)"` trên Start Menu, hoặc nhấn đúp chuột vào file `setting.bat`.

4. **`rsh` (Resize Help - Hướng dẫn sử dụng)**:
   * **Mục đích**: Hiển thị nhanh tài liệu hướng dẫn này ngay trên màn hình dòng lệnh của bạn.

5. **`rsi` (Resize Install - Cài đặt & Cập nhật)**:
   * **Mục đích**: Chạy nhanh tiến trình tự động tải về, cài đặt hoặc cập nhật phiên bản mới nhất cho toàn bộ hệ thống.

---

## II. HƯỚNG DẪN CẤU HÌNH (LỆNH `rss` HOẶC `setting.bat`)

Khi mở menu cài đặt, bạn sẽ thấy giao diện dòng lệnh gồm các lựa chọn sau:

* **`[A] Thêm kích thước mới (Add)`**:
  * Nhập chiều rộng (Width) và chiều cao (Height) mong muốn (ví dụ: `1080` và `1080` để tạo kích thước `1080x1080`).
* **`[D] Xóa kích thước (Delete)`**:
  * Nhập số thứ tự của kích thước trong danh sách để xóa đi.
* **`[R] Thay đổi chuỗi thay thế (Replacer)`**:
  * Đây là từ khóa trong tên file gốc (mặc định là `"9x16"`) sẽ bị thay thế bằng tỉ lệ mới khi lưu file mà không đổi tên (ví dụ: `video_9x16.mp4` -> `video_1x1.mp4`).
* **`[B] Cài đặt hiệu ứng làm mờ (Blur)`**:
  * Cho phép bạn chọn 1 trong 3 kiểu làm mờ nền:
    1. **Gaussian Blur (Mặc định)**: Làm mờ Gauss - Rất mịn và chất lượng cao. Hỏi nhập độ mịn (`sigma`, mặc định `20`) và số bước lặp (`steps`, mặc định `3`).
    2. **Box Blur**: Làm mờ khối - Cực kì nhanh, nhẹ hơn nhưng hiệu ứng hơi ô vuông. Hỏi nhập bán kính làm mờ (`radius`, mặc định `20`) và số lần lặp (`power`, mặc định `2`).
    3. **Smart Blur**: Làm mờ thông minh - Giúp làm mờ nhưng giữ lại các đường nét biên sắc nét của hình ảnh. Hỏi nhập bán kính (`radius`, mặc định `5`), độ mạnh (`strength`, mặc định `1.0`), và ngưỡng chi tiết (`threshold`, mặc định `-0.5`).

---

## III. QUY TẮC ĐẶT TÊN FILE TỰ ĐỘNG (SMART NAMING)

Khi bắt đầu chạy chuyển đổi, công cụ sẽ hỏi bạn: **`Có đặt lại tên không (y/n):`**

### Trường hợp 1: Chọn ĐỒNG Ý đổi tên (`y` hoặc `yes`)
Công cụ sẽ yêu cầu nhập **Tên game** và **Tên chủ sở hữu** (ví dụ: Game = `LienQuan`, Owner = `Kien`). File xuất ra sẽ có định dạng:
`ngày_Game_Owner_tỉlệ_têngốc.mp4`
*Ví dụ:* `230726_LienQuan_Kien_1x1_video1.mp4`

> [!NOTE]
> **Đặc biệt:** Công cụ sẽ tự động tạo thêm một bản sao của video gốc (giữ nguyên không resize) nhưng được đổi tên theo đúng định dạng trên với đuôi kích thước gốc (ví dụ: `230726_LienQuan_Kien_9x16_video1.mp4`). Điều này giúp bạn có đủ bộ video (gồm cả video gốc lẫn các video đã resize) cùng chung một định dạng đặt tên để dễ quản lý.

### Trường hợp 2: Chọn KHÔNG đổi tên (`n` hoặc `no`)
Tên file xuất ra sẽ giữ nguyên tên gốc và chỉ thay đổi phần đuôi kích thước:
* **Nếu tên gốc chứa từ khóa thay thế (ví dụ: `9x16`)**:
  * Từ khóa đó sẽ được thay bằng tỉ lệ mới (ví dụ: `gameplay_9x16_vip.mp4` -> `gameplay_1x1_vip.mp4`).
* **Nếu tên gốc không chứa từ khóa thay thế**:
  * Tỉ lệ mới sẽ được nối thêm vào đuôi tên file (ví dụ: `gameplay.mp4` -> `gameplay_1x1.mp4`).
* **Quy tắc chống trùng tên (Resolution Suffix)**:
  * Nếu trong cấu hình của bạn có hai kích thước khác nhau nhưng cùng quy về chung một tỉ lệ (ví dụ: cả `1080x1080` và `1920x1920` đều là tỉ lệ vuông `1x1`), công cụ sẽ tự động nối thêm độ phân giải vào cuối tên để tránh ghi đè file.
  * *Ví dụ:* `gameplay_1x1_1080x1080.mp4` và `gameplay_1x1_1920x1920.mp4`.

---

## IV. CÁC TÙY CHỌN NÂNG CAO TRÊN DÒNG LỆNH (CHỈ DÀNH CHO DEV/POWER USER)

Bạn có thể truyền các tham số tùy biến trực tiếp khi chạy lệnh `rs`:

* **Chỉ định thư mục đầu ra**:
  `rs --output "D:/VideoDaResize"`
* **Chuyển sang duy nhất một tỉ lệ**:
  `rs --ratio 16:9` (hoặc `1:1`, `9:16`)
* **Resize về kích thước tùy ý (không cần lưu trong cấu hình)**:
  `rs --width 1280 --height 720`
* **Ghi đè kiểu mờ và thông số mờ trực tiếp**:
  `rs --blur <kiểu_mờ> --prag <các_thông_số>`
  * *Ví dụ sử dụng Gaussian Blur với độ mịn 30 và bước lặp 5:*
    `rs video.mp4 --blur 0 --prag 30 5`
  * *Ví dụ sử dụng Smart Blur với bán kính 10, lực mờ 2.0:*
    `rs video.mp4 --blur 2 --prag 10 2.0`
  * *Ví dụ tương thích ngược (mặc định Gaussian):*
    `rs video.mp4 --blur 35` (chạy Gaussian blur với sigma = 35)

---

Chúc bạn có những trải nghiệm làm việc hiệu quả và nhanh chóng cùng công cụ Auto Resize!
