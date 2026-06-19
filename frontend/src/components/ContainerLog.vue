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
                <span v-if="searchKeyword" class="badge bg-info">
                    {{ filteredLines.length }} / {{ logLines.length }} lines
                </span>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <div class="search-box d-flex align-items-center">
                    <div class="input-group input-group-sm" style="width: 220px;">
                        <span class="input-group-text">
                            <font-awesome-icon icon="magnifying-glass" />
                        </span>
                        <input
                            v-model="searchKeyword"
                            type="text"
                            class="form-control form-control-sm"
                            :placeholder="$t('search') || 'Search...'"
                            @input="onSearchInput"
                        />
                        <button
                            v-if="searchKeyword"
                            class="btn btn-outline-secondary btn-sm"
                            type="button"
                            @click="clearSearch"
                        >
                            <font-awesome-icon icon="xmark" />
                        </button>
                    </div>
                    <div v-if="searchKeyword" class="search-nav ms-2 d-flex align-items-center gap-1">
                        <button
                            class="btn btn-sm btn-normal"
                            :disabled="currentMatchIndex <= 0"
                            :title="$t('previousMatch') || 'Previous Match'"
                            @click="prevMatch"
                        >
                            <font-awesome-icon icon="chevron-up" />
                        </button>
                        <span class="search-counter" style="font-size: 0.75rem; min-width: 50px; text-align: center;">
                            {{ filteredLines.length > 0 ? currentMatchIndex + 1 : 0 }} / {{ filteredLines.length }}
                        </span>
                        <button
                            class="btn btn-sm btn-normal"
                            :disabled="currentMatchIndex >= filteredLines.length - 1"
                            :title="$t('nextMatch') || 'Next Match'"
                            @click="nextMatch"
                        >
                            <font-awesome-icon icon="chevron-down" />
                        </button>
                    </div>
                </div>
                <label class="form-label mb-0 me-1" style="font-size: 0.85rem;">
                    {{ $t("tailLines") || "Tail" }}:
                </label>
                <select
                    v-model="selectedTail"
                    class="form-select form-select-sm"
                    style="width: auto;"
                    :disabled="logReady"
                >
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                    <option :value="200">200</option>
                    <option :value="500">500</option>
                    <option :value="1000">1000</option>
                </select>
                <button
                    class="btn btn-sm"
                    :class="showLineNumbers ? 'btn-primary' : 'btn-normal'"
                    :title="showLineNumbers ? ($t('hideLineNumbers') || 'Hide Line Numbers') : ($t('showLineNumbers') || 'Show Line Numbers')"
                    @click="showLineNumbers = !showLineNumbers"
                >
                    <font-awesome-icon icon="list-ol" />
                </button>
                <button
                    class="btn btn-sm btn-normal"
                    :disabled="!autoScroll"
                    :title="$t('scrollToBottom') || 'Scroll to Bottom'"
                    @click="scrollToBottom"
                >
                    <font-awesome-icon icon="angles-down" />
                </button>
                <button
                    class="btn btn-sm"
                    :class="autoScroll ? 'btn-primary' : 'btn-normal'"
                    :title="autoScroll ? ($t('disableAutoScroll') || 'Disable Auto Scroll') : ($t('enableAutoScroll') || 'Enable Auto Scroll')"
                    @click="autoScroll = !autoScroll"
                >
                    <font-awesome-icon icon="arrows-down-to-line" />
                </button>
                <button
                    class="btn btn-sm btn-normal"
                    :title="$t('clearLog') || 'Clear Log'"
                    @click="clearLog"
                >
                    <font-awesome-icon icon="eraser" />
                </button>
            </div>
        </div>
        <div ref="logContainer" class="log-container" @scroll="onScroll">
            <div ref="logContent" class="log-content">
                <div
                    v-for="(line, index) in displayLines"
                    :key="index"
                    :ref="el => setLineRef(line.originalIndex, el)"
                    class="log-line"
                    :class="{ 'highlight': line.isMatch, 'current-match': line.isCurrentMatch }"
                >
                    <span v-if="showLineNumbers" class="line-number">{{ line.lineNumber }}</span>
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <span class="line-text" v-html="line.highlightedText"></span>
                </div>
            </div>
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
            showLineNumbers: true,
            searchKeyword: "",
            currentMatchIndex: 0,
            lineRefs: {},
        };
    },
    computed: {
        logLines() {
            if (!this.logText) {
                return [];
            }
            const lines = this.logText.split("\n");
            if (lines.length > 0 && lines[lines.length - 1] === "") {
                lines.pop();
            }
            return lines;
        },
        filteredLines() {
            if (!this.searchKeyword) {
                return this.logLines.map((text, index) => {
                    return {
                        text,
                        originalIndex: index,
                        lineNumber: index + 1,
                        isMatch: false,
                        isCurrentMatch: false,
                        highlightedText: this.escapeHtml(text),
                    };
                });
            }

            const keyword = this.searchKeyword.toLowerCase();
            const result = [];
            let matchCount = 0;

            this.logLines.forEach((text, index) => {
                if (text.toLowerCase().includes(keyword)) {
                    const isCurrentMatch = matchCount === this.currentMatchIndex;
                    result.push({
                        text,
                        originalIndex: index,
                        lineNumber: index + 1,
                        isMatch: true,
                        isCurrentMatch: isCurrentMatch,
                        highlightedText: this.highlightKeyword(text, this.searchKeyword),
                    });
                    matchCount++;
                }
            });

            return result;
        },
        displayLines() {
            if (!this.searchKeyword) {
                return this.logLines.map((text, index) => {
                    return {
                        text,
                        originalIndex: index,
                        lineNumber: index + 1,
                        isMatch: false,
                        isCurrentMatch: false,
                        highlightedText: this.escapeHtml(text),
                    };
                });
            }
            return this.filteredLines;
        },
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
        searchKeyword() {
            this.currentMatchIndex = 0;
            if (this.searchKeyword && this.filteredLines.length > 0) {
                this.$nextTick(() => {
                    this.scrollToCurrentMatch();
                });
            }
        },
    },
    mounted() {
        this.connect();
    },
    beforeUnmount() {
        this.disconnect();
    },
    methods: {
        setLineRef(index, el) {
            if (el) {
                this.lineRefs[index] = el;
            }
        },

        escapeHtml(text) {
            const div = document.createElement("div");
            div.appendChild(document.createTextNode(text));
            return div.innerHTML;
        },

        highlightKeyword(text, keyword) {
            if (!keyword) {
                return this.escapeHtml(text);
            }
            const escapedText = this.escapeHtml(text);
            const escapedKeyword = this.escapeHtml(keyword);
            const regex = new RegExp(`(${escapedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
            return escapedText.replace(regex, "<span class=\"keyword-highlight\">$1</span>");
        },

        async connect() {
            this.logReady = false;
            this.logText = "";
            this.currentMatchIndex = 0;

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

            if (this.autoScroll && !this.userScrolledUp && !this.searchKeyword) {
                this.$nextTick(() => this.scrollToBottom());
            }
        },

        onExit() {
            this.logReady = false;
            this.logText += "\n[Log stream disconnected]\n";
        },

        scrollToBottom() {
            if (this.$refs.scrollAnchor) {
                this.$refs.scrollAnchor.scrollIntoView({ behavior: "smooth",
                    block: "end" });
            }
            this.userScrolledUp = false;
        },

        onScroll() {
            const container = this.$refs.logContainer;
            if (!container) {
                return;
            }

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
            this.currentMatchIndex = 0;
        },

        onSearchInput() {
            // Reset current match index when searching
        },

        clearSearch() {
            this.searchKeyword = "";
            this.currentMatchIndex = 0;
        },

        nextMatch() {
            if (this.currentMatchIndex < this.filteredLines.length - 1) {
                this.currentMatchIndex++;
                this.$nextTick(() => {
                    this.scrollToCurrentMatch();
                });
            }
        },

        prevMatch() {
            if (this.currentMatchIndex > 0) {
                this.currentMatchIndex--;
                this.$nextTick(() => {
                    this.scrollToCurrentMatch();
                });
            }
        },

        scrollToCurrentMatch() {
            if (this.filteredLines.length === 0) {
                return;
            }

            const currentLine = this.filteredLines[this.currentMatchIndex];
            if (!currentLine) {
                return;
            }

            const lineEl = this.lineRefs[currentLine.originalIndex];
            if (lineEl && lineEl[0]) {
                const container = this.$refs.logContainer;
                if (container) {
                    const lineTop = lineEl[0].offsetTop;
                    const containerHeight = container.clientHeight;
                    container.scrollTop = lineTop - containerHeight / 2 + lineEl[0].offsetHeight / 2;
                }
            }
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

    .search-box {
        .search-counter {
            color: #6c757d;
            font-family: monospace;
        }
    }
}

.log-container {
    background-color: #1a1a2e;
    border-radius: 0.375rem;
    height: 300px;
    overflow-y: auto;
    overflow-x: auto;
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
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.82rem;
    line-height: 1.5;
    color: #e0e0e0;
    padding: 0.75rem;
}

.log-line {
    display: flex;
    align-items: flex-start;
    white-space: pre-wrap;
    word-break: break-all;

    &.highlight {
        background-color: rgba(255, 215, 0, 0.15);
    }

    &.current-match {
        background-color: rgba(255, 215, 0, 0.3);

        .line-text {
            .keyword-highlight {
                background-color: #ffd700;
                color: #1a1a2e;
                font-weight: bold;
            }
        }
    }

    .line-number {
        display: inline-block;
        min-width: 3rem;
        padding-right: 1rem;
        text-align: right;
        color: #6c757d;
        user-select: none;
        border-right: 1px solid #2d2d44;
        margin-right: 0.75rem;
        flex-shrink: 0;
        font-family: inherit;
    }

    .line-text {
        flex: 1;
        font-family: inherit;

        .keyword-highlight {
            background-color: rgba(255, 215, 0, 0.6);
            color: #1a1a2e;
            padding: 0 2px;
            border-radius: 2px;
        }
    }
}

.scroll-anchor {
    float: left;
    clear: both;
    width: 1px;
    height: 1px;
}
</style>
