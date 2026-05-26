window.monitorAgent = {
    isRunning: false, timer: null, activeFaults: {}, hasTriggeredAlarm: false, timeTick: 0, isVisualPaused: false,
    tempRange: { min: -70, max: 200 },
    start: function() {
        if (!window.rawData || !window.rawData.length) return;
        this.isRunning = true; window.setBtnSafe('btnStart', true); window.setBtnSafe('btnUpload', true);
        window.supervisorAgent?.updateHealth('实验监控与预警Agent', '运行中', '实时数据流监控已启动');
        window.supervisorAgent?.checkpoint('监控启动');
        const analyzeBtn = document.getElementById('btnAnalyze'); if (analyzeBtn) analyzeBtn.style.display = 'none';
        ['btnTestPause','btnComplete'].forEach(id => window.setBtnSafe(id, false));
        if(window.logAgent) window.logAgent('实验监控与预警Agent', `7x24小时监控启动。实时界限巡检[${this.tempRange.min}℃, ${this.tempRange.max}℃]已开启。`, 'normal');
        this.syncSpeed();
    },
    syncSpeed: function() {
        if (this.isRunning) {
            if (this.timer) clearInterval(this.timer);
            const speed = parseInt(document.getElementById('speedSelect').value);
            this.timer = setInterval(() => this.tick(), speed);
        }
    },
    togglePause: function() {
        const btn = document.getElementById('btnTestPause'); if (!btn) return;
        if (this.isRunning) { this.isRunning = false; clearInterval(this.timer); btn.innerText = "▶ 继续试验"; btn.className = "warning"; } 
        else { this.isRunning = true; btn.innerText = "⏸ 暂停"; btn.className = ""; this.syncSpeed(); }
    },
    setRange: function(min, max) {
        this.tempRange.min = min; this.tempRange.max = max;
        if(window.logAgent) window.logAgent('实验监控与预警Agent', `调整温度范围成功，当前法则更新为 [${min}℃, ${max}℃]。`, 'success');
        this.checkAndClearAlarm();
    },
    triggerFault: function(channel, value) {
        const matchedChannel = window.dynamicChannels.find(c => c.name.includes(channel) || c.id === channel);
        if (matchedChannel) { this.activeFaults[matchedChannel.id] = value !== null && !isNaN(value) ? parseFloat(value) : 3000; this.hasTriggeredAlarm = false; }
    },
    acknowledge: function() {
        document.getElementById('btnFixFault').style.display = 'inline-block';
        if(window.logAgent) window.logAgent('超级个体', `指令：[我已知晓(带病运行)]`, 'normal');
    },
    resolve: function() {
        document.getElementById('btnFixFault').style.display = 'none'; this.hasTriggeredAlarm = false;
        this.activeFaults = {}; const min = this.tempRange.min; const max = this.tempRange.max;
        let erasedCount = 0;
        window.dynamicChannels.forEach((ch, chIdx) => {
            const dataArray = window.chartInstance?.data?.datasets?.[chIdx]?.data;
            if (dataArray) { for(let i = 0; i < dataArray.length; i++) { if(dataArray[i] !== null && (dataArray[i] < min || dataArray[i] > max)) { dataArray[i] = null; erasedCount++; } } }
            // 只剔除已经加载到图表中的当前监控数据，不回写 rawData，避免后续数据流被提前清理。
        });
        if(window.logAgent) window.logAgent('实验监控与预警Agent', `当前可视范围内已剔除 ${erasedCount} 个坏点，警报闭环解除。`, 'success');
        if (!this.isVisualPaused && window.scheduleChartUpdate) window.scheduleChartUpdate();
        else if (!this.isVisualPaused && window.chartInstance) window.chartInstance.update('none');
    },
    checkAndClearAlarm: function() {
        if (!this.hasTriggeredAlarm) return;
        let currentVisibleAnomaly = false; const min = this.tempRange.min; const max = this.tempRange.max;
        window.dynamicChannels.forEach((ch, idx) => {
            if (window.chartInstance?.isDatasetVisible(idx)) {
                const dataArr = window.chartInstance.data.datasets[idx].data;
                if (dataArr.some(val => val !== null && val !== undefined && (val < min || val > max))) currentVisibleAnomaly = true;
            }
        });
        if (!currentVisibleAnomaly) {
            this.hasTriggeredAlarm = false; document.getElementById('btnFixFault').style.display = 'none';
            if(window.logAgent) window.logAgent('实验监控与预警Agent', '可视范围内无坏点，警报闭环解除。', 'success');
        }
    },
    complete: function(autoEnd = false) {
        this.isRunning = false;
        if (this.timer) clearInterval(this.timer);
        ['btnTestPause','btnComplete'].forEach(id => window.setBtnSafe(id, true));
        const pauseBtn = document.getElementById('btnTestPause');
        if (pauseBtn) { pauseBtn.innerText = '▶ 继续试验'; pauseBtn.className = 'warning'; }
        const analyzeBtn = document.getElementById('btnAnalyze');
        if (analyzeBtn) analyzeBtn.style.display = 'inline-block';
        const msg = '试验完成。右上角【数据分析】已就绪，可框选感兴趣数据段并生成报告。';
        if(window.logAgent) window.logAgent('监理Agent', msg, 'normal', autoEnd ? 'AUTO_COMPLETE' : 'CMD_COMPLETE');
        window.supervisorAgent?.checkpoint(autoEnd ? '数据流自动完成' : '实验完成');
    },
    appendDataPoint: function(data) {
        let fallbackLabel = data['绝对时间'];
        if (!fallbackLabel) {
            let totalSec = this.timeTick * 30;
            let mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
            let ss = (totalSec % 60).toFixed(1).padStart(4, '0');
            fallbackLabel = `${mm}:${ss}`;
        }
        const timeLabels = window.buildChartTimeLabels
            ? window.buildChartTimeLabels(data, fallbackLabel)
            : { fullLabel: fallbackLabel, axisLabel: fallbackLabel };
        Object.keys(this.activeFaults).forEach(ch => { data[ch] = this.activeFaults[ch]; });
        if(window.chartInstance?.data?.labels) {
            if (window.pushChartTimeLabel) window.pushChartTimeLabel(window.chartInstance, timeLabels.fullLabel, timeLabels.axisLabel);
            else window.chartInstance.data.labels.push(timeLabels.axisLabel);
        }
        let anomalyDetected = null; const min = this.tempRange.min; const max = this.tempRange.max;
        window.dynamicChannels.forEach((ch, idx) => {
            let val = data[ch.id];
            if(window.chartInstance?.data?.datasets?.[idx]?.data) {
                window.chartInstance.data.datasets[idx].data.push(val);
                if (val !== null && (val < min || val > max) && window.chartInstance.isDatasetVisible(idx)) anomalyDetected = anomalyDetected || { channel: ch.name, value: val };
            }
        });
        if (window.hasPower && window.powerChartInstance?.data?.datasets?.[0]) {
            window.powerChartInstance.data.labels.push(timeLabels.axisLabel);
            window.powerChartInstance.data.datasets[0].data.push(data['功率']);
        }
        return anomalyDetected;
    },
    trimHistoryIfNeeded: function() {
        if (window.chartInstance?.data?.labels?.length > window.MAX_HISTORY) {
            window.chartInstance.data.labels.shift(); window.chartInstance.data.datasets.forEach(d => d.data.shift());
            if (Array.isArray(window.fullTimeLabels)) window.fullTimeLabels.shift();
            if (window.hasPower && window.powerChartInstance) { window.powerChartInstance.data.labels.shift(); window.powerChartInstance.data.datasets[0].data.shift(); }
        }
    },
    loadAllRemaining: function() {
        if (!window.rawData || !window.rawData.length) return;
        if (this.timer) clearInterval(this.timer);
        this.isRunning = false;
        const pauseBtn = document.getElementById('btnTestPause');
        if (pauseBtn) { pauseBtn.innerText = '▶ 继续试验'; pauseBtn.className = 'warning'; }
        window.MAX_HISTORY = Math.max(window.MAX_HISTORY || 5000, window.rawData.length);
        let loaded = 0;
        let firstAnomaly = null;
        while (window.currentIndex < window.rawData.length) {
            this.timeTick++;
            const data = { ...window.rawData[window.currentIndex++] };
            const anomaly = this.appendDataPoint(data);
            if (anomaly && !firstAnomaly) firstAnomaly = anomaly;
            loaded++;
        }
        if (window.isAutoScroll && typeof window.setLatestChartWindow === 'function') window.setLatestChartWindow(false);
        if (window.scheduleChartUpdate) window.scheduleChartUpdate();
        else if (window.chartInstance) { window.chartInstance.update('none'); if (window.powerChartInstance) window.powerChartInstance.update('none'); }
        const analyzeBtn = document.getElementById('btnAnalyze');
        if (analyzeBtn) analyzeBtn.style.display = 'inline-block';
        if (firstAnomaly) {
            this.hasTriggeredAlarm = true;
            const fixBtn = document.getElementById('btnFixFault'); if (fixBtn) fixBtn.style.display = 'inline-block';
            if(window.logAgent) window.logAgent('实验监控与预警Agent', `[🚨 异常拦截] 一次性加载中识别到 [${firstAnomaly.channel}] 出现超限坏点 (${firstAnomaly.value}℃)！已推送强预警。`, 'error');
        }
        if(window.logAgent) window.logAgent('实验监控与预警Agent', `一次性加载全部剩余数据完成，新增 ${loaded} 行。`, 'success', 'LOAD_ALL_DATA');
        window.supervisorAgent?.checkpoint('一次性加载全部数据');
        this.complete(true);
    },
    tick: function() {
        if (!this.isRunning) return;
        if (!window.rawData || !window.rawData.length) return;
        if (window.currentIndex >= window.rawData.length) {
            this.complete(true);
            return;
        }
        this.timeTick++;
        let data = {...window.rawData[window.currentIndex++]};
        let label = data['绝对时间'];
        if (!label) { let totalSec = this.timeTick * 30; let mm = Math.floor(totalSec / 60).toString().padStart(2, '0'); let ss = (totalSec % 60).toFixed(1).padStart(4, '0'); label = `${mm}:${ss}`; }
        const timeLabels = window.buildChartTimeLabels
            ? window.buildChartTimeLabels(data, label)
            : { fullLabel: label, axisLabel: label };

        Object.keys(this.activeFaults).forEach(ch => { data[ch] = this.activeFaults[ch]; });
        if(window.chartInstance?.data?.labels) {
            if (window.pushChartTimeLabel) window.pushChartTimeLabel(window.chartInstance, timeLabels.fullLabel, timeLabels.axisLabel);
            else window.chartInstance.data.labels.push(timeLabels.axisLabel);
        }
        let anomalyDetected = null; const min = this.tempRange.min; const max = this.tempRange.max;

        window.dynamicChannels.forEach((ch, idx) => { 
            let val = data[ch.id];
            if(window.chartInstance?.data?.datasets?.[idx]?.data) {
                window.chartInstance.data.datasets[idx].data.push(val); 
                if (val !== null && (val < min || val > max)) { if (window.chartInstance.isDatasetVisible(idx)) anomalyDetected = { channel: ch.name, value: val }; }
            }
        });
        if (window.hasPower && window.powerChartInstance?.data?.datasets?.[0]) { window.powerChartInstance.data.labels.push(timeLabels.axisLabel); window.powerChartInstance.data.datasets[0].data.push(data['功率']); }

        if (window.chartInstance?.data?.labels?.length > window.MAX_HISTORY) {
            window.chartInstance.data.labels.shift(); window.chartInstance.data.datasets.forEach(d => d.data.shift());
            if (Array.isArray(window.fullTimeLabels)) window.fullTimeLabels.shift();
            if (window.hasPower && window.powerChartInstance) { window.powerChartInstance.data.labels.shift(); window.powerChartInstance.data.datasets[0].data.shift(); }
        }

        if (!this.isVisualPaused && window.chartInstance) {
            if (window.isAutoScroll && typeof window.setLatestChartWindow === 'function') {
                window.setLatestChartWindow(true);
            } else if (!window.isAutoScroll && typeof window.applyChartWindow === 'function') {
                const len = window.chartInstance.data.labels.length;
                const start = Math.max(0, Math.min(window.viewStartIndex || 0, len - 1));
                const end = Math.max(start, Math.min(window.viewEndIndex ?? (len - 1), len - 1));
                window.applyChartWindow(start, end, true);
            } else {
                window.chartInstance.update('none');
                if (window.hasPower && window.powerChartInstance) window.powerChartInstance.update('none');
            }
        }

        if (anomalyDetected && !this.hasTriggeredAlarm) {
            this.hasTriggeredAlarm = true; 
            if(window.logAgent) window.logAgent('实验监控与预警Agent', `[🚨 异常拦截] 识别到 [${anomalyDetected.channel}] 出现超限坏点 (${anomalyDetected.value}℃)！已推送强预警。`, 'error');
            document.getElementById('btnFixFault').style.display = 'inline-block';
        }

        if (window.currentIndex >= window.rawData.length) {
            this.complete(true);
        } else if (window.currentIndex % 25 === 0) {
            if (window.logAgent) window.logAgent('实验监控与预警Agent', `持续巡检写入中：已滚动 ${window.currentIndex}/${window.rawData.length} 行，最新时间 ${timeLabels.axisLabel}。`, 'normal', 'MONITOR_AGENT_CORE');
            window.supervisorAgent?.checkpoint('监控滚动自动快照');
        }
    }
};
