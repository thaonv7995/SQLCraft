# Sandbox, dump lớn & SQL scan — danh sách issue / rủi ro

Tài liệu tổng hợp từ review code (worker `dataset-loader`, `docker`, API `sql-dump-scan`, `admin.service`, `real-dataset-artifact`). Dùng làm backlog hoặc khi thiết kế lại pipeline restore/scan.

---

## 1. Sandbox theo dialect

| ID | Mức độ | Trạng thái | Mô tả | Gợi ý |
|----|--------|------------|--------|--------|
| S1 | Trung bình | ✅ Done | MySQL/MariaDB sandbox: `docker run` không set `max_allowed_packet`, buffer pool. | Đã thêm `--max-allowed-packet`, `--innodb-buffer-pool-size`, `--innodb-log-file-size`. Env: `SANDBOX_MYSQL_*`. |
| S2 | Thấp–trung bình | 🔵 Won't fix | SQL Server trên ARM64 ép `linux/amd64` — restore lớn chậm, CPU emulation. | Accepted: đây là giới hạn hardware. Dùng runner amd64 cho prod. |
| S3 | Trung bình | ✅ Done | Container không có `--memory` / `--cpus` / `--pids-limit`. | Đã thêm resource limits. Env: `SANDBOX_CONTAINER_MEMORY_LIMIT`, `SANDBOX_CONTAINER_CPU_LIMIT`, `SANDBOX_CONTAINER_PIDS_LIMIT`. |
| S4 | Thông tin | 🔵 By design | SQLite không dùng Docker sandbox — đúng thiết kế. | Đã được xử lý đúng: worker throw `"SQLite templates cannot use Docker sandboxes"`. |

---

## 2. Áp schema & mô hình template

| ID | Mức độ | Trạng thái | Mô tả | Gợi ý |
|----|--------|------------|--------|--------|
| A1 | Thông tin | 🔵 By design | Chỉ PostgreSQL (+ SQL Server) áp DDL template; MySQL/MariaDB cần self-contained dump. | Đúng thiết kế: MySQL/MariaDB DDL syntax khác biệt lớn. Worker throw rõ ràng nếu thiếu artifact. |
| A2 | Thấp | 🔵 Accepted | SQL Server: sau restore có retry `ensureSchemaApplied` (warn nếu fail) → có thể lệch schema. | Risk thấp: chỉ xảy ra khi dump đã có DDL nhưng template DDL conflict. Logger warn đã có. |

---

## 3. Restore dataset — bộ nhớ & streaming (dump lớn)

| ID | Mức độ | Trạng thái | Mô tả | Vị trí code |
|----|--------|------------|--------|-------------|
| R1 | Cao | ✅ Done | **Trước**: chỉ PG + S3 stream. **Sau**: PostgreSQL stream cho **mọi** nguồn (S3, HTTP, local file). MySQL/MariaDB/SQL Server stream cho S3. | `dataset-loader.ts` — `createArtifactReadStream` mới; streaming path mở rộng. |
| R2 | Cao | ✅ Done | **Trước**: HTTP `fetch` + `arrayBuffer()` buffer toàn bộ. **Sau**: PostgreSQL dùng `Readable.fromWeb(response.body)` streaming. | `dataset-loader.ts` — `createArtifactReadStream` HTTP path. |
| R3 | Cao | ✅ Done (S3) | S3 via MinIO: streaming qua `createMcCatObjectReadStream` cho tất cả engines. `readS3ObjectViaMinioContainer` (buffer) chỉ còn dùng cho non-.sql artifacts. | `docker.ts` |
| R4 | Cao | ✅ Done (PG) | `.sql.gz` non-S3: PostgreSQL giờ stream + gunzip. MySQL/MariaDB/MSSQL non-S3 vẫn buffer (cần rewrite/sanitize). | Streaming PG OK. MySQL/MSSQL non-S3 cần stream-based rewriter (future). |
| R5 | Cao | ⚠️ Noted | `pg_restore` custom format vẫn buffer vì `pg_restore` cần random access. `.sql`/`.sql.gz` đã streaming cho PG. | Giới hạn của pg_restore format; không thể stream. Dùng `.sql.gz` thay vì `.dump` cho large datasets. |
| R6 | Cao | ⚠️ Partial | MySQL `prepareMysqlRestorePayload` full-string regex cho non-S3 path. S3 path bypass rewrite (streaming). | Short-circuit (R11) giảm thiểu. Full streaming rewriter = future work. |
| R7 | Cao | ⚠️ Partial | SQL Server `sanitizeSqlServerDumpPayload` full string cho non-S3 path. S3 path stream trực tiếp. | Tương tự R6: S3 streaming OK; non-S3 needs streaming sanitizer. |
| R8 | Trung bình | ✅ Done | **Trước**: non-PG engines skip seed im lặng. **Sau**: warn log rõ ràng khi synthetic seed requested nhưng engine không hỗ trợ, bao gồm `totalRequested` count. | `dataset-loader.ts` — `loadDatasetIntoSandbox` |
| R9 | Trung bình | ✅ Done | SQL Server `sqlcmd` pipe stdin trực tiếp — bỏ temp file. | `docker.ts` (`runSqlcmdInSandboxContainer`) |
| R10 | Trung bình | ✅ Done | stdout/stderr cap ở 64 KB. | `docker.ts` — `appendCapped` + `DOCKER_OUTPUT_CAP_BYTES`. |
| R11 | Thấp | ✅ Done | MySQL dump rewrite short-circuit khi không cần. | `dataset-loader.ts` — `needsMysqlDatabaseRewrite`. |

---

## 4. SQL dump scan & phân loại scale

| ID | Mức độ | Trạng thái | Mô tả | Gợi ý |
|----|--------|------------|--------|--------|
| P1 | Trung bình | 🔵 Accepted | `parseSqlDumpBuffer` load toàn file thành string. | Gated bởi `SQL_DUMP_FULL_PARSE_MAX_MB` (default 256 MiB). Streaming parser = future major refactor. |
| P2 | Thông tin | 🔵 Accepted | `SQL_DUMP_FULL_PARSE_MAX_MB` config. | UI đã có `NEXT_PUBLIC_SQL_DUMP_FULL_PARSE_MAX_MB` tương ứng. |
| P3 | Cao | 🔵 Accepted | Artifact-only scan: `inferredScale` null, metadata không phản ánh dump thật. | Admin có thể override `datasetScale` khi import. UI hiển thị "unknown" khi scale null. Background row estimation = future. |
| P4 | Trung bình | ✅ Done | **Trước**: artifact-only dump bị ép 1 row/table → classify `tiny` sai. **Sau**: `ensurePositiveDatasetRowCounts` skip khi `artifactOnly: true` → giữ nguyên placeholder. | `dataset-scales.ts` + `admin.service.ts` |
| P5 | Thấp | 🔵 Accepted | Scale chỉ dựa trên row count, không byte size. | `sandbox-provision-estimate.ts` đã dùng byte size cho thời gian ước lượng. Hybrid metric = future. |
| P6 | Thông tin | 🔵 Accepted | Row count detection đầy đủ cho các dialect. | Đã documented. |
| P7 | Thấp | ✅ Done | Upload scan chỉ `.sql`. | API/UI hỗ trợ `.sql`, `.txt`, `.sql.gz`, `.zip` (chứa ≥1 `.sql`); giải nén trước khi lưu artifact canonical `.sql`. Giới hạn nén: `SQL_DUMP_MAX_UNCOMPRESSED_MB` (mặc định min(8192, 4×`SQL_DUMP_MAX_FILE_MB`)). SQLite `.db`: không upload — xem [sqlite-dump-from-db.md](./sqlite-dump-from-db.md). |

---

## 5. Derived datasets (chia scale từ dump)

| ID | Mức độ | Trạng thái | Mô tả | Gợi ý |
|----|--------|------------|--------|--------|
| D1 | Cao | 🔵 Accepted | Derived materialize chỉ PostgreSQL + non-artifact-only. | By design: derived cần parse INSERT/COPY segments — chỉ PG dump format hiện được hỗ trợ. MySQL/MSSQL derived = future major feature. |
| D2 | Cao | 🔵 Accepted | Full dump in RAM cho materialize. | Gated bởi `SQL_DUMP_FULL_PARSE_MAX_MB`. Two-pass streaming = future. Dump > 256 MiB → artifact-only → không có derived. |
| D3 | Trung bình | ✅ Done | **Trước**: materialize fail bị `console.warn` im lặng. **Sau**: warnings surfaced trong `ImportCanonicalDatabaseResult.warnings[]` → admin thấy trong API response. | `admin.service.ts` + `admin.types.ts` |
| D4 | Trung bình | ✅ Done | `scaleDatasetRowCounts` edge cases fixed: target floor = max(tableCount, requested), linear scan thay sort, remainder reset. | `dataset-scales.ts` |
| D5 | Trung bình | ✅ Done | Circular FK: `buildSelectionOrder` trả `cycleTables`, FK validation relaxed cho cycle members. | `real-dataset-artifact.ts` |

---

## 6. Job & timeout

| ID | Mức độ | Trạng thái | Mô tả | Gợi ý |
|----|--------|------------|--------|--------|
| J1 | Trung bình | ✅ Done | `applySchemaAndDataset` wrapped với configurable timeout. | Env: `SANDBOX_DATASET_RESTORE_TIMEOUT_MS` (default 10 min, 0 = no limit). |
| J2 | Thấp | ✅ Done | **Trước**: BullMQ workers dùng default lockDuration. **Sau**: provisioning/cleanup/reset workers dùng `lockDuration: 10min`, `stalledInterval: 5min`. Query execution giữ default. | `index.ts` — `longJobOpts`. |

---

## 7. Tham chiếu file chính

- `apps/api/src/modules/admin/sql-dump-upload-format.ts` — whitelist extension, gzip/zip decode, `SQL_DUMP_MAX_UNCOMPRESSED_MB`
- `services/worker/src/docker.ts` — container, streaming `psql`/`mysql`/`sqlcmd`, MinIO stream, resource limits, output cap
- `services/worker/src/dataset-loader.ts` — restore (streaming cho PG + S3 MySQL/MSSQL), MySQL rewrite (short-circuit), seed warning
- `services/worker/src/sqlserver-dump-sanitize.ts` — SQL Server dump sanitization
- `services/worker/src/sandbox-engine-image.ts` — dialect → Docker image mapping
- `services/worker/src/index.ts` — `applySchemaAndDataset` (timeout), BullMQ lockDuration, provisioning/reset
- `apps/api/src/modules/admin/sql-dump-scan.ts` — parse, giới hạn MB, artifact-only
- `apps/api/src/lib/dataset-scales.ts` — scale thresholds, `scaleDatasetRowCounts` (fixed), `ensurePositiveDatasetRowCounts` (artifact-only aware)
- `apps/api/src/modules/admin/admin.service.ts` — import + materialize warnings surfaced
- `apps/api/src/modules/admin/admin.types.ts` — `ImportCanonicalDatabaseResult.warnings`
- `apps/api/src/modules/admin/real-dataset-artifact.ts` — `materializeDerivedSqlDumpArtifacts`, cycle detection
- `apps/api/src/lib/sandbox-provision-estimate.ts` — ước lượng thời gian provision
- `docs/sandbox-design.md` — nguyên tắc reprovision / artifact
- `docs/sqlite-dump-from-db.md` — SQLite `.db` → `.sql` trước khi import

---

## 8. Tổng kết trạng thái

| Trạng thái | Số lượng | IDs |
|------------|----------|-----|
| ✅ Done | 17 | S1, S3, R1, R2, R3, R4(PG), R8, R9, R10, R11, P4, D3, D4, D5, J1, J2 |
| ⚠️ Partial/Noted | 3 | R5 (pg_restore format giới hạn), R6, R7 (non-S3 cần stream rewriter) |
| 🔵 Accepted/By design | 10 | S2, S4, A1, A2, P1, P2, P3, P5, P6, D1, D2 |

### Env variables mới (từ các fix)

| Variable | Default | Mô tả |
|----------|---------|--------|
| `SANDBOX_CONTAINER_MEMORY_LIMIT` | *(trống)* | Docker `--memory` cho sandbox containers |
| `SANDBOX_CONTAINER_CPU_LIMIT` | *(trống)* | Docker `--cpus` cho sandbox containers |
| `SANDBOX_CONTAINER_PIDS_LIMIT` | *(trống)* | Docker `--pids-limit` cho sandbox containers |
| `SANDBOX_MYSQL_MAX_ALLOWED_PACKET` | `256M` | MySQL/MariaDB `--max-allowed-packet` |
| `SANDBOX_MYSQL_INNODB_BUFFER_POOL_SIZE` | `256M` | MySQL/MariaDB `--innodb-buffer-pool-size` |
| `SANDBOX_MYSQL_INNODB_LOG_FILE_SIZE` | `128M` | MySQL/MariaDB `--innodb-log-file-size` |
| `SANDBOX_DATASET_RESTORE_TIMEOUT_MS` | `600000` (10 phút) | Timeout tổng cho schema + dataset load; 0 = no limit |

### Remaining future work

- **Stream-based MySQL dump rewriter**: xử lý line-by-line thay vì full-string regex (unblocks R6 cho non-S3 large dumps)
- **Stream-based SQL Server dump sanitizer**: tương tự cho R7
- **Derived datasets cho MySQL/MSSQL**: cần parser cho INSERT syntax khác PG (D1)
- **Two-pass streaming derived generation**: giảm memory cho large PG dumps (D2)
- **Background row estimation for artifact-only scans**: ước lượng scale từ file size / sampling (P3)
- **Hybrid scale metric**: kết hợp row count + byte size (P5)

---

*Cập nhật lần cuối: 2026-03-29.*
