import {
  ClickHouseClient,
  ClickHouseCompressionMethod,
  ClickHouseDataFormat,
} from '../src';
import * as http from 'http';
import { AddressInfo } from 'net';
import { Readable } from 'stream';

type BasicQueryResult = {
  num: number
}

describe('ClickHouseClient (e2e)', () => {
  const portEnv = process.env.CLICKHOUSE_PORT;
  const baseOptions = {
    host: process.env.CLICKHOUSE_HOST || '127.0.0.1',
    port: portEnv ? Number(portEnv) : 8123,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || process.env.CLICKHOUSE_DB || 'default',
  };
  const client = new ClickHouseClient(baseOptions);
  const idSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const csvTable = `ch_client_csv_${idSuffix}`;
  const csvStreamTable = `ch_client_csv_stream_${idSuffix}`;
  const jsonTable = `ch_client_json_${idSuffix}`;
  const jsonEachRowTable = `ch_client_json_eachrow_${idSuffix}`;

  const expectJsonResults = <T>(results: string | T[]): T[] => {
    if (typeof results === 'string') {
      throw new Error('Expected JSON response');
    }
    return results;
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  beforeAll(async () => {
    await client.queryPromise(`DROP TABLE IF EXISTS ${csvTable}`);
    await client.queryPromise(
      `CREATE TABLE ${csvTable} (id UInt32, name String) ENGINE = MergeTree ORDER BY id`
    );

    await client.queryPromise(`DROP TABLE IF EXISTS ${csvStreamTable}`);
    await client.queryPromise(
      `CREATE TABLE ${csvStreamTable} (id UInt32, name String) ENGINE = MergeTree ORDER BY id`
    );

    await client.queryPromise(`DROP TABLE IF EXISTS ${jsonTable}`);
    await client.queryPromise(
      `CREATE TABLE ${jsonTable} (message_raw String) ENGINE = MergeTree ORDER BY tuple()`
    );

    await client.queryPromise(`DROP TABLE IF EXISTS ${jsonEachRowTable}`);
    await client.queryPromise(
      `CREATE TABLE ${jsonEachRowTable} (id UInt32, name String) ENGINE = MergeTree ORDER BY id`
    );
  });

  afterAll(async () => {
    await client.queryPromise(`DROP TABLE IF EXISTS ${csvTable}`);
    await client.queryPromise(`DROP TABLE IF EXISTS ${csvStreamTable}`);
    await client.queryPromise(`DROP TABLE IF EXISTS ${jsonTable}`);
    await client.queryPromise(`DROP TABLE IF EXISTS ${jsonEachRowTable}`);
  });

  test('Smoke test', async () => {
    // Arrange

    // Act
    const alive = await client.ping();

    // Assert
    expect(alive).toBe(true);
  });

  test('Query without params', async () => {
    // Arrange
    const num = 1

    // Act
    const results = expectJsonResults(
      await client.queryPromise<BasicQueryResult>(`SELECT ${num} as num`)
    );
    const [result] = results;

    // Assert
    expect(result).toBeDefined();
    expect(result.num).toStrictEqual(num);
  });

  test('Query with params', async () => {
    // Arrange
    const param = 7

    // Act
    const results = expectJsonResults(
      await client.queryPromise<BasicQueryResult>(
        'SELECT {param:UInt8} as num',
        { param }
      )
    );
    const [result] = results;

    // Assert
    expect(result).toBeDefined();
    expect(result.num).toStrictEqual(param);
  });

  test('Insert raw CSV', async () => {
    const payload = '1,test\n2,hello\n';
    await client.insertRawPromise(csvTable, payload, ClickHouseDataFormat.CSV);

    const results = expectJsonResults(
      await client.queryPromise<{ id: number; name: string }>(
        `SELECT id, name FROM ${csvTable} ORDER BY id`
      )
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toStrictEqual({ id: 1, name: 'test' });
    expect(results[1]).toStrictEqual({ id: 2, name: 'hello' });
  });

  test('Insert raw CSV (Readable)', async () => {
    const payload = Readable.from(['3,world\n4,hey\n']);
    await client.insertRawPromise(csvStreamTable, payload, ClickHouseDataFormat.CSV);

    const results = expectJsonResults(
      await client.queryPromise<{ id: number; name: string }>(
        `SELECT id, name FROM ${csvStreamTable} ORDER BY id`
      )
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toStrictEqual({ id: 3, name: 'world' });
    expect(results[1]).toStrictEqual({ id: 4, name: 'hey' });
  });

  test('Insert raw JSONAsString', async () => {
    const payload = '{"source":"test","uid":"test"}\n';
    await client.insertRawPromise(jsonTable, payload, ClickHouseDataFormat.JSONAsString);

    const results = expectJsonResults(
      await client.queryPromise<{ message_raw: string }>(
        `SELECT message_raw FROM ${jsonTable} LIMIT 1`
      )
    );

    const parsed = JSON.parse(results[0].message_raw);
    expect(parsed).toStrictEqual({ source: 'test', uid: 'test' });
  });

  test('Insert JSONEachRow via insertPromise', async () => {
    await client.insertPromise(jsonEachRowTable, [
      { id: 10, name: 'alpha' },
      { id: 11, name: 'beta' },
    ]);

    const results = expectJsonResults(
      await client.queryPromise<{ id: number; name: string }>(
        `SELECT id, name FROM ${jsonEachRowTable} ORDER BY id`
      )
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toStrictEqual({ id: 10, name: 'alpha' });
    expect(results[1]).toStrictEqual({ id: 11, name: 'beta' });
  });

  test('Query with explicit format returns raw string', async () => {
    const result = await client.queryPromise('SELECT 1 FORMAT TSV');
    expect(typeof result).toBe('string');
    expect(result).toContain('1');
  });

  test('Observable query streams rows', async () => {
    const num = 42;
    const rows: BasicQueryResult[] = [];

    await new Promise<void>((resolve, reject) => {
      client.query<BasicQueryResult>(`SELECT ${num} as num`).subscribe({
        next: (row) => {
          rows.push(row as BasicQueryResult);
        },
        error: reject,
        complete: resolve,
      });
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].num).toStrictEqual(num);
  });

  test('Non-select statements do not append FORMAT', async () => {
    const ddlTable = `ch_client_ddl_${idSuffix}`;

    await client.queryPromise(`DROP TABLE IF EXISTS ${ddlTable}`);
    await client.queryPromise(
      `CREATE TABLE ${ddlTable} (id UInt32) ENGINE = MergeTree ORDER BY id`
    );
    await client.queryPromise(`ALTER TABLE ${ddlTable} DELETE WHERE id = 1`);

    await client.queryPromise(`DROP TABLE IF EXISTS ${ddlTable}`);
  });

  test('Query with explicit format bypasses JSON parsing', async () => {
    const result = await client.queryPromise('SELECT 1 FORMAT TSVRaw');
    expect(typeof result).toBe('string');
    expect(result).toContain('1');
  });

  test('QueryPromise surfaces invalid SQL errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(client.queryPromise('SELECT BROKEN SQL')).rejects.toBeDefined();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('QueryPromise works with gzip compression', async () => {
    const gzipClient = new ClickHouseClient({
      ...baseOptions,
      httpConfig: {
        compression: ClickHouseCompressionMethod.GZIP,
      },
    });

    const results = expectJsonResults(
      await gzipClient.queryPromise<BasicQueryResult>('SELECT 1 as num')
    );

    expect(results[0].num).toStrictEqual(1);
  });

  test('QueryPromise works with brotli compression when supported', async () => {
    const brotliClient = new ClickHouseClient({
      ...baseOptions,
      httpConfig: {
        compression: ClickHouseCompressionMethod.BROTLI,
      },
    });

    try {
      const results = expectJsonResults(
        await brotliClient.queryPromise<BasicQueryResult>('SELECT 1 as num')
      );

      expect(results[0].num).toStrictEqual(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Brotli') ||
        message.includes('brotli') ||
        message.includes('Unsupported') ||
        message.includes('not supported')
      ) {
        return;
      }
      throw error;
    }
  });

  test('Settings are sent via query params', async () => {
    const receivedParams: Record<string, string> = {};
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      for (const [key, value] of url.searchParams.entries()) {
        receivedParams[key] = value;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ ok: 1 }] }));
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    const settingsClient = new ClickHouseClient({
      ...baseOptions,
      host: '127.0.0.1',
      port: address.port,
      settings: {
        wait_end_of_query: 0,
        buffer_size: 1,
        send_progress_in_http_headers: 1,
      },
    });

    try {
      await settingsClient.queryPromise('SELECT 1');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    expect(receivedParams.wait_end_of_query).toStrictEqual('0');
    expect(receivedParams.buffer_size).toStrictEqual('1');
    expect(receivedParams.send_progress_in_http_headers).toStrictEqual('1');
  });

  test('Unsubscribe aborts long-running observable query', async () => {
    const abortErrors: unknown[] = [];
    const abortClient = new ClickHouseClient({
      ...baseOptions,
      logger: {
        ...console,
        error: (err: unknown) => {
          abortErrors.push(err);
        },
      } as Console,
    });

    const subscription = abortClient
      .query('SELECT sleep(2)')
      .subscribe({ error: () => {}, complete: () => {} });

    await sleep(50);
    subscription.unsubscribe();

    const isCanceled = (err: unknown) => {
      if (!err) {
        return false;
      }
      if (typeof err === 'string') {
        return err.includes('canceled') || err.includes('ERR_CANCELED');
      }
      if (typeof err === 'object') {
        const code = (err as { code?: string }).code;
        const message = (err as { message?: string }).message;
        return code === 'ERR_CANCELED' || message === 'canceled';
      }
      return false;
    };

    for (let i = 0; i < 10; i += 1) {
      if (abortErrors.some(isCanceled)) {
        break;
      }
      await sleep(50);
    }

    expect(abortErrors.some(isCanceled)).toBe(true);
  });

  test('Insert raw CSV surfaces errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        client.insertRawPromise(csvTable, 'bad,rows\n', ClickHouseDataFormat.CSV)
      ).rejects.toBeDefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
