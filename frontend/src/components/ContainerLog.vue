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
                    {{ currentMatchIndex + 1 }} / {{ totalMatches }} matches
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
                            @keydown.enter="onSearchEnter"
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
                            :disabled="searching || currentMatchIndex <= 0"
                            @click="prevMatch"
                            :title="$t('previousMatch') || 'Previous Match'"
                        >
                            <font-awesome-icon :icon="searching ? 'spinner' : 'chevron-up'" :spin="searching" />
                        </button>
                        <span class="search-counter" style="font-size: 0.75rem; min-width: 50px; text-align: center;">
                            {{ totalMatches > 0 ? currentMatchIndex + 1 : 0 }} / {{ totalMatches }}
                        </span>
                        <button
                            class="btn btn-sm btn-normal"
                            :disabled="searching || currentMatchIndex >= totalMatches - 1"
                            @click="nextMatch"
                            :title="$t('nextMatch') || 'Next Match'"
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
                    @click="showLineNumbers = !showLineNumbers"
                    :title="showLineNumbers ? ($t('hideLineNumbers') || 'Hide Line Numbers') : ($t('showLineNumbers') || 'Show Line Numbers')"
                >
                    <font-awesome-icon icon="list-ol" />
                </button>
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
                    <font-awesome-icon icon="arrows-down-to-line" />
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
            <div ref="logContent" class="log-content">
                <template v-if="!searchKeyword">
                    <div
                        v-for="(line, index) in displayAllLines"
                        :key="'all-' + line.lineNumber"
                        class="log-line"
                        :ref="el => setLineRef('all', line.lineNumber, el)"
                    >
                        <span v-if="showLineNumbers" class="line-number">{{ line.lineNumber }}</span>
                        <span class="line-text">{{ line.text }}</span>
                    </div>
                </template>
                <template v-else>
                    <div
                        v-for="(line, index) in displaySearchLines"
                        :key="'search-' + line.lineNumber + '-' + index"
                        class="log-line"
                        :class="{ 'highlight': line.isMatch, 'current-match': line.isCurrentMatch }"
                        :ref="el => setLineRef('search', line.lineNumber, el)"
                    >
                        <span v-if="showLineNumbers" class="line-number">{{ line.lineNumber }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <span class="line-text" v-html="highlightKeyword(line.text)"></span>
                    </div>
                </template>
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
            allLines: [],
            displayAllLines: [],
            displaySearchLines: [],
            autoScroll: true,
            logReady: false,
            logName: "",
            selectedTail: 100,
            userScrolledUp: false,
            showLineNumbers: true,
            searchKeyword: "",
            currentMatchIndex: 0,
            totalMatches: 0,
            searching: false,
            debounceTimer: null,
            lineRefs: {
                all: {},
                search: {},
            },
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
        searchKeyword() {
            this.debouncedSearch();
        },
    },
    mounted() {
        this.connect();
    },
    beforeUnmount() {
        this.disconnect();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    },
    methods: {
        setLineRef(mode, lineNumber, el) {
            if (el) {
                if (!this.lineRefs[mode]) {
                    this.lineRefs[mode] = {};
                }
                this.lineRefs[mode][lineNumber] = el;
            }
        },

        escapeHtml(text) {
            const div = document.createElement("div");
            div.appendChild(document.createTextNode(text));
            return div.innerHTML;
        },

        highlightKeyword(text) {
            if (!this.searchKeyword) {
                return this.escapeHtml(text);
            }
            const escapedText = this.escapeHtml(text);
            const escapedKeyword = this.escapeHtml(this.searchKeyword);
            const regex = new RegExp(`(${escapedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
            return escapedText.replace(regex, '<span class="keyword-highlight">$1</span>');
        },

        async connect() {
            this.logReady = false;
            this.allLines = [];
            this.displayAllLines = [];
            this.displaySearchLines = [];
            this.currentMatchIndex = 0;
            this.totalMatches = 0;

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
                if (res.lines && res.lines.length > 0) {
                    this.allLines = res.lines.map((line) => ({
                        lineNumber: line.lineNumber,
                        text: line.text,
                    }));
                    this.displayAllLines = [...this.allLines];
                }
                this.$nextTick(() => this.scrollToBottom());
                this.logReady = true;
            } else {
                const errorLine = {
                    lineNumber: 1,
                    text: `[Error] ${res.msg || "Failed to connect to log stream"}`,
                };
                this.allLines = [ errorLine ];
                this.displayAllLines = [ errorLine ];
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
            const lines = data.split("\n");

            if (this.allLines.length === 0) {
                this.allLines = [];
            }

            let startLineNumber = 0;
            if (this.allLines.length > 0) {
                startLineNumber = this.allLines[this.allLines.length - 1].lineNumber;
            }

            for (const line of lines) {
                if (line !== "") {
                    startLineNumber++;
                    this.allLines.push({
                        lineNumber: startLineNumber,
                        text: line,
                    });
                }
            }

            const maxLines = this.selectedTail * 20;
            if (this.allLines.length > maxLines) {
                const removeCount = this.allLines.length - maxLines;
                this.allLines.splice(0, removeCount);
            }

            if (!this.searchKeyword) {
                this.displayAllLines = [...this.allLines];
                if (this.autoScroll && !this.userScrolledUp) {
                    this.$nextTick(() => this.scrollToBottom());
                }
            }
        },

        onExit() {
            this.logReady = false;
            this.writeLog("\n[Log stream disconnected]\n");
        },

        scrollToBottom() {
            if (this.$refs.scrollAnchor) {
                this.$refs.scrollAnchor.scrollIntoView({
                    behavior: "smooth",
                    block: "end",
                });
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
            this.allLines = [];
            this.displayAllLines = [];
            this.displaySearchLines = [];
            this.currentMatchIndex = 0;
            this.totalMatches = 0;
        },

        debouncedSearch() {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            if (!this.searchKeyword) {
                this.currentMatchIndex = 0;
                this.totalMatches = 0;
                this.displaySearchLines = [];
                return;
            }

            this.debounceTimer = setTimeout(() => {
                this.doSearch(0);
            }, 300);
        },

        onSearchEnter() {
            if (!this.searchKeyword) {
                return;
            }
            this.nextMatch();
        },

        async doSearch(offset) {
            if (!this.searchKeyword) {
                return;
            }

            this.searching = true;

            try {
                const res = await this.$root.searchContainerLog(
                    this.endpoint,
                    this.stackName,
                    this.serviceName,
                    this.searchKeyword,
                    offset,
                    100
                );

                if (res.ok) {
                    this.totalMatches = res.totalLines || 0;
                    this.currentMatchIndex = offset;

                    if (this.totalMatches > 0 && this.currentMatchIndex >= this.totalMatches) {
                        this.currentMatchIndex = 0;
                        if (offset !== 0) {
                            await this.doSearch(0);
                            return;
                        }
                    }

                    this.displaySearchLines = (res.matchedLines || []).map((line, index) => ({
                        lineNumber: line.lineNumber,
                        text: line.text,
                        isMatch: true,
                        isCurrentMatch: line.isCurrentMatch || (offset + index) === this.currentMatchIndex,
                    }));

                    this.$nextTick(() => {
                        this.scrollToCurrentMatch();
                    });
                } else {
                    this.totalMatches = 0;
                    this.displaySearchLines = [];
                }
            } catch (e) {
                this.totalMatches = 0;
                this.displaySearchLines = [];
            } finally {
                this.searching = false;
            }
        },

        clearSearch() {
            this.searchKeyword = "";
            this.currentMatchIndex = 0;
            this.totalMatches = 0;
            this.displaySearchLines = [];
            this.lineRefs.search = {};
        },

        async nextMatch() {
            if (!this.searchKeyword || this.searching || this.totalMatches === 0) {
                return;
            }

            let nextIndex = this.currentMatchIndex + 1;
            if (nextIndex >= this.totalMatches) {
                nextIndex = 0;
            }

            await this.doSearch(nextIndex);
        },

        async prevMatch() {
            if (!this.searchKeyword || this.searching || this.totalMatches === 0) {
                return;
            }

            let prevIndex = this.currentMatchIndex - 1;
            if (prevIndex < 0) {
                prevIndex = this.totalMatches - 1;
            }

            await this.doSearch(prevIndex);
        },

        scrollToCurrentMatch() {
            if (this.displaySearchLines.length === 0) {
                return;
            }

            const currentLine = this.displaySearchLines.find((line) => line.isCurrentMatch);
            if (!currentLine) {
                return;
            }

            const mode = this.searchKeyword ? "search" : "all";
            const lineEl = this.lineRefs[mode] && this.lineRefs[mode][currentLine.lineNumber];
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
