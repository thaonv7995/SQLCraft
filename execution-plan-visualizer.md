# Execution Plan Visualizer

## Goal

Hoàn thiện mục 6 trong `docs/feature-list.md` bằng cách:

1. Tự động thu execution plan khi người dùng chạy query.
2. Hiển thị plan dưới dạng cây trực quan thay cho JSON thô.
3. Làm rõ bottleneck bằng cost, scanned rows, actual time và index hit/miss.

## Plan

### 1. Data flow
- Chuẩn hóa response `query-executions` ở web client để map:
  - `resultPreview -> result`
  - `plans[] -> executionPlan`
- Bảo toàn tương thích với shape mới và shape cũ.

### 2. Silent EXPLAIN
- Với query đọc an toàn (`SELECT`, `WITH ... SELECT`), tự gửi `EXPLAIN ANALYZE`.
- Với query có khả năng ghi (`INSERT`, `UPDATE`, `DELETE`, `WITH` chứa DML), chỉ dùng `EXPLAIN`.
- Không tự explain cho các statement không phù hợp như `CREATE INDEX`, `DROP INDEX`, `ALTER`.

### 3. Visualizer
- Tạo component tree riêng cho PostgreSQL JSON plan.
- Hiển thị:
  - node type
  - relation / index name
  - total cost
  - scanned rows
  - actual time
  - index hit / miss
  - filter / join / index condition khi có
- Đánh dấu bottleneck theo actual-time share, seq scan lớn, hoặc cardinality skew.

### 4. Verification
- Thêm unit test cho heuristic chọn plan mode.
- Thêm component test cho execution plan tree.
- Chạy test/lint tập trung và cập nhật checklist tài liệu.
