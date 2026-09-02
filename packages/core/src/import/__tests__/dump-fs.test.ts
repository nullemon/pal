import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LEGACY_DUMP_DATA_PREFIX, legacyDumpSql } from '../__fixtures__/legacy-dump.js'
import { defaultImportSetting } from '../config.js'
import { collect } from '../source.js'
import { createDumpSource } from '../sources/dump.js'
import {
  createDumpSourceFromSetting,
  directoryUploadsReader,
  fileDumpReader,
} from '../sources/fs.js'
import { stringDumpReader } from '../sources/types.js'

const sql = legacyDumpSql()
let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'palscans-dump-'))
  await writeFile(path.join(dir, 'wordpress.sql'), sql, 'utf8')
  await writeFile(path.join(dir, 'wordpress.sql.gz'), gzipSync(Buffer.from(sql, 'utf8')))
  await mkdir(path.join(dir, 'uploads', 'manga', '5001'), { recursive: true })
})

afterAll(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true })
})

const titles = async (reader: Parameters<typeof createDumpSource>[0]['reader']) => {
  const source = createDumpSource({
    reader,
    dataPathPrefix: LEGACY_DUMP_DATA_PREFIX,
    uploads: null,
  })
  return (await collect(source.listSeries())).map((s) => s.title)
}

describe('fileDumpReader', () => {
  it('reads a dump off disk', async () => {
    const fromFile = await titles(fileDumpReader(path.join(dir, 'wordpress.sql')))
    const fromString = await titles(stringDumpReader(sql))
    expect(fromFile).toEqual(fromString)
    expect(fromFile).toContain('Ashfall Requiem')
  })

  it('gunzips a `.sql.gz` dump', async () => {
    expect(await titles(fileDumpReader(path.join(dir, 'wordpress.sql.gz')))).toContain(
      'Ashfall Requiem',
    )
  })

  it('names itself after the file', () => {
    expect(fileDumpReader('/srv/backups/wordpress.sql.gz').name).toBe('wordpress.sql.gz')
  })

  it('surfaces a missing file rather than hanging', async () => {
    await expect(titles(fileDumpReader(path.join(dir, 'nope.sql.gz')))).rejects.toThrow()
    await expect(titles(fileDumpReader(path.join(dir, 'nope.sql')))).rejects.toThrow()
  })
})

describe('directoryUploadsReader', () => {
  it('reads a page and refuses one that escapes the root', async () => {
    const uploadsRoot = path.join(dir, 'uploads')
    await writeFile(path.join(dir, 'secret.txt'), 'not yours', 'utf8')
    await writeFile(path.join(uploadsRoot, 'manga', '5001', '01.jpg'), 'jpeg-bytes', 'utf8')

    const reader = directoryUploadsReader(uploadsRoot)
    expect(Buffer.from(await reader.read('manga/5001/01.jpg')).toString()).toBe('jpeg-bytes')
    await expect(reader.read('../secret.txt')).rejects.toMatchObject({
      name: 'LegacyPageUnavailableError',
      reason: 'not-found',
    })
    await expect(reader.read('manga/5001/missing.jpg')).rejects.toMatchObject({
      reason: 'not-found',
    })
  })
})

describe('createDumpSourceFromSetting', () => {
  it('builds a working adapter from the stored operator settings', async () => {
    const source = createDumpSourceFromSetting(
      {
        ...defaultImportSetting(),
        mode: 'dump',
        dumpPath: path.join(dir, 'wordpress.sql'),
        uploadsMode: 'path',
        uploadsPath: path.join(dir, 'uploads'),
      },
      { dataPathPrefix: LEGACY_DUMP_DATA_PREFIX },
    )
    expect(source.name).toBe('wordpress.sql (mysqldump, prefix wp_)')
    const chapters = await collect(source.listChapters(101))
    const page = chapters[0]?.pages[0]
    if (page === undefined) throw new Error('fixture missing')
    expect(page.path).toBe('wp-content/uploads/manga/5001/01.jpg')
  })

  it('leaves images unconfigured for a catalogue-only run', async () => {
    const source = createDumpSourceFromSetting({
      ...defaultImportSetting(),
      mode: 'dump',
      dumpPath: path.join(dir, 'wordpress.sql'),
      uploadsPath: path.join(dir, 'uploads'),
      skipImages: true,
    })
    await expect(
      source.readPage({ idx: 1, path: 'manga/5001/01.jpg', attachmentId: null }),
    ).rejects.toMatchObject({ reason: 'uploads-not-configured' })
  })

  it('refuses to build without a dump path', () => {
    expect(() => createDumpSourceFromSetting({ ...defaultImportSetting(), mode: 'dump' })).toThrow(
      /No SQL dump/,
    )
  })
})
