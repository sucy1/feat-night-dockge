import { DockgeServer } from "./dockge-server";
import { LimitQueue } from "./utils/limit-queue";
import { DockgeSocket } from "./util-server";
import childProcess from "child_process";
import { log } from "./log";
import { Stack } from "./stack";

export interface LogLine {
    lineNumber: number;
    text: string;
    isMatch?: boolean;
    isCurrentMatch?: boolean;
}

export interface SearchResult {
    totalLines: number;
    matchedLines: LogLine[];
}

export class ContainerLog {
    protected static logMap: Map<string, ContainerLog> = new Map();

    protected server: DockgeServer;
    protected _name: string;
    protected stackName: string;
    protected serviceName: string;
    protected tail: number;

    protected containerName?: string;
    protected logsProcess?: childProcess.ChildProcessWithoutNullStreams;

    protected lineBuffer: LimitQueue<LogLine>;
    protected lineCounter: number = 0;

    protected socketList: Record<string, DockgeSocket> = {};

    protected kickDisconnectedClientsInterval?: NodeJS.Timeout;

    constructor(server: DockgeServer, stackName: string, serviceName: string, tail: number = 100) {
        this.server = server;
        this.stackName = stackName;
        this.serviceName = serviceName;
        this.tail = tail;

        const maxBufferLines = Math.max(tail * 20, 2000);
        this.lineBuffer = new LimitQueue<LogLine>(maxBufferLines);

        this._name = `${stackName}-${serviceName}`;

        ContainerLog.logMap.set(this.name, this);
    }

    get name(): string {
        return this._name;
    }

    public static getLogName(stackName: string, serviceName: string): string {
        return `${stackName}-${serviceName}`;
    }

    public static getLog(name: string): ContainerLog | undefined {
        return ContainerLog.logMap.get(name);
    }

    public static async getOrCreateLog(server: DockgeServer, stackName: string, serviceName: string, tail: number = 100): Promise<ContainerLog> {
        const name = ContainerLog.getLogName(stackName, serviceName);
        let containerLog = ContainerLog.getLog(name);
        if (!containerLog) {
            containerLog = new ContainerLog(server, stackName, serviceName, tail);
        } else {
            containerLog.tail = tail;
            const maxBufferLines = Math.max(tail * 20, 2000);
            containerLog.lineBuffer.resize(maxBufferLines);
        }
        return containerLog;
    }

    public async start(): Promise<void> {
        if (this.logsProcess) {
            return;
        }

        this.kickDisconnectedClientsInterval = setInterval(() => {
            for (const socketID in this.socketList) {
                const socket = this.socketList[socketID];
                if (!socket.connected) {
                    log.debug("ContainerLog", "Kicking disconnected client " + socket.id + " from log " + this.name);
                    this.leave(socket);
                }
            }
        }, 60 * 1000);

        try {
            const stack = await Stack.getStack(this.server, this.stackName, true);
            const serviceStatusMap = await stack.getServiceStatusList();
            const serviceStatusArray = serviceStatusMap.get(this.serviceName);

            if (!serviceStatusArray || serviceStatusArray.length === 0) {
                throw new Error(`Service ${this.serviceName} not found or has no running containers`);
            }

            // @ts-ignore
            this.containerName = serviceStatusArray[0].name;

            if (!this.containerName) {
                throw new Error(`Container name not found for service ${this.serviceName}`);
            }

            this.lineBuffer.clear();
            this.lineCounter = 0;

            this.logsProcess = childProcess.spawn("docker", [
                "logs",
                "--tail", String(this.tail),
                "-f",
                this.containerName,
            ]);

            this.logsProcess.stdout.on("data", (data: Buffer) => {
                this.processLogData(data.toString());
            });

            this.logsProcess.stderr.on("data", (data: Buffer) => {
                this.processLogData(data.toString());
            });

            this.logsProcess.on("close", (code) => {
                log.debug("ContainerLog", `Log process for ${this.name} exited with code ${code}`);
                this.cleanup();
            });

            this.logsProcess.on("error", (err) => {
                log.error("ContainerLog", `Error in log process for ${this.name}: ${err.message}`);
                this.cleanup();
            });

        } catch (e) {
            if (e instanceof Error) {
                this.addErrorLine(e.message);
                this.broadcastError(e.message);
            }
            this.cleanup();
        }
    }

    protected processLogData(data: string): void {
        const lines = data.split("\n");

        for (const line of lines) {
            if (line === "" && lines[lines.length - 1] === line && line === lines[lines.indexOf(line)]) {
                continue;
            }
            if (line !== "" || (data.endsWith("\n") && line === "" && lines.indexOf(line) === lines.length - 1)) {
                if (line !== "") {
                    this.addLogLine(line);
                }
            }
        }

        this.broadcastIncremental(data);
    }

    protected addLogLine(text: string): void {
        this.lineCounter++;
        const logLine: LogLine = {
            lineNumber: this.lineCounter,
            text: text,
        };
        this.lineBuffer.pushItem(logLine);
    }

    protected addErrorLine(message: string): void {
        this.lineCounter++;
        const logLine: LogLine = {
            lineNumber: this.lineCounter,
            text: `[Error] ${message}`,
        };
        this.lineBuffer.pushItem(logLine);
    }

    protected broadcastIncremental(data: string): void {
        for (const socketID in this.socketList) {
            const socket = this.socketList[socketID];
            socket.emitAgent("containerLogWrite", this.name, data);
        }
    }

    protected broadcastError(message: string): void {
        for (const socketID in this.socketList) {
            const socket = this.socketList[socketID];
            socket.emitAgent("containerLogWrite", this.name, `[Error] ${message}\n`);
        }
    }

    public join(socket: DockgeSocket): void {
        this.socketList[socket.id] = socket;
    }

    public leave(socket: DockgeSocket): void {
        delete this.socketList[socket.id];

        if (Object.keys(this.socketList).length === 0) {
            log.debug("ContainerLog", `No more clients for ${this.name}, stopping log stream`);
            this.stop();
        }
    }

    public stop(): void {
        if (this.logsProcess) {
            this.logsProcess.kill("SIGTERM");
        }
    }

    protected cleanup(): void {
        clearInterval(this.kickDisconnectedClientsInterval);
        this.logsProcess = undefined;
        ContainerLog.logMap.delete(this.name);

        for (const socketID in this.socketList) {
            const socket = this.socketList[socketID];
            socket.emitAgent("containerLogExit", this.name);
        }
        this.socketList = {};
    }

    public getRawText(): string {
        if (this.lineBuffer.length === 0) {
            return "";
        }
        const texts = this.lineBuffer.map((line) => line.text);
        return texts.join("\n") + "\n";
    }

    public getLines(): LogLine[] {
        if (this.lineBuffer.length === 0) {
            return [];
        }
        return this.lineBuffer.map((line) => ({ ...line }));
    }

    public getLinesWithOffset(offset: number = 0, limit: number = 1000): { totalLines: number; lines: LogLine[] } {
        const allLines = this.getLines();
        const totalLines = allLines.length;

        if (offset < 0) {
            offset = Math.max(0, totalLines + offset);
        }

        const endIndex = Math.min(offset + limit, totalLines);
        return {
            totalLines,
            lines: allLines.slice(offset, endIndex),
        };
    }

    public search(
        keyword: string,
        offset: number = 0,
        limit: number = 100,
        caseSensitive: boolean = false
    ): SearchResult {
        const allLines = this.getLines();

        if (!keyword) {
            const result = this.getLinesWithOffset(-limit, limit);
            return {
                totalLines: result.totalLines,
                matchedLines: result.lines.map((line, index) => ({
                    ...line,
                    isMatch: false,
                    isCurrentMatch: index === 0 && offset === 0,
                })),
            };
        }

        const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();

        const matchedLines: LogLine[] = [];
        for (let i = 0; i < allLines.length; i++) {
            const line = allLines[i];
            const lineText = caseSensitive ? line.text : line.text.toLowerCase();

            if (lineText.includes(searchKeyword)) {
                matchedLines.push({
                    ...line,
                    isMatch: true,
                    isCurrentMatch: matchedLines.length === offset,
                });
            }
        }

        const totalMatches = matchedLines.length;

        const endIndex = Math.min(offset + limit, totalMatches);
        const pageLines = matchedLines.slice(offset, endIndex);

        return {
            totalLines: totalMatches,
            matchedLines: pageLines,
        };
    }

    public getMatchIndexByLineNumber(lineNumber: number, keyword: string, caseSensitive: boolean = false): number {
        const allLines = this.getLines();
        const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();

        let matchIndex = -1;
        for (let i = 0; i < allLines.length; i++) {
            const line = allLines[i];
            const lineText = caseSensitive ? line.text : line.text.toLowerCase();

            if (lineText.includes(searchKeyword)) {
                matchIndex++;
            }

            if (line.lineNumber === lineNumber) {
                return matchIndex;
            }
        }

        return -1;
    }

    public static getLogCount(): number {
        return ContainerLog.logMap.size;
    }
}
