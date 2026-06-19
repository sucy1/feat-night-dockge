import { DockgeServer } from "./dockge-server";
import { LimitQueue } from "./utils/limit-queue";
import { DockgeSocket } from "./util-server";
import childProcess from "child_process";
import { log } from "./log";
import { Stack } from "./stack";

export class ContainerLog {
    protected static logMap: Map<string, ContainerLog> = new Map();

    protected server: DockgeServer;
    protected _name: string;
    protected stackName: string;
    protected serviceName: string;
    protected tail: number;

    protected containerName?: string;
    protected logsProcess?: childProcess.ChildProcessWithoutNullStreams;

    protected buffer: LimitQueue<string> = new LimitQueue(500);
    protected socketList: Record<string, DockgeSocket> = {};

    protected kickDisconnectedClientsInterval?: NodeJS.Timeout;

    constructor(server: DockgeServer, stackName: string, serviceName: string, tail: number = 100) {
        this.server = server;
        this.stackName = stackName;
        this.serviceName = serviceName;
        this.tail = tail;
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

            this.logsProcess = childProcess.spawn("docker", [
                "logs",
                "--tail", String(this.tail),
                "-f",
                this.containerName,
            ]);

            this.logsProcess.stdout.on("data", (data: Buffer) => {
                const str = data.toString();
                this.buffer.pushItem(str);
                this.broadcast(str);
            });

            this.logsProcess.stderr.on("data", (data: Buffer) => {
                const str = data.toString();
                this.buffer.pushItem(str);
                this.broadcast(str);
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
                const errorMsg = `[Error] ${e.message}\n`;
                this.buffer.pushItem(errorMsg);
                this.broadcast(errorMsg);
            }
            this.cleanup();
        }
    }

    protected broadcast(data: string): void {
        for (const socketID in this.socketList) {
            const socket = this.socketList[socketID];
            socket.emitAgent("containerLogWrite", this.name, data);
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

    public getBuffer(): string {
        if (this.buffer.length === 0) {
            return "";
        }
        return this.buffer.join("");
    }

    public static getLogCount(): number {
        return ContainerLog.logMap.size;
    }
}
