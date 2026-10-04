import { MongoConnection } from './mongo-connection';

/**
 * Found by stopping Mongo, restarting the API, then starting Mongo again:
 * the driver reported "Topology is closed" on every subsequent call and never
 * recovered. A transient outage must not permanently disable analytics.
 */
describe('MongoConnection', () => {
  const makeClient = (overrides: Record<string, jest.Mock> = {}) => ({
    connect: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue({ name: 'aveline' }),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it('connects once and reuses the client across calls', async () => {
    const client = makeClient();
    const create = jest.fn().mockReturnValue(client);
    const connection = new MongoConnection(create as never);

    await connection.db();
    await connection.db();

    expect(create).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('builds a new client after a closed topology, so the next call recovers', async () => {
    const dead = makeClient({ connect: jest.fn().mockRejectedValue(new Error('Topology is closed')) });
    const alive = makeClient();
    const create = jest.fn().mockReturnValueOnce(dead).mockReturnValueOnce(alive);
    const connection = new MongoConnection(create as never);

    await expect(connection.db()).rejects.toThrow('Topology is closed');
    await expect(connection.db()).resolves.toEqual({ name: 'aveline' });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('discards the client when an operation reports a closed topology', async () => {
    const client = makeClient();
    const create = jest.fn().mockReturnValue(client);
    const connection = new MongoConnection(create as never);

    await connection.db();
    connection.reportFailure(new Error('Topology is closed'));
    await connection.db();

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps the client for an ordinary operational error', async () => {
    const client = makeClient();
    const create = jest.fn().mockReturnValue(client);
    const connection = new MongoConnection(create as never);

    await connection.db();
    connection.reportFailure(new Error('duplicate key'));
    await connection.db();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('closes the live client on shutdown and tolerates no client at all', async () => {
    const client = makeClient();
    const connection = new MongoConnection(jest.fn().mockReturnValue(client) as never);

    await connection.close();
    expect(client.close).not.toHaveBeenCalled();

    await connection.db();
    await connection.close();
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
