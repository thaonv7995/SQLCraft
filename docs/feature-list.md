# SQLCraft Feature List

Tài liệu này tổng hợp các tính năng chính của nền tảng **SQLCraft**, được phân loại thành các tính năng cơ bản bắt buộc phải có (Core / MVP) để hệ thống hoạt động, và các tính năng nâng cao làm nên giá trị cốt lõi của sản phẩm.

---

## 📌 Các Tính Năng Cơ Bản Phải Có (Core / Must-Have)

Đây là nền tảng tối thiểu để học viên có thể vào học và thực hành SQL.

### 1. Quản lý Người Dùng & Phân Quyền (Identity)
- [ ] Đăng nhập, Đăng ký, Quản lý Session bằng JWT.
- [ ] Hệ thống Role cơ bản: **Admin** và **User**.
  - [ ] **User**: Có quyền học tập và đặc biệt có quyền đóng góp (contribute) các Database mặc định, Schema, Bài học (Lessons), và Lộ trình (Tracks).
  - [ ] **Admin**: Quản lý hệ thống và phê duyệt (approve) các nội dung do User đóng góp trước khi xuất bản.
- [ ] Trang Hồ sơ người dùng (User Profile) cơ bản.

### 2. Quản lý Nội Dung Bài Học (Lesson Engine)
- [ ] Hiển thị danh sách Lộ trình học (Tracks) và cấu trúc Bài học (Lessons).
- [ ] Render nội dung bài học bằng Markdown (hỗ trợ hiển thị code block, định dạng văn bản).

### 3. Phòng Lab SQL Cơ Bản (Basic SQL Editor)
- [ ] Trình soạn thảo SQL tích hợp (dùng CodeMirror) có syntax highlighting và tự động gợi ý mã (SQL autocompletion).
- [ ] Chạy lệnh SQL trực tiếp trên trình duyệt.
- [ ] Hiển thị kết quả dưới dạng bảng (Data Table) và các thông báo lỗi cơ bản (Syntax Error).
- [ ] Giao diện xem Schema/Database để biết cấu trúc bảng hiện tại.

### 4. Hệ thống Thử Thách & Đánh Giá (Challenge Engine)
- [ ] Là tính năng tùy chọn (không bắt buộc): Người dùng có thể tự do chọn các Thử thách (Challenge) để thực hành nâng cao và kiếm điểm.
- [ ] So khớp kết quả truy vấn (Result-set Validation) của học viên với kết quả chuẩn để tự động chấm điểm đúng/sai.
- [ ] Hỗ trợ đóng góp nội dung: Bất kỳ User nào cũng có thể tự tạo Thử thách mới. Sau khi được duyệt (Admin approve), Thử thách sẽ lập tức hiển thị công khai (public) cho cộng đồng cùng tham gia giải.

### 5. Quản trị Sandbox An Toàn (Sandbox Isolation)
- [ ] Cấp phát một Database độc lập (PostgreSQL Container) cho từng người học trong một phiên thực hành (Session) để cô lập dữ liệu.
- [ ] Worker tự động dọn dẹp Sandbox khi người dùng kết thúc phiên học hoặc quá thời gian (Timeout/Cleanup).

---

## 🚀 Các Tính Năng Nâng Cao & Tối Ưu (Advanced / Key Differentiators)

Đây là cụm tính năng đặc thù giúp SQLCraft vượt trội, tập trung vào mảng tối ưu hóa hiệu năng (Query Optimization).

### 6. Trình Vẽ Cây Execution Plan (Execution Plan Visualizer)
- [ ] Chạy lệnh `EXPLAIN` và `EXPLAIN ANALYZE` ngầm.
- [ ] Dịch kết quả từ Database engine thành một biểu đồ cây (Tree Visualizer) trực quan hiển thị Cost, Scanned Rows, Index Hit/Miss giúp nhận diện "cổ chai" (bottleneck).

### 7. Điều Chỉnh Quy Mô Dữ Ưiệu (Progressive Dataset Scaling)
- [ ] Cho phép người học chuyển đổi bài tập chạy trên các kích cỡ dữ liệu khác nhau cho cùng một cấu trúc bảng (Schema):
  - [ ] **Tiny**: 100 dòng.
  - [ ] **Small**: 10,000 dòng.
  - [ ] **Medium**: 1-5 Triệu dòng.
  - [ ] **Large**: Trên 10 Triệu dòng.
- [ ] Worker tự động sinh (Async Dataset Generation) các bộ dữ liệu mẫu lớn như dữ liệu Ecommerce.

### 8. Thực Hành Tối Ưu Hóa & Đánh Giá Chi Phí (Optimization Labs)
- [ ] Hỗ trợ lưu lịch sử truy vấn (Query History) để dễ dàng nhìn lại quá trình làm bài.
- [ ] Tính năng chạy so sánh trực tiếp song song (Side-by-side) 2 câu truy vấn.
- [ ] Cấp quyền an toàn cho học viên tự tạo (`CREATE INDEX`) và xóa (`DROP INDEX`) để đo lường mức độ cải thiện tốc độ trực tiếp trên dữ liệu lớn.
- [ ] Đánh giá bài làm bằng "Performance Score" thay vì chỉ đánh giá đúng/sai.

### 9. Công Cụ Đóng Góp Nội Dung (Contribution Tools)
- [ ] Trình soạn thảo Markdown kết hợp SQL Validator cho User kiểm tra tính đúng đắn của đề bài trước khi gửi đóng góp.
- [ ] Giao diện Admin để duyệt (approve/reject) nội dung từ User.
- [ ] Quản lý phiên bản bài học (Content Versioning) giúp cập nhật mà không làm hỏng dữ liệu học cũ.

### 10. Động Lực Học Tập (Gamification)
- [ ] Leaderboard vinh danh những người giải quyết bài toán với thời gian và chi phí truy vấn (Cost) thấp nhất.

### 11. Quản Trị Hệ Thống Toàn Diện (Super Admin Console)
- [ ] **Quản Lý Database & Schema (Database Management)**: Quản lý các mẫu Schema gốc (Schema Templates) và mẫu Dữ liệu gốc (Dataset Templates). **Hỗ trợ tính năng Upload SQL Dump**: Khi Admin tải lên một file dump (ví dụ `.sql`), hệ thống tự động quét (auto-scan) và trích xuất cấu trúc (danh sách bảng, cột, khóa, số lượng dòng) để review và duyệt trước khi đưa vào cấu hình làm CSDL mặc định.
- [ ] **Quản Lý Hệ Thống Bài Học (Content Management)**: Công cụ cho phép Admin có toàn quyền tạo mới, chỉnh sửa, xóa Lộ trình học (Tracks), Bài học (Lessons), và cấu hình chi tiết cho các Thử thách (Challenges) nếu không đợi User đóng góp.
- [ ] **Quản Lý Cộng Đồng (User & Contribution)**: Giao diện phân quyền tài khoản (User Management), ban/khóa User vi phạm, phê duyệt hoặc từ chối các nội dung (bài học/thử thách/db) do User gửi lên.
- [ ] **Giám Sát Hệ Thống (System Monitoring)**: Theo dõi "sức khỏe" nền tảng (Health Dashboard), trạng thái hàng đợi cấp phát Container/Dataset của Worker, xem log lỗi và quản lý tài nguyên máy chủ.
