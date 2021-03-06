/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as net from 'net';
import * as cp from 'child_process';
import { injectable, inject, named } from "inversify";
import { Message, isRequestMessage } from 'vscode-ws-jsonrpc';
import { InitializeParams, InitializeRequest } from 'vscode-languageserver-protocol';
import {
    createProcessSocketConnection,
    createStreamConnection,
    forward,
    IConnection
} from 'vscode-ws-jsonrpc/lib/server';
import { MaybePromise, ILogger } from "@theia/core/lib/common";
import { LanguageContribution } from "../common";
import { RawProcess, RawProcessFactory } from '@theia/process/lib/node/raw-process';
import { ProcessManager } from '@theia/process/lib/node/process-manager';

export {
    LanguageContribution, IConnection, Message
};

export const LanguageServerContribution = Symbol('LanguageServerContribution');
export interface LanguageServerContribution extends LanguageContribution {
    start(clientConnection: IConnection): void;
}

@injectable()
export abstract class BaseLanguageServerContribution implements LanguageServerContribution {

    abstract readonly id: string;
    abstract readonly name: string;

    @inject(RawProcessFactory)
    protected readonly processFactory: RawProcessFactory;

    @inject(ProcessManager)
    protected readonly processManager: ProcessManager;

    @inject(ILogger) @named('languages') protected readonly logger: ILogger;

    abstract start(clientConnection: IConnection): void;

    protected forward(clientConnection: IConnection, serverConnection: IConnection): void {
        forward(clientConnection, serverConnection, this.map.bind(this));
    }

    protected map(message: Message): Message {
        if (isRequestMessage(message)) {
            if (message.method === InitializeRequest.type.method) {
                const initializeParams = message.params as InitializeParams;
                initializeParams.processId = process.pid;
            }
        }

        this.logger.debug(JSON.stringify(message));

        return message;
    }

    protected async createProcessSocketConnection(outSocket: MaybePromise<net.Socket>, inSocket: MaybePromise<net.Socket>,
        command: string, args?: string[], options?: cp.SpawnOptions): Promise<IConnection> {

        const process = this.spawnProcess(command, args, options);
        const [outSock, inSock] = await Promise.all([outSocket, inSocket]);
        return createProcessSocketConnection(process.process, outSock, inSock);
    }

    protected createProcessStreamConnection(command: string, args?: string[], options?: cp.SpawnOptions): IConnection {
        const process = this.spawnProcess(command, args, options);
        return createStreamConnection(process.output, process.input, () => process.kill());
    }

    protected spawnProcess(command: string, args?: string[], options?: cp.SpawnOptions): RawProcess {
        const rawProcess = this.processFactory({ command, args, options });
        rawProcess.process.once('error', this.onDidFailSpawnProcess.bind(this));
        rawProcess.process.stderr.on('data', this.logError.bind(this));
        return rawProcess;
    }

    protected onDidFailSpawnProcess(error: Error): void {
        console.error(error);
    }

    protected logError(data: string | Buffer) {
        if (data) {
            console.error(`${this.name}: ${data}`);
        }
    }

    protected logInfo(data: string | Buffer) {
        if (data) {
            console.info(`${this.name}: ${data}`);
        }
    }

    protected startSocketServer(): Promise<net.Server> {
        return new Promise(resolve => {
            const server = net.createServer();
            server.addListener('listening', () =>
                resolve(server)
            );
            // allocate ports dynamically
            server.listen(0, '127.0.0.1');
        });
    }

    protected accept(server: net.Server): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            server.on('error', reject);
            server.on('connection', socket => {
                // stop accepting new connections
                server.close();
                resolve(socket);
            });
        });
    }

}
