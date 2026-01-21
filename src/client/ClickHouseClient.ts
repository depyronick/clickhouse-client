import axios, {
    AxiosError,
    AxiosRequestConfig
} from 'axios';

import {
    IncomingMessage
} from 'http';

import * as Pick from 'stream-json/filters/Pick';
import * as StreamArray from 'stream-json/streamers/StreamArray';

import * as zlib from 'zlib';

import { Parser } from 'stream-json';

import {
    Observable,
    Subscriber
} from 'rxjs';

import {
    Readable
} from 'stream';

import {
    ClickHouseConnectionProtocol,
    ClickHouseCompressionMethod,
    ClickHouseDataFormat
} from './enums';

import {
    ClickHouseClientOptions,
    ClickHouseHttpConfig,
    ClickHouseSettings
} from './interfaces/ClickHouseClientOptions';

export class ClickHouseClient {
    /**
    * ClickHouse Service
    */
    constructor(
        private options?: ClickHouseClientOptions
    ) {
        const defaults = new ClickHouseClientOptions();

        if (!this.options) {
            this.options = defaults;
            return;
        }

        const merged = Object.assign(defaults, this.options);

        if (this.options.settings) {
            merged.settings = Object.assign(
                new ClickHouseSettings(),
                defaults.settings,
                this.options.settings
            );
        }

        if (this.options.httpConfig) {
            merged.httpConfig = Object.assign(
                new ClickHouseHttpConfig(),
                defaults.httpConfig,
                this.options.httpConfig
            );
        }

        this.options = merged;
    }

    /**
     * Validate insert parameters
     */
    private _validateInsert<T = any>(
        table: string,
        data: T[]
    ) {
        // validate table
        if (!table || table.trim() == '') {
            throw new Error("Table name is required");
        }

        // validate data array
        if (!Array.isArray(data)) {
            throw new Error("Data must be an array");
        }

        if (Array.isArray(data) && data.length === 0) {
            throw new Error("Data is empty");
        }
    }

    /**
     * Validate query parameters
     */
    private _validateQuery(
        query: string
    ) {
        if (!Object.values(ClickHouseDataFormat).includes(this.options.format)) {
            throw new Error(`${this.options.format} is not supported.`);
        }

        // validate query
        if (!query || query.trim() == '') {
            throw new Error("Query is required");
        }
    }

    /**
     * Handle ClickHouse HTTP errors (for Observable)
     */
    private _handleObservableError<T>(
        reason: AxiosError<any>,
        subscriber?: Subscriber<T>
    ) {
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

                    if (subscriber) {
                        subscriber?.error(err.trim());
                    }

                    err = '';
                })
        } else {
            this.options.logger.error(reason);

            if (subscriber) {
                subscriber?.error(reason);
            }
        }
    }

    /**
     * Handle ClickHouse HTTP errors (for Promise)
     */
    private _handlePromiseError(
        reason: AxiosError<any>
    ) {
        if (reason && reason.response) {
            this.options.logger.error(reason.response.data);
            return reason.response.data;
        } else {
            this.options.logger.error(reason);
            return reason;
        }
    }

    /**
     * Apply common ClickHouse settings to query params
     */
    private _appendSettingsParams(
        params: URLSearchParams
    ) {
        if (this.options.httpConfig.compression != ClickHouseCompressionMethod.NONE) {
            params.set('enable_http_compression', '1');
        }

        if (this.options.settings) {
            if (this.options.settings.send_progress_in_http_headers !== undefined) {
                params.set(
                    'send_progress_in_http_headers',
                    String(this.options.settings.send_progress_in_http_headers)
                );
            }

            if (this.options.settings.wait_end_of_query !== undefined) {
                params.set(
                    'wait_end_of_query',
                    String(this.options.settings.wait_end_of_query)
                );
            }

            if (this.options.settings.buffer_size !== undefined) {
                params.set(
                    'buffer_size',
                    String(this.options.settings.buffer_size)
                );
            }
        }
    }

    private _stripLeadingComments(
        query: string
    ) {
        let rest = query;

        while (true) {
            rest = rest.trimStart();

            if (rest.startsWith('--') || rest.startsWith('#')) {
                const end = rest.indexOf('\n');
                if (end === -1) {
                    return '';
                }
                rest = rest.slice(end + 1);
                continue;
            }

            if (rest.startsWith('/*')) {
                const end = rest.indexOf('*/');
                if (end === -1) {
                    return '';
                }
                rest = rest.slice(end + 2);
                continue;
            }

            return rest;
        }
    }

    private _getStatementKeyword(
        query: string
    ) {
        const stripped = this._stripLeadingComments(query);
        const match = stripped.match(/^([A-Za-z]+)/);
        return match ? match[1].toUpperCase() : undefined;
    }

    private _shouldAppendFormat(
        query: string
    ) {
        const keyword = this._getStatementKeyword(query);
        if (!keyword) {
            return true;
        }

        switch (keyword) {
            case 'SELECT':
            case 'WITH':
            case 'SHOW':
            case 'DESCRIBE':
            case 'DESC':
            case 'EXPLAIN':
            case 'CHECK':
            case 'EXISTS':
                return true;
            default:
                return false;
        }
    }

    /**
     * Resolve query format from the query string (if explicitly provided)
     */
    private _resolveQueryFormat(
        query: string
    ) {
        const match = query.match(/\bFORMAT\s+([A-Za-z0-9_]+)/i);
        if (!match) {
            if (!this._shouldAppendFormat(query)) {
                return undefined;
            }
            return this.options.format;
        }

        const formatToken = match[1];
        return Object.values(ClickHouseDataFormat).find(
            (value) => value.toLowerCase() === formatToken.toLowerCase()
        );
    }

    /**
     * Prepare request options
     */
    private _getRequestOptions(
        query: string,
        queryParams: Record<string, string | number> = {},
        withoutFormat: boolean = false
    ): AxiosRequestConfig<any> {
        let url = this._getUrl();

        if (!withoutFormat) {
            const hasFormat = /\bFORMAT\b/i.test(query);
            if (!hasFormat && this._shouldAppendFormat(query)) {
                query = `${query.trimEnd()} FORMAT ${this.options.format}`;
            }
        }

        const queryParamEntries = Object.entries(queryParams)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [`param_${key}`, String(value)]);

        const params = new URLSearchParams({
            database: this.options.database,
            ...Object.fromEntries(queryParamEntries)
        });

        this._appendSettingsParams(params);

        const requestOptions: AxiosRequestConfig = {
            url,
            params,
            responseType: 'stream',
            method: 'POST',
            data: query,
            auth: {
                username: this.options.username,
                password: this.options.password
            },
            timeout: this.options.httpConfig.timeout,
            httpAgent: this.options.httpConfig.httpAgent,
            httpsAgent: this.options.httpConfig.httpsAgent,
            maxBodyLength: this.options.httpConfig.maxBodyLength,
            maxContentLength: this.options.httpConfig.maxContentLength,
            transformResponse: (data: IncomingMessage, headers?: Record<string, string>) => {
                const encoding = headers?.['content-encoding'] || headers?.['Content-Encoding'];

                if (encoding && /br/i.test(encoding) && data && typeof data.pipe === 'function') {
                    return data.pipe(zlib.createBrotliDecompress());
                }

                return data;
            },
            headers: this._getHeaders()
        }

        return requestOptions;
    }

    /**
     * Prepare headers for request
     */
    private _getHeaders() {
        const headers: { "Accept-Encoding"?: "gzip" | "deflate" | "br" } = {};

        switch (this.options.httpConfig.compression) {
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
        switch (this.options.httpConfig.protocol) {
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
    private _queryPromise<T = any>(
        query: string,
        params?: Record<string, string | number>
    ) {
        return new Promise<T[] | string>((resolve, reject) => {
            const responseFormat = this._resolveQueryFormat(query);

            axios
                .request({
                    ...this._getRequestOptions(query, params),
                    responseType: 'text'
                })
                .then(response => response.data)
                .then(data => {
                    switch (responseFormat) {
                        case ClickHouseDataFormat.JSON:
                        case ClickHouseDataFormat.JSONCompact:
                        case ClickHouseDataFormat.JSONCompactStrings:
                        case ClickHouseDataFormat.JSONStrings:
                            if(data) {
                                try {
                                    return resolve(
                                        JSON.parse(data).data as T[]
                                    );
                                } catch (error) {
                                    const message = error instanceof Error ? error.message : String(error);
                                    return reject(new Error(`Failed to parse JSON response: ${message}`));
                                }
                            } else {
                                return resolve(
                                    [] as T[]
                                );
                            }
                        default:
                            return resolve(data);
                    }
                })
                .catch((reason: AxiosError) => {
                    return reject(this._handlePromiseError(reason));
                })
        });
    }

    /**
     * Observable based query
     * @private
     */
    private _queryObservable<T = any>(
        query: string,
        params?: Record<string, string | number>
    ) {
        return new Observable<T | string>(subscriber => {
            const responseFormat = this._resolveQueryFormat(query);
            const controller = typeof AbortController === 'function' ? new AbortController() : undefined;

            axios
                .request({
                    ...this._getRequestOptions(query, params),
                    signal: controller?.signal
                })
                .then((response) => {
                    const stream: IncomingMessage = response.data;

                    switch (responseFormat) {
                        case ClickHouseDataFormat.JSON:
                        case ClickHouseDataFormat.JSONCompact:
                        case ClickHouseDataFormat.JSONCompactStrings:
                        case ClickHouseDataFormat.JSONStrings:
                            const pipeline = stream
                                .pipe(new Parser({
                                    jsonStreaming: true
                                }))
                                .pipe(new Pick({
                                    filter: 'data'
                                }))
                                .pipe(new StreamArray())

                            pipeline
                                .on('data', (row) => {
                                    subscriber.next(row.value as T);
                                })
                                .on('error', (error) => {
                                    subscriber.error(error);
                                })
                                .on('end', () => {
                                    subscriber.complete();
                                })
                            break;
                        default:
                            stream
                                .on('data', (chunk: Buffer) => {
                                    subscriber.next(chunk.toString('utf-8'));
                                })
                                .on('error', (error) => {
                                    subscriber.error(error);
                                })
                                .on('end', () => {
                                    subscriber.complete();
                                })
                            break;
                    }
                })
                .catch((reason: AxiosError) => this._handleObservableError<T>(reason, subscriber));

            return () => {
                if (controller) {
                    controller.abort();
                }
            };
        })
    }

    /**
     * Observable based query
     */
    public query<T = any>(
        query: string,
        params?: Record<string, string | number>
    ) {
        this._validateQuery(query);

        return this._queryObservable<T>(query, params);
    }

    /**
     * Promise based query
     */
    public queryPromise<T = any>(
        query: string,
        params?: Record<string, string | number>
    ) {
        this._validateQuery(query);

        return this._queryPromise<T>(query, params);
    }

    /**
     * Insert data to table (Observable)
     */
    public insert<T = any>(
        table: string,
        data: T[]
    ) {
        this._validateInsert<T>(table, data);

        return new Observable<void>(subscriber => {
            let query = `INSERT INTO ${table}`;

            /**
             * @todo: data type should not be `any`
             */
            let _data: any;

            switch (this.options.format) {
                case ClickHouseDataFormat.JSON:
                    query += ` FORMAT JSONEachRow `;
                    _data = data.map(d => JSON.stringify(d)).join('\n');
                    break;
            }

            axios
                .request(
                    Object.assign(
                        this._getRequestOptions(query, {}, true),
                        <AxiosRequestConfig>{
                            responseType: 'stream',
                            method: 'POST',
                            data: `${query}${_data}`,
                            httpAgent: this.options.httpConfig.httpAgent,
                            httpsAgent: this.options.httpConfig.httpsAgent
                        }
                    )
                )
                .then((response) => {
                    const stream: IncomingMessage = response.data;

                    stream
                        .on('data', () => {
                            // currently nothing to do here 
                            // clickhouse http interface returns an empty response 
                            // with inserts
                        })
                        .on('end', () => {
                            subscriber.complete();
                        });
                })
                .catch((reason: AxiosError) => this._handleObservableError(reason, subscriber));
        });
    }

    /**
     * Insert raw payload to table (Observable)
     * @example insertRaw('db.table', csvString, ClickHouseDataFormat.CSV)
     */
    public insertRaw(
        table: string,
        data: string | Buffer | Readable,
        format: ClickHouseDataFormat
    ) {
        if (!table || table.trim() == '') {
            throw new Error("Table name is required");
        }

        if (!format) {
            throw new Error("Format is required");
        }

        const query = `INSERT INTO ${table} FORMAT ${format}`;

        return new Observable<void>(subscriber => {
            const requestOptions = this._getRequestOptions(query, {}, true);
            if (requestOptions.params instanceof URLSearchParams) {
                requestOptions.params.set('query', query);
            }

            axios
                .request(
                    Object.assign(
                        requestOptions,
                        <AxiosRequestConfig>{
                            responseType: 'stream',
                            method: 'POST',
                            data,
                            httpAgent: this.options.httpConfig.httpAgent,
                            httpsAgent: this.options.httpConfig.httpsAgent
                        }
                    )
                )
                .then((response) => {
                    const stream: IncomingMessage = response.data;

                    stream
                        .on('data', () => {
                            // currently nothing to do here 
                            // clickhouse http interface returns an empty response 
                            // with inserts
                        })
                        .on('error', (error) => {
                            subscriber.error(error);
                        })
                        .on('end', () => {
                            subscriber.complete();
                        });
                })
                .catch((reason: AxiosError) => this._handleObservableError(reason, subscriber));
        });
    }

    /**
     * Insert raw payload to table (Promise)
     */
    public insertRawPromise(
        table: string,
        data: string | Buffer | Readable,
        format: ClickHouseDataFormat
    ) {
        return new Promise<void>((resolve, reject) => {
            this
                .insertRaw(table, data, format)
                .subscribe({
                    error: (error) => {
                        return reject(error);
                    },
                    next: () => {
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
     * Insert data to table (Promise)
     */
    public insertPromise<T = any>(
        table: string,
        data: T[]
    ) {
        this._validateInsert<T>(table, data);

        return new Promise<void>((resolve, reject) => {
            this
                .insert<T>(table, data)
                .subscribe({
                    error: (error) => {
                        return reject(error);
                    },
                    next: () => {
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
    public ping(
        timeout: number = 3000
    ) {
        return new Promise<boolean>((resolve, reject) => {
            axios
                .request({
                    url: `${this._getUrl()}/ping`,
                    method: 'GET',
                    auth: {
                        username: this.options.username,
                        password: this.options.password
                    },
                    timeout,
                    httpAgent: this.options.httpConfig.httpAgent,
                    httpsAgent: this.options.httpConfig.httpsAgent,
                    headers: this._getHeaders()
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
