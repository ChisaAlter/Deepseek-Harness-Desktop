# Agent Note: Persistence compression latency and SQLite page size

Status: implemented

English | [中文](2026-08-25-persistence-latency-and-page-size.zh.md)

## Problem

The physical persistence optimizations need to reduce retained storage without moving disproportionate work into full writes, reads, or session forks. The original 105-session corpus showed that JSONL level-19 compression made full writes and forks more than twice as slow. The earlier SQLite page-size experiment predated shared-dictionary row compression and showed negligible savings, so it did not establish the best page size for the current row distribution.

The decision needs evidence from more varied sessions, including long event streams and payloads outside the original corpus. The expanded corpus contains 501 real sessions, 16,153,332 logical events, and 2,002,145,570 bytes of serialized event data.

## Decision

### Storage encoding stays physical and independently decodable

JSONL stores strictly increasing `sourceEventSeqs` as mixed scalar values and inclusive ranges; other orders remain verbatim. SQLite stores the same arrays as tagged zigzag-delta or `(start, count)` varints, choosing the smaller encoding. Both readers restore the original `number[]` before exposing an event.

SQLite uses an internal integer `sessions.id` and keeps the public session id once in `sessions.session_key`, so event rows and their primary key do not repeat a text identifier. Each `events.data` value remains independently decodable: the writer tries level-3 Zstandard with the packaged 64 KiB raw-content dictionary and retains SQLite text when compression is not smaller. The dictionary bytes are part of schema 20 and a test pins their SHA-256 digest; replacing them requires another schema-version bump.

### JSONL uses the standard Zstandard level

The JSONL writer keeps one checksummed Zstandard frame per durable append batch but uses the compressor's standard level. Lossless `sourceEventSeqs` range encoding remains active. Frames stay independently decodable for suffix reads and torn-tail recovery; only the expensive level-19 search is removed.

### New SQLite databases use 64 KiB pages

The SQLite provider sets `page_size=65536` before initializing a pristine schema-20 database. An established schema-20 database retains its current page size because SQLite ignores the pragma after allocation.

The page size is part of schema 20's fixed physical layout and is applied through the package's closed SQL resources like the other fixed SQLite pragmas.

### Expanded benchmark

Each candidate was rebuilt five times from the same 501-session corpus with 512-event append batches. Their order rotates between rounds so every candidate occupies each run position once. Each build runs three complete and suffix-read sweeps. For each displayed metric, the highest and lowest build are discarded and the remaining three values are averaged. Complete and suffix read times cover one sweep over all sessions, and fork time covers all 501 sessions.

| Backend | Stored size | Full write | Full read | Suffix read | Fork |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSONL `master` | 172.43 MB | 200.902 s | 8.033 s | 24.479 s | 72.670 s |
| JSONL with provenance ranges | 148.15 MB (-14.1%) | 197.281 s (-1.8%) | 7.799 s (-2.9%) | 24.582 s (+0.4%) | 72.308 s (-0.5%) |
| JSONL with provenance ranges and level 19 | 130.22 MB (-24.5%) | 329.442 s (+64.0%) | 7.764 s (-3.3%) | 24.454 s (-0.1%) | 166.177 s (+128.7%) |
| SQLite `master` (schema 17) | 438.31 MB | 69.632 s | 8.211 s | 0.546 s | 64.290 s |
| SQLite with all physical optimizations and 64 KiB pages | 233.18 MB (-46.8%) | 87.656 s (+25.9%) | 9.155 s (+11.5%) | 0.575 s (+5.3%) | 79.417 s (+23.5%) |

Relative to standard-level frames with provenance ranges, level 19 saves another 12.1% of the JSONL bytes but increases full-write time by 67.0% and fork time by 129.8%. Its complete and suffix reads change by -0.4% and -0.5%. The extra search therefore benefits retained size without improving the latency-sensitive operations enough to offset its repeated encoding cost.

An otherwise identical SQLite build isolates the page-size effect: 4 KiB pages use 256.97 MB and 64 KiB pages use 233.18 MB (-9.26%). The `events` table's unused page bytes fall from 30.25 MB to 6.95 MB, while the index changes from 5.92 MB to 6.03 MB. In the paired run, full write, full read, and suffix read change by -0.5%, -0.4%, and -3.8%; fork changes by -14.8%. The space gain therefore comes from better large-row page utilization rather than a smaller index or omitted data, without a measured latency regression.

## Alternatives considered

**Keep JSONL level 19.** Rejected. On the expanded corpus it saves another 12.1% relative to default-level frames but increases full-write time by 67.0% and fork time by 129.8%, while complete and suffix reads differ by less than 1%. Default-level frames plus provenance ranges retain a 14.1% size reduction relative to master without a material latency regression.

**Compress one whole JSONL log as a single frame.** Rejected. It improves cross-batch compression but makes suffix reads decompress from the start and removes batch-local torn-tail recovery.

**Keep 4 KiB SQLite pages.** Rejected for pristine databases. The current compressed-row distribution retains 9.26% more bytes because large compressed records leave more unusable space across 4 KiB B-tree pages. Existing databases keep their page size to avoid a historical rewrite.

**Remove ROWID from `events`.** Rejected. The composite primary key becomes the table B-tree key and repeats through internal pages; the 105-session comparison produced a larger database than ordinary ROWID tables.

**Deduplicate event content.** Rejected. Message restatements and tool arguments can be reconstructed only under assumptions that compaction, retries, and pruning may invalidate. Physical compression preserves every event without adding reconstruction semantics.

**Use per-session SQLite files or DuckDB.** Rejected for the hot store. Per-session files lose cross-session queries, while DuckDB's OLAP write model fits cold batch analysis rather than durable append batches and low-latency suffix reads.

## Consequences

JSONL keeps the low-cost provenance optimization without the level-19 write and fork penalty. SQLite exchanges approximately 5–26% more time across the measured operations for a 46.8% retained-size reduction; its full write remains materially faster than JSONL, and its suffix read remains much faster. Its complete read and fork are slightly slower than default-level JSONL on this expanded corpus.

New SQLite databases use 64 KiB WAL frames and cache pages. Small databases may reserve more bytes for sparsely populated schema and metadata pages, while the measured multi-session workload gains substantially better `events` page utilization. Schema 20 rejects every other schema version rather than migrating it.

## Related

- [sqlite-physical-chunk-row-compression](2026-08-18-sqlite-physical-chunk-row-compression.md) — owns the packed row model; its earlier page-size conclusion applies to the pre-dictionary layout.
- [zstandard-jsonl-session-logs](2026-07-19-zstandard-jsonl-session-logs.md) — owns the checksummed frame-per-batch container and the standard compressor-level policy restored here.
