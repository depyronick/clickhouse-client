import axios, { AxiosRequestConfig, AxiosRequestHeaders } from 'axios';

import { IncomingMessage } from 'http';

import * as Pick from 'stream-json/filters/Pick';
import * as StreamArray from 'stream-json/streamers/StreamArray';

import * as zlib from 'zlib';

import { Parser } from 'stream-json';
import { Observable } from 'rxjs';

import { ClickHouseConnectionProtocol, ClickHouseCompressionMethod, ClickHouseDataFormat } from './enums';
import { ClickHouseClientOptions } from './interfaces/ClickHouseClientOptions';

export class ClickHouseClient {
    /**
    * ClickHouse Service
    */
    constructor(
        private options: ClickHouseClientOptions
    ) {
        this.options = Object.assign(new ClickHouseClientOptions(), options);
    }

    /**
     * Prepare request options
     */
    private _getRequestOptions(query: string, withoutFormat: boolean = false): AxiosRequestConfig<any> {
        let url = this._getUrl();

        if (!withoutFormat) {
            query = `${query.trimEnd()} FORMAT ${this.options.format}`;
        }

        const params = {
            query,
            database: this.options.database
        };

        if (this.options.compression != ClickHouseCompressionMethod.NONE) {
            params['enable_http_compression'] = 1;
        }

        const requestOptions: AxiosRequestConfig = {
            url,
            params,
            responseType: 'stream',
            method: 'POST',
            auth: {
                username: this.options.username,
                password: this.options.password
            },
            httpAgent: this.options.httpAgent,
            httpsAgent: this.options.httpsAgent,
            transformResponse: (data: IncomingMessage) => {
                if (this.options.compression == ClickHouseCompressionMethod.BROTLI) {
                    return data.pipe(zlib.createBrotliDecompress());
                } else {
                    return data;
                }
            },
            headers: this._getHeaders()
        }

        return requestOptions;
    }

    /**
     * Prepare headers for request
     */
    private _getHeaders(): AxiosRequestHeaders {
        const headers = {};

        switch (this.options.compression) {
            case ClickHouseCompressionMethod.GZIP:
                headers['Accept-Encoding'] = 'gzip';
                break;
            case ClickHouseCompressionMethod.DEFLATE:
                headers['Accept-Encoding'] = 'deflate';
                break;
            case ClickHouseCompressionMethod.BROTLI:
                headers['Accept-Encoding'] = 'br';
        }

        return headers;
    }

    /**
     * Get ClickHouse HTTP Interface URL
     */
    private _getUrl() {
        switch (this.options.protocol) {
            case ClickHouseConnectionProtocol.HTTP:
                return `http://${this.options.host}:${this.options.port}`;
            case ClickHouseConnectionProtocol.HTTPS:
                return `https://${this.options.host}:${this.options.port}`;
        }
    }

    /**
     * Promise based query
     * @private
     */
    private _queryPromise<T = any>(query: string) {
        return new Promise<T[]>((resolve, reject) => {
            const _data: T[] = [];

            this
                ._queryObservable<T>(query)
                .subscribe({
                    error: (error) => {
                        return reject(error);
                    },
                    next: (row) => {
                        _data.push(row);
                    },
                    complete: () => {
                        return resolve(_data);
                    }
                });
        });
    }

    /**
     * Observable based query
     * @private
     */
    private _queryObservable<T = any>(query: string) {
        return new Observable<T>(subscriber => {
            axios
                .request(
                    this._getRequestOptions(query)
                )
                .then((response) => {
                    const stream: IncomingMessage = response.data;

                    if (this.options.format == ClickHouseDataFormat.JSON) {
                        const pipeline = stream
                            .pipe(new Parser())
                            .pipe(new Pick({
                                filter: 'data'
                            }))
                            .pipe(new StreamArray())

                        pipeline
                            .on('data', (row) => {
                                subscriber.next(row.value as T);
                            })
                            .on('end', () => {
                                subscriber.complete()
                            })
                    } else {
                        throw new Error("Unsupported data format. Only JSON is supported for now.")
                    }
                })
                .catch((reason) => {
                    if (reason && reason.response) {
                        let err: string = '';

                        reason
                            .response
                            .data
                            .on('data', chunk => {
                                err += chunk.toString('utf8')
                            })
                            .on('end', () => {
                                this.options.logger.error(err.trim());
                                subscriber.error(err.trim());

                                err = '';
                            })
                    } else {
                        this.options.logger.error(reason);
                        subscriber.error(reason);
                    }
                })
        })
    }

    /**
     * Observable based query
     */
    public query<T = any>(query: string) {
        return this._queryObservable<T>(query);
    }

    /**
     * Promise based query
     */
    public queryPromise<T = any>(query: string) {
        return this._queryPromise<T>(query);
    }

    /**
     * Insert data to table (Observable)
     */
    public insert<T = any>(table: string, data: T[]) {
        return new Observable<void>(subscriber => {
            let query = `INSERT INTO ${table}`;
            let _data: any;

            switch (this.options.format) {
                case ClickHouseDataFormat.JSON:
                    query += ` FORMAT JSONEachRow`;
                    _data = data.map(d => JSON.stringify(d)).join('\n');
                    break;
            }

            axios
                .request(
                    Object.assign(
                        this._getRequestOptions(query, true),
                        <AxiosRequestConfig>{
                            responseType: 'stream',
                            method: 'POST',
                            data: _data,
                            httpAgent: this.options.httpAgent,
                            httpsAgent: this.options.httpsAgent
                        }
                    )
                )
                .then((response) => {
                    const stream: IncomingMessage = response.data;

                    stream
                        .on('data', (data) => {
                            // currently nothing to do here 
                            // clickhouse http interface returns an empty response 
                            // with inserts
                        })
                        .on('end', () => {
                            subscriber.complete();
                        });
                })
                .catch(reason => {
                    subscriber.error(reason);
                    this.options.logger.error(reason);
                })
        });
    }

    /**
     * Insert data to table (Promise)
     */
    public insertPromise<T = any>(table: string, data: T[]) {
        return new Promise<void>((resolve, reject) => {
            this.insert<T>(table, data).subscribe({
                error: (error) => {
                    return reject(error);
                },
                next: (row) => {
                    // currently nothing to do here 
                    // clickhouse http interface returns an empty response 
                    // with inserts
                },
                complete: () => {
                    return resolve();
                }
            });
        });
    }

    /**
     * Pings the clickhouse server
     * 
     * @param timeout timeout in milliseconds, defaults to 3000.
     */
    public ping(timeout: number = 3000) {
        return new Promise<boolean>((resolve, reject) => {
            axios
                .get(`${this._getUrl()}/ping`, {
                    timeout,
                    httpAgent: this.options.httpAgent,
                    httpsAgent: this.options.httpsAgent
                })
                .then((response) => {
                    if (response && response.data) {
                        if (response.data == 'Ok.\n') {
                            return resolve(true);
                        }
                    }

                    return resolve(false);
                })
                .catch((reason) => {
                    return reject(reason);
                })
        });
    }
}