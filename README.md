## clickhouse-client for NodeJS

[ClickHouse®](https://clickhouse.com/) is an open-source, high performance columnar OLAP database management system for real-time analytics using SQL. ClickHouse combined with TypeScript helps you develop better type safety with your ClickHouse queries, giving you end-to-end typing.

## Installation

Install the following package:

```bash
$ npm i --save @depyronick/clickhouse-client
```

## Quick Start

- [Importing the module](#importing-the-module)
- [Methods](#methods)
  - **Query**
    - [`ClickHouseClient.query<T>(query: string): Observable<T>`](#clickhouseclientquerytquery-string-observablet)
    - [`ClickHouseClient.queryPromise<T>(query: string): Promise<T[]>`](#clickhouseclientquerypromisetquery-string-promiset)
  - **Insert**
    - [`ClickHouseClient.insert<T>(table: string, data: T[]): Observable<void>`](#clickhouseclientinsertttable-string-data-t-observablevoid)
    - [`ClickHouseClient.insertPromise<T>(table: string, data: T[]): Promise<void>`](#clickhouseclientinsertpromisettable-string-data-t-promisevoid)
  - **Other**
    - [`ClickHouseClient.ping(timeout: number = 3000): Promise<boolean>`](#clickhouseclientpingtimeout-number--3000-promiseboolean)
- [Notes](#notes)

### Importing the module

Once the installation process is complete, you can import the `ClickHouseClient`

```javascript
const { ClickHouseClient } = require('@depyronick/clickhouse-client');

// or:
// import { ClickHouseClient } from '@depyronick/clickhouse-client';

const analyticsServer = new ClickHouseClient({
  host: '127.0.0.1',
  password: '7h3ul71m473p4555w0rd'
});

// you can create multiple clients
const chatServer = new ClickHouseClient({
  host: '127.0.0.2',
  password: '7h3ul71m473p4555w0rd'
});
```

`new ClickHouseClient(options: ClickHouseOptions)` will create a ClickHouse client with the specified connection options.

See **[ClickHouseOptions](https://github.com/depyronick/clickhouse-client/blob/main/src/client/interfaces/ClickHouseClientOptions.ts 'ClickHouseOptions')** object for more information.

### Methods

#### `ClickHouseClient.query<T>(query: string, params?: Record<string,string | number>): Observable<T>`

```javascript
this.analyticsServer.query('SELECT * FROM visits LIMIT 10').subscribe({
  error: (err) => {
    // called when an error occurred during query
  },
  next: (row) => {
    // called for each row
  },
  complete: () => {
    // called when stream is completed
  }
});
```

#### `ClickHouseClient.queryPromise<T>(query: string, params?: Record<string,string | number>): Promise<T[]>`

```javascript
this.analyticsServer
  .queryPromise('SELECT * FROM visits LIMIT 10')
  .then((rows) => {
    // all retrieved rows
  })
  .catch((err) => {
    // called when an error occurred during query
  });

// or

const rows = await this.analyticsServer.queryPromise(
  'SELECT * FROM visits LIMIT 10'
);
```

#### `ClickHouseClient.insert<T>(table: string, data: T[]): Observable<void>`

The `insert` method accepts two inputs.

- `table` is the name of the table that you'll be inserting data to.
  - Table value could be prefixed with database like `analytics_db.visits`.
- `data: T[]` array of JSON objects to insert.

```javascript
analyticsServer
  .insert('visits', [
    {
      timestamp: new Date().getTime(),
      ip: '127.0.0.1',
      os: 'OSX',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/95.0.4638.69 Safari/537.36',
      version: '1.0.0'
    }
  ])
  .subscribe({
    error: (err) => {
      // called when an error occurred during insert
    },
    next: () => {
      // currently next does not emits anything for inserts
    },
    complete: () => {
      // called when insert is completed
    }
  });
```

#### `ClickHouseClient.insertPromise<T>(table: string, data: T[]): Promise<void>`

The `insertPromise` method accepts the same inputs as `insert` but returns a Promise, instead of Observable.

```javascript
analyticsServer
  .insertPromise('visits', [
    {
      timestamp: new Date().getTime(),
      ip: '127.0.0.1',
      os: 'OSX',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/95.0.4638.69 Safari/537.36',
      version: '1.0.0'
    }
  ])
  .then(() => {
    // insert was success
  })
  .catch(err => {
    // called when an error occurred during insert
  })
```

#### `ClickHouseClient.ping(timeout: number = 3000): Promise<boolean>`

The `ping` method accepts one input.

- `timeout` is the time in milliseconds to wait for the server to send ping response `Ok.\n`.

```javascript
// if you're using async/await
const ping = await analyticsServer.ping();

// or

analyticsServer
  .then((pingResult) => {
    // ping result is a boolean
    // it will return `true` if we were able to receive `Ok.\n`
    // and `false` if anything but `Ok.\n`
  })
  .catch((reason) => {
    // reason is the full response of the error
    // see more details at https://axios-http.com/docs/handling_errors
  });
```

## Notes

- This repository will be actively maintained and improved.
- Currently only supports JSON format.
  - Planning to support all applicable formats listed [here](https://clickhouse.com/docs/en/interfaces/formats/ 'here').
- Planning to implement TCP protocol, if ClickHouse decides to [documentate](https://clickhouse.com/docs/en/interfaces/tcp/ 'documentate') it.
- Planning to implement inserts with streams.
- This library supports http response compressions such as brotli, gzip and deflate.

## Stay in touch

- Author - [Ali Demirci](https://github.com/depyronick)

## License

[MIT licensed](LICENSE).
