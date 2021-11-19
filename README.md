## Description

[ClickHouse®](https://clickhouse.com/) is an open-source, high performance columnar OLAP database management system for real-time analytics using SQL.

## Installation

Install the following package:

```bash
$ npm i --save @depyronick/clickhouse-client
```

## Quick Start

### Importing the module
Once the installation process is complete, we can import the `ClickHouseClient` 

```typescript
import { ClickHouseClient } from '@depyronick/clickhouse-client';

const analyticsServer = new ClickHouseClient([{
      host: '127.0.0.1',
      password: '7h3ul71m473p4555w0rd'
}]);

// you can create multiple clients
const chatServer = new ClickHouseClient([{
      host: '127.0.0.2',
      password: '7h3ul71m473p4555w0rd'
}]);
```
`new ClickHouseClient(options: **[ClickHouseOptions](https://github.com/depyronick/nestjs-clickhouse/blob/main/lib/interfaces/ClickHouseModuleOptions.ts "ClickHouseOptions")**)` will create a ClickHouse client with the specified connection options. See **[ClickHouseOptions](https://github.com/depyronick/nestjs-clickhouse/blob/main/lib/interfaces/ClickHouseModuleOptions.ts "ClickHouseOptions")** object for more information.


There are two methods to interact with the server:

### `ClickHouseClient.query<T>(query: string): Observable<T>`

```typescript
this
      .analyticsServer
      .query("SELECT * FROM visits LIMIT 10")
      .subscribe({
        error: (err: any): void => {
          // called when an error occurred during query
        },
        next: (row): void => {
          // called for each row
        },
        complete: (): void => {
          // called when stream is completed
        }
})
```

### `ClickHouseClient.insert<T>(table: string, data: T[]): Observable<any>`

The `insert` method accepts two inputs. 
- `table` is the name of the table that you'll be inserting data to. 
	- Table value could be prefixed with database like `analytics_db.visits`.
- `data: T[]` array of JSON objects to insert.

```typescript
this
      .analyticsServer
      .insert("visits", [{
        timestamp: new Date().getTime(),
        ip: '127.0.0.1',
        os: 'OSX',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/95.0.4638.69 Safari/537.36',
        version: "1.0.0"
      }])
      .subscribe({
        error: (err: any): void => {
          // called when an error occurred during insert
        },
        next: (): void => {
          // currently next does not emits anything for inserts
        },
        complete: (): void => {
          // called when insert is completed
        }
})
```

## Notes
- This repository will be actively maintained and improved.
- Currently only supports JSON format. 
	- Planning to support all applicable formats listed [here](https://clickhouse.com/docs/en/interfaces/formats/ "here").
- Planning to implement TCP protocol, if ClickHouse decides to [documentate](https://clickhouse.com/docs/en/interfaces/tcp/ "documentate") it.
- Planning to implement inserts with streams.
- This library supports http response compressions such as brotli, gzip and deflate.

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Ali Demirci](https://github.com/depyronick)

## License

[MIT licensed](LICENSE).
