window.cleanerAgent = {
    isActive: false, startX: 0, endX: 0, isDragging: false, selectedSegments: [], mode: 'CLEAN',
    activate: function(mode = 'CLEAN') {
        if (!window.chartInstance || window.chartInstance.data.labels.length === 0) { alert("图表暂无数据，无法穿刺！"); return; }
        window.stopAutoScroll(); 
        this.isActive = true; this.selectedSegments = []; this.mode = mode;
        document.getElementById('selectionOverlay').style.display = 'block';
        
        // 我们已经在 executeNlCommand 里通过假日志通知了用户，这里就不重复啰嗦了
        if(mode !== 'REPORT') {
            window.logAgent('表格清洗与云端同步Agent', '接管视图控制权。请在图表上框选【感兴趣数据段】。', 'normal');
        }
        this.initEvents();
    },
    initEvents: function() {
        const overlay = document.getElementById('selectionOverlay');
        const box = document.getElementById('selectionBox');
        overlay.onmousedown = (e) => { this.isDragging = true; this.startX = e.offsetX; box.style.left = this.startX + 'px'; box.style.width = '0px'; box.style.display = 'block'; document.getElementById('agentToolbar').style.display = 'none'; };
        overlay.onmousemove = (e) => { if (!this.isDragging) return; const currentX = e.offsetX; box.style.left = Math.min(currentX, this.startX) + 'px'; box.style.width = Math.abs(currentX - this.startX) + 'px'; };
        overlay.onmouseup = (e) => { this.isDragging = false; this.endX = e.offsetX; if (Math.abs(this.endX - this.startX) > 10) document.getElementById('agentToolbar').style.display = 'block'; else box.style.display = 'none'; };
    },
    cancelSelection: function() {
        this.isActive = false;
        document.getElementById('selectionBox').style.display = 'none'; document.getElementById('selectionOverlay').style.display = 'none'; document.getElementById('agentToolbar').style.display = 'none';
        window.logAgent('超级个体', '发出指令：[按下 Esc 退出高精度框选模式]', 'normal');
    },
    reselect: function() { document.getElementById('selectionBox').style.display = 'none'; document.getElementById('agentToolbar').style.display = 'none'; },
    extractCurrentBox: function() {
        const xAxis = window.chartInstance.scales.x;
        const rawStartIndex = xAxis.getValueForPixel(Math.min(this.startX, this.endX));
        const rawEndIndex = xAxis.getValueForPixel(Math.max(this.startX, this.endX));
        if(rawStartIndex === undefined || rawEndIndex === undefined) return null;
        const startIndex = Math.floor(Math.min(rawStartIndex, rawEndIndex));
        const endIndex = Math.ceil(Math.max(rawStartIndex, rawEndIndex));
        let segmentData = [];
        for(let i = Math.max(0, startIndex); i <= Math.min(window.chartInstance.data.labels.length - 1, endIndex); i++) {
            let row = { '绝对时间': window.fullTimeLabels?.[i] || window.chartInstance.data.labels[i] };
            window.chartInstance.data.datasets.forEach((dataset, idx) => { if (window.chartInstance.isDatasetVisible(idx)) row[dataset.label] = dataset.data[i]; });
            if (window.hasPower && window.powerChartInstance && window.powerChartInstance.isDatasetVisible(0)) { row['功率'] = window.powerChartInstance.data.datasets[0].data[i]; }
            segmentData.push(row);
        }
        return segmentData;
    },
    continueSelect: function() {
        const seg = this.extractCurrentBox();
        if(seg) { this.selectedSegments.push(seg); window.logAgent('表格清洗与云端同步Agent', `【感兴趣数据段】 ${this.selectedSegments.length} 已切片。请继续框选。`, 'normal'); }
        document.getElementById('selectionBox').style.display = 'none'; document.getElementById('agentToolbar').style.display = 'none';
    },
    finishSelect: function() {
        const seg = this.extractCurrentBox();
        if(seg) this.selectedSegments.push(seg);
        document.getElementById('selectionOverlay').style.display = 'none'; document.getElementById('agentToolbar').style.display = 'none';
        this.isActive = false;
        
        // 🚀 核心升级：无论是手动清洗还是智能诊断，全部输送给 cloud_sheet.html
        window.logAgent('表格清洗与云端同步Agent', `捕获 ${this.selectedSegments.length} 个【感兴趣数据段】。移交至云端协同环境。`, 'normal');
        const sync = async () => {
            localStorage.setItem('opc_cloud_sync_data', JSON.stringify(this.selectedSegments));
            localStorage.setItem('opc_cloud_sync_id', String(Date.now()));
            ['opc_cloud_feature_markers_v11', 'opc_cloud_feature_markers_v10', 'opc_cloud_feature_markers_v9', 'opc_cloud_feature_markers_v8', 'opc_cloud_feature_markers_v7'].forEach(key => localStorage.removeItem(key));
        // 通过 localStorage 告诉新页面是不是要自动拉起 PPT 生成
            localStorage.setItem('opc_cloud_auto_ppt', this.mode === 'REPORT' ? 'true' : 'false');
        };
        const runner = window.supervisorAgent?.runWithRetry
            ? window.supervisorAgent.runWithRetry({
                title: `同步 ${this.selectedSegments.length} 个切片到云端Sheet`,
                agent: '表格清洗与云端同步Agent',
                type: 'cloud_sync',
                maxRetries: 2,
                operation: sync
            })
            : sync();
        Promise.resolve(runner).then(() => {
            window.supervisorAgent?.checkpoint('切片同步完成');
            setTimeout(() => window.open('cloud_sheet.html', '_blank'), 800);
        }).catch(error => {
            window.logAgent('表格清洗与云端同步Agent', `云端同步失败：${error.message}`, 'error', 'CLOUD_SYNC_RETRY');
        });
    }
};
