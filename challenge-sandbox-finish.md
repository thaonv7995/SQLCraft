# Challenge And Sandbox Finish

## Goal
Hoàn thiện các mục challenge engine và sandbox isolation còn thiếu để checklist khớp với hành vi thực tế của hệ thống.

## Tasks
- [x] Thêm test đỏ cho `submitAttempt` để buộc so khớp full result-set với đáp án chuẩn và reject khi rows/values lệch. → Verify: `pnpm --filter @sqlcraft/api test -- src/modules/challenges/__tests__/challenges.service.test.ts`
- [x] Implement result-set validator dùng query chuẩn/reference solution trên đúng sandbox của session. → Verify: test challenge service pass và feedback phân biệt đúng/sai rõ ràng
- [x] Nâng scoring tối ưu query/index từ heuristic sang evidence-based bằng EXPLAIN/plan summary trên base query của attempt. → Verify: test challenge service cover performance/index branches
- [x] Mở runtime sandbox để dùng `container_ref` như internal host cho từng session container. → Verify: `pnpm --filter @sqlcraft/worker typecheck`
- [x] Chuyển worker provision/reset/cleanup/query execution sang per-session PostgreSQL container thay vì shared DB trong một container chung. → Verify: worker typecheck pass và code path không còn hardcode `sandbox-postgres`
- [x] Cập nhật contributor/admin input và docs/checklist để phản ánh validator/scoring/sandbox behavior mới. → Verify: `docs/feature-list.md` và README khớp implementation
- [ ] Chạy verification cuối cho API/worker tests + typecheck các package bị chạm. → Verify: lệnh test/typecheck hoàn tất xanh

## Done When
- [x] Challenge result-set được chấm bằng so sánh dữ liệu thật, không chỉ check cột
- [x] Challenge optimization scoring dựa trên plan/performance thay vì chỉ dò `CREATE INDEX`
- [x] Mỗi learning session có sandbox PostgreSQL container riêng và cleanup đầy đủ
