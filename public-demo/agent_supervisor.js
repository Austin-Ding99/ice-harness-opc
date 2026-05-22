(function () {
    const STORAGE = {
        logs: 'opc_supervisor_logs_v1',
        tasks: 'opc_supervisor_tasks_v1',
        checkpoint: 'opc_supervisor_checkpoint_v1',
        health: 'opc_supervisor_health_v1'
    };
    const MAX_LOGS = 260;
    const MAX_TASKS = 80;
    const AGENTS = [
        '监理Agent',
        '实验监控与预警Agent',
        '数据提取与通道选择Agent',
        '表格清洗与云端同步Agent',
        '分析与报告Agent'
    ];

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function formatTime(ts) {
        try { return new Date(ts).toLocaleTimeString(); } catch (_) { return '--:--:--'; }
    }

    function summarizeError(error) {
        if (!error) return '未知异常';
        return error.message || String(error);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[c]));
    }

    function normalizeAgent(agent) {
        const name = String(agent || '监理Agent');
        if (name.includes('监控') || name.includes('预警')) return '实验监控与预警Agent';
        if (name.includes('提取') || name.includes('通道')) return '数据提取与通道选择Agent';
        if (name.includes('清洗') || name.includes('同步')) return '表格清洗与云端同步Agent';
        if (name.includes('分析') || name.includes('报告')) return '分析与报告Agent';
        if (name.includes('监理')) return '监理Agent';
        return name;
    }

    function makeId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    }

    const runtime = {
        logs: [],
        tasks: [],
        health: {},
        checkpointSnapshot: null,
        initDone: false,

        init() {
            this.logs = loadJSON(STORAGE.logs, []);
            this.tasks = loadJSON(STORAGE.tasks, []);
            this.health = loadJSON(STORAGE.health, {});
            this.checkpointSnapshot = loadJSON(STORAGE.checkpoint, null);
            AGENTS.forEach(agent => {
                if (!this.health[agent]) {
                    this.health[agent] = {
                        name: agent,
                        status: '待命',
                        detail: '等待任务',
                        lastSeen: null,
                        failures: 0
                    };
                }
            });
            this.initDone = true;
            this.updateHealth('监理Agent', '在线', '运行时接管任务台账、断点与健康巡检');
            this.renderAll();
            this.updateResumeButton();
            if (!this._timer) {
                this._timer = setInterval(() => {
                    this.markStaleAgents();
                    this.renderHealth();
                    this.updateResumeButton();
                }, 5000);
            }
        },

        persist() {
            saveJSON(STORAGE.logs, this.logs.slice(-MAX_LOGS));
            saveJSON(STORAGE.tasks, this.tasks.slice(-MAX_TASKS));
            saveJSON(STORAGE.health, this.health);
        },

        recordLog(agent, message, type = 'normal', codeRef = null) {
            const normalizedAgent = normalizeAgent(agent);
            const entry = {
                id: makeId('log'),
                ts: Date.now(),
                agent: normalizedAgent,
                message: String(message || '').replace(/<[^>]+>/g, '').slice(0, 300),
                type,
                codeRef
            };
            this.logs.push(entry);
            if (this.logs.length > MAX_LOGS) this.logs.shift();
            const isExpectedAlarm = normalizedAgent === '实验监控与预警Agent' && entry.message.includes('异常拦截');
            this.updateHealth(normalizedAgent, type === 'error' ? '异常' : '在线', entry.message.slice(0, 80), type === 'error' && !isExpectedAlarm);
            this.persist();
            this.renderLedger();
        },

        createTask({ title, agent = '监理Agent', type = 'workflow', payload = {}, maxRetries = 2 }) {
            const task = {
                id: makeId('task'),
                ts: Date.now(),
                updatedAt: Date.now(),
                title,
                type,
                agent: normalizeAgent(agent),
                status: '待执行',
                attempt: 0,
                maxRetries,
                payload,
                error: null,
                history: [{ ts: Date.now(), status: '待执行', detail: '任务已登记' }]
            };
            this.tasks.unshift(task);
            this.tasks = this.tasks.slice(0, MAX_TASKS);
            this.persist();
            this.renderLedger();
            return task.id;
        },

        updateTask(taskId, patch = {}) {
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;
            Object.assign(task, patch, { updatedAt: Date.now() });
            task.history = task.history || [];
            task.history.push({
                ts: Date.now(),
                status: task.status,
                detail: patch.detail || patch.error || ''
            });
            task.history = task.history.slice(-8);
            if (patch.status === '失败') this.updateHealth(task.agent, '异常', patch.error || '任务失败', true);
            else if (patch.status === '完成') this.updateHealth(task.agent, '在线', patch.detail || '任务完成');
            else this.updateHealth(task.agent, '运行中', patch.detail || task.title);
            this.persist();
            this.renderLedger();
        },

        async runWithRetry({ title, agent, type = 'workflow', maxRetries = 2, operation }) {
            const taskId = this.createTask({ title, agent, type, maxRetries });
            let attempt = 0;
            while (attempt <= maxRetries) {
                attempt += 1;
                this.updateTask(taskId, { status: '运行中', attempt, detail: `第 ${attempt} 次尝试` });
                try {
                    const result = await operation(attempt, taskId);
                    this.updateTask(taskId, { status: '完成', detail: '任务完成' });
                    return result;
                } catch (error) {
                    const msg = summarizeError(error);
                    if (attempt > maxRetries) {
                        this.updateTask(taskId, { status: '失败', error: msg, detail: msg });
                        throw error;
                    }
                    this.updateTask(taskId, { status: '重试中', error: msg, detail: `失败后准备重试：${msg}` });
                    await new Promise(resolve => setTimeout(resolve, 450 * attempt));
                }
            }
        },

        checkpoint(reason = '状态快照') {
            const monitor = window.monitorAgent || {};
            const chart = window.chartInstance;
            const power = window.powerChartInstance;
            const snapshot = {
                ts: Date.now(),
                reason,
                sourceName: window.currentSourceName || '',
                rawData: Array.isArray(window.rawData) ? window.rawData : [],
                currentIndex: window.currentIndex || 0,
                dynamicChannels: window.dynamicChannels || [],
                hasPower: !!window.hasPower,
                colIndices: window.colIndices || {},
                timeAxisSource: window.timeAxisSource || '',
                fullTimeLabels: Array.isArray(window.fullTimeLabels) ? window.fullTimeLabels : [],
                timeTick: monitor.timeTick || 0,
                tempRange: monitor.tempRange || { min: -70, max: 200 },
                activeFaults: monitor.activeFaults || {},
                hasTriggeredAlarm: !!monitor.hasTriggeredAlarm,
                chartHidden: chart ? chart.data.datasets.map(d => !!d.hidden) : [],
                powerHidden: power ? power.data.datasets.map(d => !!d.hidden) : [],
                speedValue: document.getElementById('speedSelect')?.value || '100'
            };
            try {
                saveJSON(STORAGE.checkpoint, snapshot);
                this.checkpointSnapshot = snapshot;
                this.recordLog('监理Agent', `断点已保存：${reason}，当前行 ${snapshot.currentIndex}/${snapshot.rawData.length}`, 'success', 'CHECKPOINT_SAVE');
            } catch (error) {
                this.recordLog('监理Agent', `断点保存失败：${summarizeError(error)}`, 'error', 'CHECKPOINT_SAVE');
            }
            this.updateResumeButton();
        },

        restoreCheckpoint() {
            const now = Date.now();
            if (this._lastRestoreAt && now - this._lastRestoreAt < 1200) return false;
            const snapshot = loadJSON(STORAGE.checkpoint, null);
            if (!snapshot || !snapshot.rawData || !snapshot.rawData.length) {
                window.logAgent?.('监理Agent', '没有可恢复的断点快照。', 'normal', 'CHECKPOINT_RESTORE');
                return false;
            }
            try {
                this._lastRestoreAt = now;
                if (window.monitorAgent?.timer) clearInterval(window.monitorAgent.timer);
                window.rawData = snapshot.rawData;
                window.currentIndex = 0;
                window.dynamicChannels = snapshot.dynamicChannels || [];
                window.hasPower = !!snapshot.hasPower;
                window.colIndices = snapshot.colIndices || {};
                window.timeAxisSource = snapshot.timeAxisSource || '';
                window.currentSourceName = snapshot.sourceName || '';
                window.fullTimeLabels = [];
                if (window.monitorAgent) {
                    window.monitorAgent.isRunning = false;
                    window.monitorAgent.timeTick = 0;
                    window.monitorAgent.tempRange = snapshot.tempRange || { min: -70, max: 200 };
                    window.monitorAgent.activeFaults = snapshot.activeFaults || {};
                    window.monitorAgent.hasTriggeredAlarm = !!snapshot.hasTriggeredAlarm;
                }
                if (typeof window.rebuildChartsAndUI === 'function') window.rebuildChartsAndUI();
                const restoreCount = Math.min(snapshot.currentIndex || 0, window.rawData.length);
                for (let i = 0; i < restoreCount; i++) {
                    if (window.monitorAgent) window.monitorAgent.timeTick += 1;
                    const row = { ...window.rawData[i] };
                    if (window.monitorAgent?.appendDataPoint) window.monitorAgent.appendDataPoint(row);
                }
                window.currentIndex = restoreCount;
                if (window.chartInstance && Array.isArray(snapshot.chartHidden)) {
                    snapshot.chartHidden.forEach((hidden, idx) => {
                        if (window.chartInstance.data.datasets[idx]) window.chartInstance.data.datasets[idx].hidden = hidden;
                    });
                }
                if (window.powerChartInstance && Array.isArray(snapshot.powerHidden)) {
                    snapshot.powerHidden.forEach((hidden, idx) => {
                        if (window.powerChartInstance.data.datasets[idx]) window.powerChartInstance.data.datasets[idx].hidden = hidden;
                    });
                }
                const speed = document.getElementById('speedSelect');
                if (speed && snapshot.speedValue) speed.value = snapshot.speedValue;
                window.setBtnSafe?.('btnStart', false);
                window.setBtnSafe?.('btnUpload', false);
                ['btnTestPause', 'btnComplete'].forEach(id => window.setBtnSafe?.(id, false));
                if (window.isAutoScroll && typeof window.setLatestChartWindow === 'function') window.setLatestChartWindow(false);
                else window.scheduleChartUpdate?.();
                window.logAgent?.('监理Agent', `已从断点恢复到第 ${restoreCount} 行。当前处于暂停态，点击【开始监控】后从该行继续。`, 'success', 'CHECKPOINT_RESTORE');
                this.updateHealth('监理Agent', '在线', `断点已载入：第 ${restoreCount} 行，等待继续`);
                return true;
            } catch (error) {
                window.logAgent?.('监理Agent', `断点恢复失败：${summarizeError(error)}`, 'error', 'CHECKPOINT_RESTORE');
                return false;
            }
        },

        clearRuntime() {
            localStorage.removeItem(STORAGE.logs);
            localStorage.removeItem(STORAGE.tasks);
            localStorage.removeItem(STORAGE.checkpoint);
            localStorage.removeItem(STORAGE.health);
            this.logs = [];
            this.tasks = [];
            this.checkpointSnapshot = null;
            this.health = {};
            AGENTS.forEach(agent => {
                this.health[agent] = {
                    name: agent,
                    status: '待命',
                    detail: '等待任务',
                    lastSeen: null,
                    failures: 0
                };
            });
            saveJSON(STORAGE.health, this.health);
            this.renderAll();
            this.updateResumeButton();
            window.logAgent?.('监理Agent', '已清空持久化任务台账、断点与Agent健康计数。', 'normal', 'SUPERVISOR_RUNTIME');
        },

        updateHealth(agent, status, detail, failed = false) {
            const name = normalizeAgent(agent);
            const current = this.health[name] || { name, failures: 0 };
            this.health[name] = {
                ...current,
                name,
                status,
                detail: String(detail || '').slice(0, 96),
                lastSeen: Date.now(),
                failures: (current.failures || 0) + (failed ? 1 : 0)
            };
            saveJSON(STORAGE.health, this.health);
            this.renderHealth();
        },

        resetAgentFailures(agent) {
            const name = normalizeAgent(agent);
            if (!this.health[name]) return;
            this.health[name].failures = 0;
            saveJSON(STORAGE.health, this.health);
            this.renderHealth();
        },

        markStaleAgents() {
            const now = Date.now();
            Object.values(this.health).forEach(h => {
                if (!h.lastSeen) return;
                if (h.status !== '异常' && now - h.lastSeen > 45000) {
                    h.status = '待命';
                    h.detail = '45秒无新事件，处于待命';
                }
            });
            saveJSON(STORAGE.health, this.health);
        },

        renderAll() {
            this.renderHealth();
            this.renderLedger();
        },

        renderHealth() {
            const grid = document.getElementById('agentHealthGrid');
            if (!grid) return;
            const order = AGENTS.filter(a => this.health[a]).concat(
                Object.keys(this.health).filter(a => !AGENTS.includes(a))
            );
            grid.innerHTML = order.map(agent => {
                const h = this.health[agent];
                const statusClass = h.status === '异常' ? 'bad' : (h.status === '运行中' ? 'busy' : 'ok');
                const seen = h.lastSeen ? formatTime(h.lastSeen) : '未启动';
                return `<div class="health-item ${statusClass}">
                    <div class="health-top"><span>${escapeHtml(agent)}</span><b>${escapeHtml(h.status)}</b></div>
                    <div class="health-detail" title="${escapeHtml(h.detail || '')}">${escapeHtml(h.detail || '等待任务')}</div>
                    <div class="health-foot">最近动作 ${seen} ｜异常计数 ${h.failures || 0}</div>
                    <button class="health-log-btn" data-agent="${escapeHtml(agent)}" onclick="window.supervisorAgent?.openAgentLogModal(this.dataset.agent)">查看日志</button>
                </div>`;
            }).join('');
        },

        openAgentLogModal(agent) {
            const title = document.getElementById('codeInspectorTitle');
            const body = document.getElementById('codeInspectorBody');
            const modal = document.getElementById('codeInspector');
            if (!title || !body || !modal) return;
            const logs = this.logs
                .filter(log => log.agent === agent)
                .slice(-80)
                .reverse();
            const tasks = this.tasks
                .filter(task => task.agent === agent)
                .slice(0, 12);
            const logText = logs.length
                ? logs.map(log => `[${formatTime(log.ts)}] [${log.type || 'normal'}] ${log.codeRef || 'NO_REF'}\n${log.message}`).join('\n\n')
                : '暂无该 Agent 的运行日志。';
            const taskText = tasks.length
                ? tasks.map(task => {
                    const history = (task.history || []).map(h => `  - ${formatTime(h.ts)} ${h.status}${h.detail ? `：${h.detail}` : ''}`).join('\n');
                    return `[任务] ${task.title}\n状态：${task.status}｜尝试：${task.attempt || 0}/${(task.maxRetries || 0) + 1}\n${history}`;
                }).join('\n\n')
                : '暂无该 Agent 的任务历史。';
            title.innerText = `Agent 运行日志 - ${agent}`;
            body.textContent = `【触发代码运行日志】\n${logText}\n\n【任务历史】\n${taskText}`;
            modal.classList.add('active');
        },

        renderLedger() {
            const panel = document.getElementById('taskLedgerList');
            if (!panel) return;
            const recent = this.tasks.slice(0, 6);
            if (!recent.length) {
                panel.innerHTML = '<div class="task-empty">暂无任务。导入数据、执行NL2Action或生成报告后会自动记录。</div>';
                return;
            }
            panel.innerHTML = recent.map(task => {
                const statusClass = task.status === '失败' ? 'bad' : (task.status === '完成' ? 'ok' : 'busy');
                const retry = task.maxRetries ? `${task.attempt || 0}/${task.maxRetries + 1}` : `${task.attempt || 0}`;
                return `<div class="task-row ${statusClass}">
                    <div class="task-main">
                        <span class="task-title">${task.title}</span>
                        <span class="task-meta">${task.agent} ｜${formatTime(task.updatedAt)} ｜尝试 ${retry}</span>
                    </div>
                    <span class="task-status">${task.status}</span>
                </div>`;
            }).join('');
        },

        updateResumeButton() {
            const btn = document.getElementById('btnRestoreCheckpoint');
            if (!btn) return;
            const snapshot = loadJSON(STORAGE.checkpoint, null);
            const available = !!(snapshot && snapshot.rawData && snapshot.rawData.length);
            btn.disabled = !available;
            btn.title = available
                ? `恢复 ${new Date(snapshot.ts).toLocaleString()} 保存的实验进度；恢复后会暂停，点击【开始监控】继续`
                : '暂无可恢复断点';
        }
    };

    window.supervisorAgent = runtime;
})();
