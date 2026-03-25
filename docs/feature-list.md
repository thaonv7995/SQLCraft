# SQLCraft Feature List

Tài liệu này tổng hợp các tính năng chính của nền tảng **SQLCraft**, được phân loại thành các tính năng cơ bản bắt buộc phải có (Core / MVP) để hệ thống hoạt động, và các tính năng nâng cao làm nên giá trị cốt lõi của sản phẩm.

## Ghi Chú Ngôn Ngữ Sản Phẩm
- SQLCraft phải được mô tả là nền tảng SQL, không phải hệ thống learning.
- Hệ thống chỉ có 2 role: **User** và **Admin**.
- Contribution là workflow của User, không phải role riêng.
- Một số tên entity cũ như `tracks`, `lessons`, `challenges`, `learning_sessions` vẫn còn trong code và schema cho đến khi có track rename riêng.

---

## 📌 Các Tính Năng Cơ Bản Phải Có (Core / Must-Have)

Đây là nền tảng tối thiểu để người dùng có thể truy cập, chạy SQL, và làm việc với nội dung của hệ thống.

### 1. Quản lý Người Dùng & Phân Quyền (Identity)
- [x] Đăng nhập, Đăng ký, Quản lý Session bằng JWT.
- [x] Hệ thống Role cơ bản: **Admin** và **User**.
  - [x] **User**: Có quyền truy cập hệ thống, chạy SQL, và đóng góp (contribute) Database, Schema, bài học (Lessons), và lộ trình (Tracks).
  - [x] **Admin**: Quản lý hệ thống và phê duyệt (approve) các nội dung do User đóng góp trước khi xuất bản.
- [x] Trang Hồ sơ người dùng (User Profile) cơ bản.

### 2. Quản lý Nội Dung Bài Học (Lesson Engine)
- [x] Hiển thị danh sách Lộ trình học (Tracks) và cấu trúc Bài học (Lessons).
- [x] Render nội dung bài học bằng Markdown (hỗ trợ hiển thị code block, định dạng văn bản).
- [x] Luồng học `lesson-first`: từ Track -> Lesson -> Start Lab, có thể nạp sẵn starter query của bài học.

### 3. Phòng Lab SQL Cơ Bản (Basic SQL Editor)
- [x] Trình soạn thảo SQL tích hợp (dùng CodeMirror) có syntax highlighting và tự động gợi ý mã (SQL autocompletion).
- [x] Chạy lệnh SQL và nhận kết quả đồng bộ từ phía người dùng (frontend tự poll kết quả sau khi backend xử lý async qua job queue).
- [x] Hiển thị kết quả dưới dạng bảng (Data Table) với row count, truncation indicator rõ ràng khi kết quả bị giới hạn, và nút copy kết quả/query ra clipboard.
- [x] Hiển thị lỗi rõ ràng: phân biệt lỗi validation (SQL bị chặn) và lỗi runtime (lỗi PostgreSQL trả về).
- [x] Giao diện xem Schema/Database lấy dữ liệu thực từ sandbox đang chạy (không dùng mock), hiển thị bảng, cột, kiểu dữ liệu, primary key, foreign key.
- [x] Quản lý vòng đời phiên lab (Session Lifecycle): hiển thị rõ trạng thái provisioning / active / expired / failed, có nút "Start new session" khi phiên hết hạn hoặc lỗi.
- [x] Nút Format SQL (làm đẹp code) và Clear Editor (xóa sạch editor về trạng thái ban đầu).

### 4. Hệ thống Thử Thách & Đánh Giá (Challenge Engine)
- [x] Là tính năng tùy chọn (không bắt buộc): Người dùng có thể tự do chọn các Thử thách (Challenge) để thực hành nâng cao và kiếm điểm.
- [x] So khớp kết quả truy vấn (Result-set Validation) của người dùng với kết quả chuẩn để tự động chấm điểm đúng/sai. Hệ thống hiện chạy `referenceSolution` trên đúng sandbox của session và so sánh full result-set (columns, row count, row values) trước khi chấm điểm.
- [x] Có trang Challenge nằm trong ngữ cảnh Lesson, hỗ trợ xem mô tả, lịch sử attempt, best score và leaderboard cơ bản.
- [x] Hỗ trợ đóng góp nội dung: User đã đăng nhập có thể tự tạo Thử thách mới ở dạng draft. Sau khi được Admin duyệt (approve/publish), Thử thách sẽ lập tức hiển thị công khai (public) trong lesson context cho cộng đồng cùng tham gia giải.
- [x] Các challenge có point và so sánh để đánh giá query tối ưu. Điểm hiện được tách theo correctness + performance baseline + index optimization; index score chỉ được cộng khi có cả lịch sử tạo index trong session và `EXPLAIN ANALYZE` chứng minh plan thật sự dùng index. Baseline hiệu năng được tác giả challenge cấu hình từ base database ban đầu qua `validatorConfig.baselineDurationMs`.

### 5. Quản trị Sandbox An Toàn (Sandbox Isolation)
- [x] Cấp phát một Database độc lập (PostgreSQL Container) cho từng người học trong một phiên thực hành (Session) để cô lập dữ liệu. Worker hiện tạo container PostgreSQL riêng cho từng sandbox/session, gắn vào Docker network nội bộ và dùng `container_ref` làm host kết nối nội bộ.
- [x] Worker tự động dọn dẹp Sandbox khi người dùng kết thúc phiên học hoặc quá thời gian (Timeout/Cleanup).

---

## 🚀 Các Tính Năng Nâng Cao & Tối Ưu (Advanced / Key Differentiators)

Đây là cụm tính năng đặc thù giúp SQLCraft vượt trội, tập trung vào mảng tối ưu hóa hiệu năng (Query Optimization).

### 6. Trình Vẽ Cây Execution Plan (Execution Plan Visualizer)
- [x] Chạy lệnh `EXPLAIN` và `EXPLAIN ANALYZE` ngầm. Luồng `Run` giờ tự chọn plan mode phù hợp: `EXPLAIN ANALYZE` cho query đọc an toàn (`SELECT`, `WITH ... SELECT`) và `EXPLAIN` cho các câu lệnh hỗ trợ nhưng có khả năng ghi (`INSERT` / `UPDATE` / `DELETE` / `WITH` chứa DML), tránh side-effect ngoài ý muốn.
- [x] Dịch kết quả từ Database engine thành một biểu đồ cây (Tree Visualizer) trực quan hiển thị Cost, Scanned Rows, Actual Time, Index Hit/Miss, buffer hits/reads và highlight bottleneck/hot path thay cho JSON thô trong tab Execution Plan.

### 7. Điều Chỉnh Quy Mô Dữ Ưiệu (Progressive Dataset Scaling)
- [x] Khi Admin import metadata của một canonical dataset qua Admin API, hệ thống lưu schema definition, row count từng bảng, tổng số dòng toàn DB, phân loại source scale dựa trên tổng số dòng, và ghi `system_jobs` để theo dõi import/generation.
- [x] Cho phép người dùng chuyển đổi workload chạy trên các kích cỡ dữ liệu khác nhau cho cùng một cấu trúc bảng (Schema):
  - [x] **Tiny**: khoảng 100 dòng.
  - [x] **Small**: khoảng 10,000 dòng.
  - [x] **Medium**: khoảng 1-5 Triệu dòng.
  - [x] **Large**: trên 10 Triệu dòng.
  - [x] Chỉ cho phép chọn từ scale gốc xuống các scale nhỏ hơn; không upscale vượt quá database import ban đầu.
  - [x] Khi đổi scale, worker reprovision sandbox từ dataset template tương ứng; nếu template có artifact thì restore từ artifact, nếu không thì seed deterministic từ rowCounts thay vì resize trực tiếp sandbox đang chạy.
- [x] Hệ thống tự sinh các dataset template dẫn xuất cho cùng schema từ canonical rowCounts; worker provision/reprovision từ artifact nếu có, hoặc fallback sang deterministic synthetic load để giữ FK integrity, phân phối dữ liệu và coverage nghiệp vụ cơ bản.

### 8. Thực Hành Tối Ưu Hóa & Đánh Giá Chi Phí (Optimization Labs)
- [x] Hỗ trợ lưu lịch sử truy vấn (Query History) để dễ dàng nhìn lại quá trình làm bài.
- [x] Tính năng chạy so sánh trực tiếp song song (Side-by-side) 2 câu truy vấn.
- [x] Cấp quyền an toàn cho người dùng tự tạo (`CREATE INDEX`) và xóa (`DROP INDEX`) để đo lường mức độ cải thiện tốc độ trực tiếp trên dữ liệu lớn.
- [x] **Schema Diff View**: Hiển thị những thay đổi người dùng đã thực hiện trong sandbox so với schema gốc (base schema từ template), bao gồm: indexes thêm/xóa, partitions, views, materialized views, stored procedures/functions. Kèm nút **"Reset sandbox về base"** để hoàn tác toàn bộ thay đổi và bắt đầu lại.
- [x] Đánh giá bài làm bằng "Performance Score" thay vì chỉ đánh giá đúng/sai.

### 9. Công Cụ Đóng Góp Nội Dung (Contribution Tools)
- [x] Trình soạn thảo Markdown kết hợp SQL Validator cho User kiểm tra tính đúng đắn của đề bài trước khi gửi đóng góp. Contribution UI hiện có `Write / Preview / Preflight`, validate `referenceSolution` trước khi submit, và cho phép mở lại draft để gửi phiên bản mới.
- [x] Giao diện Admin để duyệt (approve/reject) nội dung từ User. Admin hiện có moderation queue cho challenge draft với các trạng thái `pending / approved / changes_requested / rejected`, kèm review note và nút `Approve & Publish`, `Request Changes`, `Reject Draft`.
- [x] Quản lý phiên bản bài học (Content Versioning) giúp cập nhật mà không làm hỏng dữ liệu học cũ. Admin có thể tạo, xem, nạp lại vào editor, và publish các lesson version riêng biệt.

### 10. Động Lực Học Tập (Gamification)
- [ ] Leaderboard vinh danh những người giải quyết bài toán với thời gian và chi phí truy vấn (Cost) thấp nhất.

### 11. Quản Trị Hệ Thống Toàn Diện (Super Admin Console)
- [ ] **Quản Lý Database & Schema (Database Management)**: Quản lý các mẫu Schema gốc (Schema Templates) và mẫu Dữ liệu gốc (Dataset Templates). **Hỗ trợ tính năng Upload SQL Dump**: Khi Admin tải lên một file dump (ví dụ `.sql`), hệ thống tự động quét (auto-scan) và trích xuất cấu trúc (danh sách bảng, cột, khóa, số lượng dòng), tổng row count, metadata domain và phân loại scale gốc để review trước khi publish. Từ database gốc này, worker có thể sinh các dataset artifact nhỏ hơn dùng cho user sandbox.
- [ ] **Quản Lý Hệ Thống Bài Học (Content Management)**: Công cụ cho phép Admin có toàn quyền tạo mới, chỉnh sửa, xóa Lộ trình học (Tracks), Bài học (Lessons), và cấu hình chi tiết cho các Thử thách (Challenges) nếu không đợi User đóng góp.
- [ ] **Quản Lý Cộng Đồng (User & Contribution)**: Giao diện phân quyền tài khoản (User Management), ban/khóa User vi phạm, phê duyệt hoặc từ chối các nội dung (bài học/thử thách/db) do User gửi lên.
- [ ] **Giám Sát Hệ Thống (System Monitoring)**: Theo dõi "sức khỏe" nền tảng (Health Dashboard), trạng thái hàng đợi cấp phát Container/Dataset của Worker, xem log lỗi và quản lý tài nguyên máy chủ.
