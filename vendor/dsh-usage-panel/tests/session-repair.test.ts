// Locks the session-log repair: decoding (packed rows expand), 0-based
// continuous renumbering, plain-event rewrite (layout-blind for the reader),
// backup + atomic replace, and artifact discovery. Uses the REAL node:zlib
// zstd codec with an injectable storage-row decoder so the harness codec
// stays out of the unit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compressZstdFrame, decompressZstdFrame, scanZstdFrames } from '../src/host/zstd-frames.ts'
import { locateSessionArtifact, rebuildSessionLog, repairSessionLog } from '../src/host/session-repair.ts'

/** Fake storage rows: `{seq: n}` = single event; `{packed: [seqs]}` = packed run. */
function fakeDecode(value: unknown): unknown[] {
  const row = value as { seq?: number; packed?: number[] }
  if (row.packed !== undefined) return row.packed.map((seq) => ({ seq }))
  return [{ seq: row.seq }]
}

const HEADER = JSON.stringify({ type: 'session', version: 0, id: 'session-x' })

async function bytesOf(text: string): Promise<Buffer> {
  const lines = text.split('\n')
  const header = lines[0]!
  const body = lines.slice(1).join('\n')
  const headerFrame = await compressZstdFrame(header + '\n')
  const bodyFrame = await compressZstdFrame(body + (body === '' ? '' : '\n'))
  return Buffer.concat([headerFrame, bodyFrame])
}

/** Decode a rebuilt stream back into per-line event seq lists. */
async function decodeStream(buf: Buffer): Promise<number[]> {
  const { frames } = scanZstdFrames(buf)
  let plain = ''
  for (const f of frames) plain += (await decompressZstdFrame(buf.subarray(f.start, f.end))).toString('utf8')
  const seqs: number[] = []
  for (const line of plain.split('\n').slice(1)) {
    if (!line.trim()) continue
    for (const ev of fakeDecode(JSON.parse(line))) seqs.push(ev.seq)
  }
  return seqs
}

test('scanZstdFrames locates frames and roundtrips through node:zlib', async () => {
  const text = HEADER + '\n{"seq":0}\n{"seq":1}\n'
  const bytes = await bytesOf(text)
  const { frames, tornStart } = scanZstdFrames(bytes)
  assert.equal(frames.length, 2)
  assert.equal(tornStart, undefined)
  assert.equal((await decompressZstdFrame(bytes.subarray(frames[0]!.start, frames[0]!.end))).toString(), HEADER + '\n')
})

test('rebuildSessionLog renumbers 0-based continuous across a duplicated batch', async () => {
  // Header + events 0..3 followed by a REPEATED 1..3 (the seq-gap shape).
  const text = HEADER + '\n' + [0, 1, 2, 3, 1, 2, 3].map((seq) => JSON.stringify({ seq })).join('\n') + '\n'
  const bytes = await bytesOf(text)
  const rebuilt = await rebuildSessionLog(bytes, fakeDecode)
  assert.equal(rebuilt.events, 7)
  assert.deepEqual(await decodeStream(rebuilt.rebuilt), [0, 1, 2, 3, 4, 5, 6])
})

test('packed rows expand before renumbering (chunk runs stay lossless)', async () => {
  const text = HEADER + '\n{"packed":[0,1,2]}\n{"seq":3}\n'
  const bytes = await bytesOf(text)
  const rebuilt = await rebuildSessionLog(bytes, fakeDecode)
  assert.equal(rebuilt.events, 4)
  assert.deepEqual(await decodeStream(rebuilt.rebuilt), [0, 1, 2, 3])
})

test('a JSONL record split ACROSS zstd frames reassembles (torn-frame class)', async () => {
  // Frame 1: header + first event; frame 2 START cut mid-record: the second
  // record's JSON continues in the next frame. The reader rejects this, but
  // the repair concatenates frames first, so the record reconstructs.
  const record1 = JSON.stringify({ seq: 0 })
  const record2 = JSON.stringify({ seq: 1 })
  const record3 = JSON.stringify({ seq: 2 })
  const cut = 6 // split record2 mid-JSON
  const plain = HEADER + '\n' + record1 + '\n' + record2 + '\n' + record3 + '\n'
  const frame1 = await compressZstdFrame(plain.slice(0, plain.indexOf(record2) + cut))
  const frame2 = await compressZstdFrame(plain.slice(plain.indexOf(record2) + cut))
  const bytes = Buffer.concat([frame1, frame2])
  const { frames } = scanZstdFrames(bytes)
  assert.equal(frames.length, 2)
  const rebuilt = await rebuildSessionLog(bytes, fakeDecode)
  assert.equal(rebuilt.events, 3)
  assert.deepEqual(await decodeStream(rebuilt.rebuilt), [0, 1, 2])
})

test('an unterminated FINAL record is dropped as a torn tail (blocked class)', async () => {
  // The last record lacks its trailing newline (interrupted write). The
  // scanner tolerates this by keeping only the committed prefix; the repair
  // must mirror it instead of aborting.
  const body = JSON.stringify({ seq: 0 }) + '\n' + JSON.stringify({ seq: 1 })
  const bytes = Buffer.concat([await compressZstdFrame(HEADER + '\n'), await compressZstdFrame(body)])
  const rebuilt = await rebuildSessionLog(bytes, fakeDecode)
  assert.equal(rebuilt.events, 1)
  assert.deepEqual(await decodeStream(rebuilt.rebuilt), [0])
})

test('repairSessionLog backs up and atomically replaces the artifact', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-repair-'))
  const project = join(home, 'sessions', '--proj-1--')
  const dir = join(project, 'session-x')
  await mkdir(dir, { recursive: true })
  const text = HEADER + '\n' + [0, 1, 2, 1, 2].map((seq) => JSON.stringify({ seq })).join('\n') + '\n'
  const artifact = join(dir, 'session.jsonl.zstd')
  await writeFile(artifact, await bytesOf(text))
  assert.equal(await locateSessionArtifact(home, 'x'), artifact)
  assert.equal(await locateSessionArtifact(home, 'session-x'), artifact)

  const outcome = await repairSessionLog(home, 'x', fakeDecode)
  assert.equal(outcome.repaired, 5)
  const original = await readFile(outcome.backup)
  const repaired = await readFile(artifact)
  assert.ok(original.length > 0)
  assert.deepEqual(await decodeStream(repaired), [0, 1, 2, 3, 4])
  await rm(home, { recursive: true, force: true })
})

test('repairSessionLog rejects missing artifacts and never writes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-repair-'))
  await assert.rejects(() => repairSessionLog(home, 'nope', fakeDecode), /artifact not found/)
  await rm(home, { recursive: true, force: true })
})

test('rebuildSessionLog aborts on an unparsable committed line', async () => {
  const text = HEADER + '\nnot-json\n'
  const bytes = await bytesOf(text)
  await assert.rejects(() => rebuildSessionLog(bytes, fakeDecode), /unparsable/)
})
