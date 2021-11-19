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
            auth: {
                username: this.options.username,
                password: this.options.password
            },
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
     * Create a Readable Query Stream
     */
    public query<T = any>(query: string) {
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
     * Insert data to table
     */
    public insert<T = any>(table: string, data: T[]) {
        return new Observable<any>(subscriber => {
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
                            data: _data
                        }
                    )
                )
                .then((response) => {
                    const stream: IncomingMessage = response.data;

                    stream
                        .on('data', (data) => {
                            subscriber.next(data);
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
     * Pings the clickhouse server
     * 
     * @param timeout timeout in milliseconds, defaults to 3000.
     */
    public ping(timeout: number = 3000) {
        return new Promise<boolean>((resolve, reject) => {
            axios
                .get(`${this._getUrl()}/ping`, {
                    timeout
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