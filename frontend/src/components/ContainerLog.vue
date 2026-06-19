<template>
    <div class="container-log shadow-box mb-3">
        <div class="log-header d-flex justify-content-between align-items-center mb-2">
            <div class="d-flex align-items-center gap-2">
                <font-awesome-icon icon="file-lines" />
                <span class="log-title">{{ $t("containerLogs") || "Logs" }}</span>
                <span v-if="!logReady" class="badge bg-secondary">
                    <font-awesome-icon icon="spinner" spin class="me-1" />
                    {{ $t("connecting") || "Connecting..." }}
                </span>
                <span v-else class="badge bg-success">
                    <font-awesome-icon icon="circle" class="me-1" style="font-size: 0.5rem;" />
                    {{ $t("live") || "Live" }}
                </span>
            </div>
            <div class="d-flex align-items-center gap-2">
                <label class="form-label mb-0 me-1" style="font-size: 0.85rem;">
                    {{ $t("tailLines") || "Tail" }}:
                </label>
                <select
                    v-model="selectedTail"
                    class="form-select form-select-sm"
                    style="width: auto; display: inline-block;"
                    :disabled="logReady"
                >
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                    <option :value="200">200</option>
                    <option :value="500">500</option>
                    <option :value="1000">1000</option>
                </select>
                <button
                    class="btn btn-sm btn-normal"
                    :disabled="!autoScroll"
                    @click="scrollToBottom"
                    :title="$t('scrollToBottom') || 'Scroll to Bottom'"
                >
                    <font-awesome-icon icon="angles-down" />
                </button>
                <button
                    class="btn btn-sm"
                    :class="autoScroll ? 'btn-primary' : 'btn-normal'"
                    @click="autoScroll = !autoScroll"
                    :title="autoScroll ? ($t('disableAutoScroll') || 'Disable Auto Scroll') : ($t('enableAutoScroll') || 'Enable Auto Scroll')"
                >
                    <font-awesome-icon :icon="autoScroll ? 'arrows-down-to-line' : 'arrows-down-to-line'" />
                </button>
                <button
                    class="btn btn-sm btn-normal"
                    @click="clearLog"
                    :title="$t('clearLog') || 'Clear Log'"
                >
                    <font-awesome-icon icon="eraser" />
                </button>
            </div>
        </div>
        <div ref="logContainer" class="log-container" @scroll="onScroll">
            <pre ref="logContent" class="log-content"><code>{{ logText }}</code></pre>
            <div ref="scrollAnchor" class="scroll-anchor"></div>
        </div>
    </div>
</template>

<script>
import { defineComponent } from "vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

export default defineComponent({
    components: {
        FontAwesomeIcon,
    },
    props: {
        stackName: {
            type: String,
            required: true,
        },
        serviceName: {
            type: String,
            required: true,
        },
        endpoint: {
            type: String,
            default: "",
        },
    },
    data() {
        return {
            logText: "",
            autoScroll: true,
            logReady: false,
            logName: "",
            selectedTail: 100,
            userScrolledUp: false,
        };
    },
    watch: {
        serviceName: {
            immediate: true,
            handler() {
                if (this.logReady) {
                    this.reconnect();
                }
            },
        },
    },
    mounted() {
        this.connect();
    },
    beforeUnmount() {
        this.disconnect();
    },
    methods: {
        async connect() {
            this.logReady = false;
            this.logText = "";

            const handler = {
                write: (data) => this.writeLog(data),
                exit: () => this.onExit(),
            };

            const res = await this.$root.bindContainerLog(
                this.endpoint,
                this.stackName,
                this.serviceName,
                handler,
                this.selectedTail
            );

            if (res.ok) {
                this.logName = res.logName || "";
                if (res.buffer) {
                    this.logText = res.buffer;
                    this.$nextTick(() => this.scrollToBottom());
                }
                this.logReady = true;
            } else {
                this.logText = `[Error] ${res.msg || "Failed to connect to log stream"}\n`;
                this.logReady = false;
            }
        },

        disconnect() {
            if (this.logName) {
                this.$root.unbindContainerLog(
                    this.endpoint,
                    this.stackName,
                    this.serviceName,
                    this.logName
                );
                this.logName = "";
            }
            this.logReady = false;
        },

        async reconnect() {
            this.disconnect();
            await this.connect();
        },

        writeLog(data) {
            this.logText += data;

            const lines = this.logText.split("\n");
            const maxLines = this.selectedTail * 10;
            if (lines.length > maxLines) {
                this.logText = lines.slice(-maxLines).join("\n");
            }

            if (this.autoScroll && !this.userScrolledUp) {
                this.$nextTick(() => this.scrollToBottom());
            }
        },

        onExit() {
            this.logReady = false;
            this.logText += "\n[Log stream disconnected]\n";
        },

        scrollToBottom() {
            if (this.$refs.scrollAnchor) {
                this.$refs.scrollAnchor.scrollIntoView({ behavior: "smooth", block: "end" });
            }
            this.userScrolledUp = false;
        },

        onScroll() {
            const container = this.$refs.logContainer;
            if (!container) return;

            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

            if (distanceFromBottom > 50) {
                this.userScrolledUp = true;
            } else {
                this.userScrolledUp = false;
            }
        },

        clearLog() {
            this.logText = "";
        },
    },
});
</script>

<style scoped lang="scss">
@import "../styles/vars";

.container-log {
    padding: 1rem;
    border: 1px solid #dee2e6;
    border-radius: 0.375rem;
}

.log-header {
    .log-title {
        font-weight: 600;
        font-size: 0.95rem;
    }
}

.log-container {
    background-color: #1a1a2e;
    border-radius: 0.375rem;
    height: 300px;
    overflow-y: auto;
    overflow-x: auto;
    padding: 0.75rem;
    position: relative;

    &::-webkit-scrollbar {
        width: 8px;
        height: 8px;
    }

    &::-webkit-scrollbar-track {
        background: #2d2d44;
        border-radius: 4px;
    }

    &::-webkit-scrollbar-thumb {
        background: #4a4a6a;
        border-radius: 4px;

        &:hover {
            background: #5a5a7a;
        }
    }
}

.log-content {
    margin: 0;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.82rem;
    line-height: 1.5;
    color: #e0e0e0;
    white-space: pre-wrap;
    word-break: break-all;

    code {
        font-family: inherit;
        background: none;
        padding: 0;
        color: inherit;
    }
}

.scroll-anchor {
    float: left;
    clear: both;
    width: 1px;
    height: 1px;
}
</style>
