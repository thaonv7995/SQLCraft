# Progressive Dataset Scaling

## Goal

Hoàn thiện feature 7 bằng cách biến canonical dataset import thành source-of-truth cho scale metadata, sinh dataset templates nhỏ hơn từ rowCounts, rồi cho learner chọn scale hợp lệ để provision hoặc reprovision sandbox với dữ liệu thật.

## Approach

Xử lý scale ở import-time và provision-time, không resize trực tiếp sandbox đang chạy. Tận dụng `dataset_templates`, `system_jobs`, flow `databases/sessions`, và sandbox provisioning hiện có; canonical import đi qua Admin API, derived templates được tạo từ rowCounts, và worker load dữ liệu bằng artifact restore nếu có hoặc deterministic synthetic fallback nếu chưa có artifact.

## Scope

- In:
  - ingest canonical schema metadata + rowCounts và classify source scale
  - generate derived dataset templates cho các scale nhỏ hơn cùng schema
  - bind session vào scale được chọn và enforce rule chỉ đi từ lớn xuống bé
  - reprovision sandbox khi user đổi scale
  - job/admin visibility và test trọng điểm
- Out:
  - upscale vượt quá imported source scale
  - resize hoặc xóa bớt dữ liệu trực tiếp trong live sandbox
  - multi-engine support ngoài PostgreSQL trong V1

## Tasks

- [x] Task 1: Mở rộng data model và repository trong `apps/api/src/db/schema/index.ts` cùng các repository liên quan để lưu per-table row counts, source scale inference, và allowed scales từ `dataset_templates` → Verify: repository đọc ghi được một canonical dataset và nhiều derived dataset templates cho cùng schema.
- [x] Task 2: Thêm luồng admin import trong API/admin modules và `system_jobs` để ingest canonical schema metadata + rowCounts, classify scale theo tổng số dòng, và lưu import/generation jobs rõ ràng → Verify: một import job hoàn tất sẽ lưu được schema metadata, total row count, source scale, và trạng thái job.
- [x] Task 3: Sinh derived dataset templates bằng deterministic row-count scaling cho các scale nhỏ hơn; artifact là optional, worker sẽ dùng fallback synthetic load khi chưa có artifact → Verify: tiny/small/medium templates được tạo đúng thứ tự downscale và vẫn giữ shape/FK coverage cần thiết khi materialize.
- [x] Task 4: Nâng sandbox provisioning trong `services/worker/src/index.ts` và `services/worker/src/db.ts` để load dataset thật từ seed/import/artifact restore thay vì chỉ apply schema DDL → Verify: sandbox provision xong có row counts đúng với scale đã chọn, không còn bảng rỗng.
- [x] Task 5: Mở rộng session/database APIs để nhận requested scale, resolve đúng `datasetTemplateId`, và reject upscale cho cả lesson-based flow lẫn database explorer flow → Verify: request hợp lệ tạo session với dataset template đúng, request vượt source scale bị từ chối rõ ràng.
- [x] Task 6: Thêm flow đổi scale theo kiểu hard reprovision qua session/sandbox reset API để hủy sandbox hiện tại và tạo sandbox mới từ dataset đích → Verify: đổi từ large xuống medium/small/tiny tạo sandbox sạch với dataset mới và không còn residue từ scale cũ.
- [x] Task 7: Thay selector placeholder ở `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`, `apps/web/src/stores/lab.ts`, và `apps/web/src/lib/api.ts` bằng UI scale server-backed, chỉ hiện allowed scales, có cảnh báo reprovision, và phản ánh source scale hiện tại → Verify: UI chỉ cho chọn scale hợp lệ và hiển thị đúng trạng thái reprovision cho sandbox mới.
- [x] Task 8: Thêm admin visibility cho `system_jobs`, test tập trung cho import/provision/reprovision across API, worker, và web, rồi cập nhật docs/checklist → Verify: job progress xem được qua admin API, test happy-path/error-path pass, và docs/checklist phản ánh đúng implementation.

## Done When

- [x] Admin import được một canonical dataset qua API và nhìn thấy source scale + trạng thái import/generation job rõ ràng.
- [x] Derived dataset templates được tạo cho các scale nhỏ hơn hợp lệ; artifact restore dùng khi có artifact, synthetic fallback dùng khi chưa có artifact.
- [x] Learner launch và đổi scale được mà không có upscale hay live resize.
- [x] Mỗi sandbox provision/reprovision đều có dữ liệu thật, FK integrity đúng, và coverage đủ cho bài học.
- [x] Test trọng điểm cover được import, scale resolution, provision, và reprovision flow.

## Notes

- Assumption: scale được classify theo tổng số dòng toàn database.
- Assumption: medium/large nên ưu tiên provision từ prepared artifact; tiny/small có thể seed hoặc restore tùy cost thực tế.
- Assumption: canonical import trong V1 đi qua Admin API với schema definition + rowCounts; upload SQL dump/database snapshot full-fidelity vẫn là bước tiếp theo của super-admin tooling.
