# Large Dump Review

## Mục tiêu
Bộ tài liệu này tách riêng luồng xử lý SQL dump lớn, golden snapshot, và kết nối giữa các service trong SQLForge.

Nó được viết để trả lời 3 câu hỏi thực dụng:

- Với dump vài GB thì hệ thống hiện tại chịu tải được tới đâu?
- Luồng nào đang đúng về mặt streaming nhưng vẫn còn rủi ro vận hành?
- Chỗ nào sai logic dữ liệu giữa các service, cần sửa trước khi scale?

## Phạm vi

- upload và scan dump
- import từ scan thành schema/dataset template
- provision sandbox từ artifact hoặc golden snapshot
- bake golden snapshot và schema snapshot
- kết nối `api`, `worker`, `worker-query`, `redis`, `postgres`, `minio`, Docker daemon

## Bản đồ tài liệu

1. [01-upload-and-scan-flow.md](./01-upload-and-scan-flow.md)
   Đi sâu luồng upload, normalize, scan head, scan async row-count, và các vấn đề quanh artifact nén.
2. [02-import-and-provision-flow.md](./02-import-and-provision-flow.md)
   Phân tích từ `scanId` sang dataset template, rồi sang sandbox restore thật sự.
3. [03-golden-snapshot-flow.md](./03-golden-snapshot-flow.md)
   Mổ xẻ pipeline bake snapshot, bottleneck disk/timeout, và hành vi với dump vài GB.
4. [04-service-connectivity.md](./04-service-connectivity.md)
   Ghi rõ service nào nói chuyện với service nào bằng cơ chế gì, và các điểm connect hiện đang mong manh.

## Luồng tổng thể

```mermaid
sequenceDiagram
    participant U as User/Admin
    participant API as API
    participant S3 as MinIO/S3
    participant R as Redis/BullMQ
    participant W as Worker (sandbox)
    participant WQ as Worker (query)
    participant DB as Metadata DB
    participant SB as Sandbox DB Container

    U->>API: Upload dump / complete upload session
    API->>S3: Persist artifact + metadata head
    API->>DB: Insert sql_dump_scans row
    API->>R: Enqueue sql_dump_scan
    R->>W: Run sql_dump_scan job
    W->>S3: Stream artifact
    W->>DB: Update progress / status
    W->>S3: Upload full metadata sidecar

    U->>API: Import from scanId
    API->>S3: Load stored scan metadata
    API->>DB: Create schema_templates + dataset_templates
    API->>R: Enqueue dataset_golden_bake / provision jobs

    R->>W: Provision sandbox / bake golden snapshot
    W->>SB: Restore artifact or snapshot
    W->>S3: Upload golden snapshot + schema snapshot
    W->>DB: Mark dataset golden ready

    U->>API: Execute query
    API->>R: Enqueue query job
    R->>WQ: Execute query
    WQ->>SB: Query + schema diff snapshot
    WQ->>S3: Load golden schema snapshot (best case)
    WQ->>DB: Store results / plan / diff summary
```

## Kết luận nhanh

- Luồng restore `.sql` và `.sql.gz` cho PostgreSQL, MySQL/MariaDB, và SQL Server hiện đã đi theo hướng streaming nên không còn phụ thuộc tuyệt đối vào RAM worker.
- Luồng upload session cho artifact nén hiện chưa canonicalize artifact trước khi persist final object; đây là issue logic nặng nhất vì scan và restore đang nhìn cùng một file theo hai cách khác nhau.
- Golden snapshot xử lý được dataset lớn nếu host đủ khỏe, nhưng hiện bị chặn bởi temp disk và timeout tĩnh nhiều hơn là bởi bộ nhớ.
- `worker-query` đang phụ thuộc vào đường đọc object storage qua Docker CLI dù service này không sở hữu Docker socket; đây là vấn đề connect-service rõ ràng.

## Đọc theo thứ tự đề xuất

1. Đọc `01-upload-and-scan-flow.md` để hiểu artifact đi vào hệ thống thế nào.
2. Đọc `02-import-and-provision-flow.md` để thấy format artifact ảnh hưởng restore ra sao.
3. Đọc `03-golden-snapshot-flow.md` để đánh giá tính chịu tải với dump vài GB.
4. Đọc `04-service-connectivity.md` để chốt phần wiring giữa các service và runtime dependency.
