import { describe, expect, it } from 'vitest'
import {
  parseSqlDump,
  type SqlDumpEvent,
  SqlDumpParser,
  type SqlInsertRowEvent,
  sqlText,
} from '../sources/sql-stream.js'
import { bytesDumpReader, stringDumpReader } from '../sources/types.js'

/** Feed a dump through the parser in fixed-size slices, mimicking a real read stream. */
const parseAll = (sql: string, chunkSize = Math.max(sql.length, 1)): SqlDumpEvent[] => {
  const parser = new SqlDumpParser()
  const events: SqlDumpEvent[] = []
  for (let at = 0; at < sql.length; at += chunkSize) {
    events.push(...parser.push(sql.slice(at, at + chunkSize)))
  }
  events.push(...parser.end())
  return events
}

const insertRows = (sql: string, chunkSize?: number): SqlInsertRowEvent[] =>
  parseAll(sql, chunkSize).filter((e): e is SqlInsertRowEvent => e.kind === 'insert-row')

const collectAsync = async (it: AsyncIterable<SqlDumpEvent>): Promise<SqlDumpEvent[]> => {
  const out: SqlDumpEvent[] = []
  for await (const event of it) out.push(event)
  return out
}

describe('string literals', () => {
  it('reads every MySQL escape mysqldump can emit', () => {
    const sql =
      'INSERT INTO `t` VALUES ' +
      String.raw`('a\'b','c\"d','e\\f','g\nh','i\rj','k\tl','m\0n','o\Zp','q\%r','s\_t','plain\qword');`
    const [row] = insertRows(sql)
    expect(row?.values.map(sqlText)).toEqual([
      "a'b",
      'c"d',
      'e\\f',
      'g\nh',
      'i\rj',
      'k\tl',
      'm\u0000n',
      'o\u001ap',
      // \% and \_ keep their backslash: they are the LIKE wildcards.
      'q\\%r',
      's\\_t',
      // Any other escaped character stands for itself.
      'plainqword',
    ])
  })

  it('reads doubled quotes, double-quoted strings and NULL', () => {
    const sql = `INSERT INTO \`t\` VALUES ('it''s here',"say ""what""",'',NULL);`
    const [row] = insertRows(sql)
    expect(row?.values.map(sqlText)).toEqual(["it's here", 'say "what"', '', null])
    expect(row?.values[3]).toEqual({ type: 'null' })
  })

  it('reads numbers, signed numbers, hex and binary literals', () => {
    const sql =
      "INSERT INTO `t` VALUES (42,-7,+3,3.125,1.5e-9,0x48656c6c6f,X'4d79',_binary 'raw',b'101');"
    const [row] = insertRows(sql)
    expect(row?.values.map(sqlText)).toEqual([
      '42',
      '-7',
      '3',
      '3.125',
      '1.5e-9',
      'Hello',
      'My',
      'raw',
      '5',
    ])
    expect(row?.values[5]).toEqual({ type: 'binary', value: new TextEncoder().encode('Hello') })
  })

  it('does not end the statement on a semicolon inside a string', () => {
    const sql = `INSERT INTO \`t\` VALUES ('a;b','c);d'),('e','f');`
    const rows = insertRows(sql)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.values.map(sqlText)).toEqual(['a;b', 'c);d'])
  })
})

describe('INSERT forms', () => {
  it('reads a multi-row extended insert', () => {
    const sql = "INSERT INTO `wp_terms` VALUES (1,'A','a',0),(2,'B','b',0),\n(3,'C','c',0);"
    const rows = insertRows(sql)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => sqlText(r.values[1]))).toEqual(['A', 'B', 'C'])
    expect(rows[0]?.columns).toBeNull()
  })

  it('reads the column-list form', () => {
    const sql =
      'INSERT INTO `wp_postmeta` (`meta_id`, `post_id`, `meta_key`, `meta_value`) VALUES ' +
      "(1,101,'manga_unique_id','mu-1'),(2,101,'_wp_manga_views','5');"
    const rows = insertRows(sql)
    expect(rows[0]?.columns).toEqual(['meta_id', 'post_id', 'meta_key', 'meta_value'])
    expect(rows).toHaveLength(2)
    expect(sqlText(rows[1]?.values[3])).toBe('5')
  })

  it('handles INSERT IGNORE, REPLACE and a schema-qualified table', () => {
    const sql = [
      "INSERT IGNORE INTO `wp`.`wp_terms` VALUES (1,'A','a',0);",
      "REPLACE INTO wp_terms VALUES (2,'B','b',0);",
    ].join('\n')
    const rows = insertRows(sql)
    expect(rows.map((r) => r.table)).toEqual(['wp_terms', 'wp_terms'])
  })

  it('ignores an INSERT … SELECT, which carries no literal tuples', () => {
    expect(insertRows('INSERT INTO `a` SELECT * FROM `b`;')).toHaveLength(0)
  })
})

describe('noise', () => {
  const noisy = [
    '-- MySQL dump 10.13  Distrib 8.0.36',
    '# a hash comment',
    '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
    "/*!40103 SET TIME_ZONE='+00:00' */;",
    '/* a plain block comment; with a semicolon */',
    'DROP TABLE IF EXISTS `wp_terms`;',
    'LOCK TABLES `wp_terms` WRITE;',
    '/*!40000 ALTER TABLE `wp_terms` DISABLE KEYS */;',
    'SET NAMES utf8mb4;',
    "INSERT INTO `wp_terms` VALUES (1,'A','a',0);",
    'UNLOCK TABLES;',
    'USE `wordpress`;',
  ].join('\n')

  it('skips comments, SET, LOCK/UNLOCK, DROP and ALTER, and still reads the insert', () => {
    const events = parseAll(noisy)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'insert-row', table: 'wp_terms' })
  })

  it('drops the contents of a conditional comment rather than executing it', () => {
    const sql = "/*!40000 INSERT INTO `wp_terms` VALUES (9,'X','x',0) */;"
    expect(insertRows(sql)).toHaveLength(0)
  })
})

describe('CREATE TABLE', () => {
  const create = [
    'CREATE TABLE `wp_posts` (',
    '  `ID` bigint unsigned NOT NULL AUTO_INCREMENT,',
    "  `post_author` bigint unsigned NOT NULL DEFAULT '0',",
    '  `post_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    "  `post_title` varchar(200) NOT NULL DEFAULT '',",
    '  rating decimal(10,3) DEFAULT NULL,',
    '  `wp_manga_search_text` text,',
    '  PRIMARY KEY (`ID`),',
    '  KEY `post_name` (`post_name`(191)),',
    '  UNIQUE KEY `guid` (`guid`),',
    '  FULLTEXT KEY `search` (`wp_manga_search_text`),',
    '  CONSTRAINT `fk` FOREIGN KEY (`post_author`) REFERENCES `wp_users` (`ID`)',
    ') ENGINE=InnoDB AUTO_INCREMENT=9100 DEFAULT CHARSET=utf8mb4;',
  ].join('\n')

  it('reads the declared column order and skips the key definitions', () => {
    const [event] = parseAll(create)
    expect(event).toEqual({
      kind: 'create-table',
      table: 'wp_posts',
      columns: ['ID', 'post_author', 'post_date', 'post_title', 'rating', 'wp_manga_search_text'],
    })
  })

  it('lower-cases the table name and reads `IF NOT EXISTS`', () => {
    const [event] = parseAll('CREATE TABLE IF NOT EXISTS `WP_Terms` (`term_id` bigint);')
    expect(event).toMatchObject({ table: 'wp_terms', columns: ['term_id'] })
  })
})

describe('wantTable', () => {
  it('drops rows for tables the caller does not want, without losing the next statement', () => {
    const parser = new SqlDumpParser({ wantTable: (t) => t === 'wp_terms' })
    const sql = [
      "INSERT INTO `wp_options` VALUES (1,'siteurl','https://x;y',';'),(2,'a','b','c');",
      "INSERT INTO `wp_terms` VALUES (1,'A','a',0);",
    ].join('\n')
    const events = [...parser.push(sql), ...parser.end()]
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ table: 'wp_terms' })
  })
})

describe('chunk boundaries', () => {
  // Every construct whose parse spans more than one character sits next to a boundary when
  // the dump arrives one byte at a time: this is the classic streaming bug.
  const sql = [
    '-- a line comment',
    '/*!40101 SET NAMES utf8mb4 */;',
    'CREATE TABLE `wp_terms` (',
    '  `term_id` bigint unsigned NOT NULL,',
    "  `name` varchar(200) NOT NULL DEFAULT '',",
    '  PRIMARY KEY (`term_id`)',
    ') ENGINE=InnoDB;',
    'LOCK TABLES `wp_terms` WRITE;',
    'INSERT INTO `wp_terms` VALUES ' +
      String.raw`(1,'it''s a \"quoted\" 잿빛 진혼곡'),(2,'line\none'),(3,0x4d79),(4,_binary 'møderator'),(5,NULL);`,
    'UNLOCK TABLES;',
  ].join('\n')

  it('produces identical events at every chunk size', () => {
    const whole = parseAll(sql)
    expect(whole).toHaveLength(6)
    for (const size of [1, 2, 3, 7, 13, 64, 1024]) {
      expect(parseAll(sql, size), `chunk size ${size}`).toEqual(whole)
    }
  })

  it('produces identical events for one-byte UTF-8 chunks as for one chunk', async () => {
    const oneShot = await collectAsync(parseSqlDump(stringDumpReader(sql).open()))
    const perByte = await collectAsync(parseSqlDump(bytesDumpReader(sql, { chunkSize: 1 }).open()))
    expect(perByte).toEqual(oneShot)
    // The multi-byte characters survived being split across chunk boundaries.
    const row = perByte.find(
      (e): e is SqlInsertRowEvent => e.kind === 'insert-row' && sqlText(e.values[0]) === '1',
    )
    expect(sqlText(row?.values[1])).toBe('it\'s a "quoted" 잿빛 진혼곡')
  })

  it('flushes a final statement that has no trailing semicolon', () => {
    const events = parseAll("INSERT INTO `t` VALUES (1,'a')", 1)
    expect(events).toHaveLength(1)
    expect((events[0] as SqlInsertRowEvent).values.map(sqlText)).toEqual(['1', 'a'])
  })
})
