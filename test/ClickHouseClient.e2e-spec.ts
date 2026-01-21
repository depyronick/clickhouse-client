import { ClickHouseClient } from '../src';

type BasicQueryResult = {
  num: number
}

describe('ClickHouseClient (e2e)', () => {
  const client = new ClickHouseClient({});

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
    const results = await client.queryPromise<BasicQueryResult>(`SELECT ${num} as num`);
    if (typeof results === 'string') {
      throw new Error('Expected JSON response');
    }
    const [result] = results;

    // Assert
    expect(result).toBeDefined();
    expect(result.num).toStrictEqual(num);
  });

  test('Query with params', async () => {
    // Arrange
    const param = 7

    // Act
    const results = await client.queryPromise<BasicQueryResult>(
      'SELECT {param:UInt8} as num',
      { param }
    );
    if (typeof results === 'string') {
      throw new Error('Expected JSON response');
    }
    const [result] = results;

    // Assert
    expect(result).toBeDefined();
    expect(result.num).toStrictEqual(param);
  });
});
