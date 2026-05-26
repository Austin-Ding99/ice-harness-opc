window.dataExtractorAgent = {
    handleFileUpload: function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                await window.dataExtractorAgent.processCSVText(e.target.result, file.name);
            } catch (error) {
                window.logAgent?.('数据提取与通道选择Agent', `文件解析异常：${error.message}`, 'error', 'DATA_EXTRACTOR_PARSE');
            }
        };
        reader.readAsText(file, 'GBK');
        event.target.value = '';
    },

    normalizeHeader: function(value) {
        return String(value ?? '').replace(/^\uFEFF/, '').trim().replace(/^"|"$/g, '').trim();
    },

    detectDelimiter: function(line) {
        const candidates = ['\t', ',', ';'];
        let best = '\t';
        let bestCount = 0;
        candidates.forEach(d => {
            const count = line.split(d).length;
            if (count > bestCount) { bestCount = count; best = d; }
        });
        return best;
    },

    splitLine: function(line, delimiter) {
        // 当前实验数据多为 TSV/CSV，先保持轻量解析；去除包裹双引号与 BOM。
        return line.split(delimiter).map(s => this.normalizeHeader(s));
    },

    isTimeHeader: function(header) {
        const h = this.normalizeHeader(header);
        const lower = h.toLowerCase();
        return h === '绝对时间' || h === '相对时间' || h === '时间' || lower === 'time';
    },

    timeValueScore: function(value) {
        const raw = this.normalizeHeader(value);
        if (!raw) return 0;
        if (/\d{2,4}[-/年]?\d{1,2}[-/月]?\d{1,2}.*\d{1,2}:?\d{2}:?\d{2}/.test(raw)) return 120;
        if (/\d{6,8}\s+\d{6}/.test(raw)) return 115;
        if (/\d{1,2}:\d{2}(?::\d{2})?/.test(raw)) return 80;
        if (/^\d{6}$/.test(raw)) return 55;
        if (/^\d+(?:\.\d+)?$/.test(raw)) return 20;
        return 0;
    },

    chooseTimeIndexBySamples: function(headerRow, rows = [], delimiter = '\t') {
        const candidates = headerRow
            .map((h, i) => ({ name: this.normalizeHeader(h), index: i }))
            .filter(col => this.isTimeHeader(col.name));
        if (!candidates.length) return -1;
        let best = { index: -1, score: -1 };
        candidates.forEach(col => {
            let score = 0;
            if (col.name === '绝对时间') score += 16;
            if (col.name.toLowerCase() === 'time') score += 12;
            if (col.name === '时间') score += 10;
            if (col.name === '相对时间') score += 2;
            rows.slice(0, 8).forEach(line => {
                const parts = this.splitLine(line, delimiter);
                score += this.timeValueScore(parts[col.index]);
            });
            if (score > best.score) best = { index: col.index, score };
        });
        return best.index;
    },

    isExcludedColumn: function(header) {
        const h = this.normalizeHeader(header);
        const lower = h.toLowerCase();
        const excluded = [
            'record #', 'record', '序号', '编号',
            '时间', 'time', '相对时间', '绝对时间',
            '功率因数', '环境湿度', '干球', '电压', '电流', '电量', '频率'
        ];
        return excluded.includes(h) || excluded.includes(lower);
    },

    chooseTimeIndex: function(headerRow) {
        const normalized = headerRow.map(h => this.normalizeHeader(h));
        const priority = ['绝对时间', 'Time', 'time', '时间', '相对时间'];
        for (const key of priority) {
            const idx = normalized.findIndex(h => h === key || h.toLowerCase() === key.toLowerCase());
            if (idx !== -1) return idx;
        }
        return normalized.findIndex(h => this.isTimeHeader(h));
    },

    inferTemperatureColumns: function(headerRow, timeIdx, powerName = '') {
        const powerKey = this.normalizeHeader(powerName).toLowerCase();
        return headerRow
            .map((h, i) => ({ name: this.normalizeHeader(h), index: i }))
            .filter(col => col.name && col.index !== timeIdx)
            .filter(col => {
                const lower = col.name.toLowerCase();
                if (powerKey && lower === powerKey) return false;
                if (this.isExcludedColumn(col.name)) return false;
                if (col.name.includes('功率') || lower === 'power') return false;
                return true;
            })
            .map(col => col.name);
    },

    choosePowerIndex: function(headerRow) {
        return headerRow.findIndex(h => {
            const name = this.normalizeHeader(h);
            const lower = name.toLowerCase();
            if (!name || name.includes('功率因数')) return false;
            return name.includes('功率') || lower === 'power' || lower.includes('power');
        });
    },

    looksLikeHeader: function(parts) {
        if (!parts || parts.length < 3) return false;
        const timeIdx = this.chooseTimeIndex(parts);
        if (timeIdx === -1) return false;

        // 时间列后面至少要有 2 个非排除字段，避免误把说明行识别为表头。
        let channelCount = 0;
        for (let i = timeIdx + 1; i < parts.length; i++) {
            const h = this.normalizeHeader(parts[i]);
            if (h && !this.isExcludedColumn(h)) channelCount++;
        }
        return channelCount >= 2;
    },

    findColumnIndex: function(headerRow, name) {
        if (!name) return -1;
        const target = this.normalizeHeader(name).toLowerCase();
        return headerRow.findIndex(h => {
            const current = this.normalizeHeader(h);
            return current === name || current.toLowerCase() === target;
        });
    },

    parseHeaderSchemaResponse: function(result) {
        const message = result?.choices?.[0]?.message || {};
        const rawArgs = message.tool_calls?.[0]?.function?.arguments || message.function_call?.arguments || '';
        if (rawArgs) return JSON.parse(rawArgs);

        // Some compatible gateways ignore tool_choice and return JSON text instead.
        // Accept it so the AI path remains usable instead of immediately falling back.
        const content = String(message.content || '').trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```$/i, '')
            .trim();
        if (content && content.startsWith('{')) return JSON.parse(content);
        throw new Error('模型未返回表头函数参数');
    },

    maskApiKey: function(apiKey) {
        const raw = String(apiKey || '');
        if (raw.length <= 8) return '***';
        return `${raw.slice(0, 3)}***${raw.slice(-4)}`;
    },

    summarizeHeaderArgs: function(args) {
        return JSON.stringify({
            header_row_index: args?.header_row_index,
            time_column: args?.time_column || '',
            temperature_columns_count: Array.isArray(args?.temperature_columns) ? args.temperature_columns.length : 0,
            power_column: args?.power_column || '',
            reason: args?.reason || ''
        });
    },

    inferHeaderWithFunctionCalling: async function(lines, sourceName) {
        const apiKey = document.getElementById('deepseekApiKey')?.value?.trim() || localStorage.getItem('opc_api_key') || '';
        const llmTaskId = window.supervisorAgent?.createTask?.({
            title: `LLM表头识别 ${sourceName || 'CSV/TSV'}`,
            agent: '表格清洗与云端同步Agent',
            type: 'llm_header_schema',
            maxRetries: 1
        });
        if (!apiKey) {
            window.logAgent?.('表格清洗与云端同步Agent', '未检测到 DeepSeek API Key，CSV 表头识别使用本地规则兜底。', 'normal', 'AI_HEADER_FALLBACK');
            window.supervisorAgent?.updateTask(llmTaskId, { status: '失败', error: '未配置 DeepSeek API Key' });
            return null;
        }
        const sampleLines = lines.slice(0, 40);
        const tools = [{
            type: 'function',
            function: {
                name: 'submit_csv_header_schema',
                description: '识别实验CSV/TSV前40行中的表头、时间列、温度监控列和功率列。',
                parameters: {
                    type: 'object',
                    properties: {
                        header_row_index: { type: 'integer', description: '表头在前40行中的0基索引' },
                        time_column: { type: 'string', description: '作为横轴的时间列名' },
                        temperature_columns: { type: 'array', items: { type: 'string' }, description: '作为温度监控纵轴的列名' },
                        power_column: { type: 'string', description: '功率列名，没有则为空字符串' },
                        reason: { type: 'string', description: '简短判断理由' }
                    },
                    required: ['header_row_index', 'time_column', 'temperature_columns']
                }
            }
        }];
        try {
            window.supervisorAgent?.updateHealth('表格清洗与云端同步Agent', '运行中', 'Function Calling 识别CSV表头');
            window.supervisorAgent?.updateTask(llmTaskId, { status: '运行中', attempt: 1, detail: '构造 DeepSeek Function Calling 请求' });
            const messages = [
                {
                    role: 'system',
                    content: '你是工业实验数据表格清洗Agent。只根据用户提供的CSV/TSV前40行，调用函数返回表头行、时间列、温度传感器列、功率列。绝对时间、相对时间、时间、Time、time 都是合法时间列。不要把Record/序号/电压/电流/湿度/频率/功率因数当成温度列。'
                },
                {
                    role: 'user',
                    content: `文件名：${sourceName || 'unknown'}\n前40行如下，行号从0开始：\n${sampleLines.map((line, idx) => `${idx}: ${line}`).join('\n')}`
                }
            ];
            const requestBodies = [
                {
                    model: 'deepseek-chat',
                    temperature: 0,
                    messages,
                    tools,
                    tool_choice: { type: 'function', function: { name: 'submit_csv_header_schema' } }
                },
                {
                    model: 'deepseek-chat',
                    temperature: 0,
                    messages: messages.concat([{
                        role: 'system',
                        content: '如果函数工具不可用，只输出严格 JSON 对象，不要解释。header_row_index 必须是真实表头行的0基行号；time_column 必须从表头原文中选择，优先选择“绝对时间”，也可选择“相对时间”“时间”“Time”“time”；temperature_columns 和 power_column 也必须来自表头原文。'
                    }]),
                    response_format: { type: 'json_object' }
                }
            ];
            let args = null;
            let lastError = null;
            for (let attempt = 0; attempt < requestBodies.length; attempt++) {
                const isToolCall = attempt === 0;
                const requestMode = isToolCall ? 'Function Calling tools/tool_choice' : 'JSON response_format 兼容模式';
                window.logAgent?.(
                    '表格清洗与云端同步Agent',
                    `DeepSeek API 请求已发出：POST /chat/completions｜model=deepseek-chat｜模式=${requestMode}｜sampleRows=${sampleLines.length}｜tool=submit_csv_header_schema｜key=${this.maskApiKey(apiKey)}`,
                    'normal',
                    'AI_HEADER_API_REQUEST'
                );
                window.supervisorAgent?.updateTask(llmTaskId, { status: '运行中', attempt: attempt + 1, detail: `请求 DeepSeek API：${requestMode}` });
                const response = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify(requestBodies[attempt])
                });
                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    lastError = new Error(`HTTP ${response.status}${body ? `：${body.slice(0, 180)}` : ''}`);
                    window.logAgent?.('表格清洗与云端同步Agent', `DeepSeek API 返回异常：HTTP ${response.status}，准备${attempt + 1 < requestBodies.length ? '切换兼容模式重试' : '回退本地规则'}。`, 'normal', 'AI_HEADER_API_RESPONSE');
                    window.supervisorAgent?.updateTask(llmTaskId, { status: attempt + 1 < requestBodies.length ? '重试中' : '失败', detail: lastError.message });
                    continue;
                }
                const result = await response.json();
                window.logTokenUsage?.(
                    '表格清洗与云端同步Agent',
                    'CSV表头识别 DeepSeek 通讯完成',
                    result.usage,
                    'LLM_TOKEN_USAGE'
                );
                const message = result?.choices?.[0]?.message || {};
                const finishReason = result?.choices?.[0]?.finish_reason || 'unknown';
                const toolCallCount = Array.isArray(message.tool_calls) ? message.tool_calls.length : (message.function_call ? 1 : 0);
                window.logAgent?.(
                    '表格清洗与云端同步Agent',
                    `DeepSeek API 已返回：HTTP 200｜finish_reason=${finishReason}｜tool_calls=${toolCallCount}｜contentJSON=${message.content ? 'yes' : 'no'}`,
                    'success',
                    'AI_HEADER_API_RESPONSE'
                );
                window.supervisorAgent?.updateTask(llmTaskId, { status: '运行中', attempt: attempt + 1, detail: `DeepSeek API 返回 HTTP 200，开始解析模型函数参数` });
                try {
                    args = this.parseHeaderSchemaResponse(result);
                    window.logAgent?.('表格清洗与云端同步Agent', `模型函数参数已解析：${this.summarizeHeaderArgs(args)}`, 'success', 'AI_HEADER_TOOL_ARGS');
                    window.supervisorAgent?.updateTask(llmTaskId, { status: '运行中', attempt: attempt + 1, detail: `解析 tool arguments：${this.summarizeHeaderArgs(args)}` });
                    break;
                } catch (parseError) {
                    lastError = parseError;
                    window.logAgent?.('表格清洗与云端同步Agent', `模型响应解析失败：${parseError.message}，准备${attempt + 1 < requestBodies.length ? '切换兼容模式重试' : '回退本地规则'}。`, 'normal', 'AI_HEADER_TOOL_ARGS');
                    window.supervisorAgent?.updateTask(llmTaskId, { status: attempt + 1 < requestBodies.length ? '重试中' : '失败', detail: parseError.message });
                }
            }
            if (!args) throw lastError || new Error('表头识别请求未返回结果');
            const headerIndex = Number(args.header_row_index);
            if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= sampleLines.length) throw new Error('表头行索引越界');
            let resolvedHeaderIndex = headerIndex;
            let delimiter = this.detectDelimiter(lines[resolvedHeaderIndex]);
            let headerRow = this.splitLine(lines[resolvedHeaderIndex], delimiter);
            let headerCorrected = false;
            if (!this.looksLikeHeader(headerRow)) {
                for (let i = 0; i < sampleLines.length; i++) {
                    const candidateDelimiter = this.detectDelimiter(lines[i]);
                    const candidateRow = this.splitLine(lines[i], candidateDelimiter);
                    if (this.looksLikeHeader(candidateRow)) {
                        resolvedHeaderIndex = i;
                        delimiter = candidateDelimiter;
                        headerRow = candidateRow;
                        headerCorrected = true;
                        break;
                    }
                }
            }
            const sampleDataRows = lines.slice(resolvedHeaderIndex + 1, resolvedHeaderIndex + 12);
            let timeIdx = this.chooseTimeIndexBySamples(headerRow, sampleDataRows, delimiter);
            if (timeIdx === -1) timeIdx = this.findColumnIndex(headerRow, args.time_column);
            if (timeIdx === -1) timeIdx = this.chooseTimeIndex(headerRow);
            if (timeIdx === -1) throw new Error(`未找到时间列 ${args.time_column || '（模型返回为空）'}`);
            const powerName = this.normalizeHeader(args.power_column || '');
            let powerIdx = powerName ? this.findColumnIndex(headerRow, powerName) : -1;
            if (powerIdx === -1) powerIdx = this.choosePowerIndex(headerRow);
            let tempNames = (Array.isArray(args.temperature_columns) ? args.temperature_columns : [])
                .map(name => this.normalizeHeader(name))
                .filter(Boolean)
                .filter(name => this.findColumnIndex(headerRow, name) !== -1);
            let tempCompletedLocally = false;
            if (tempNames.length < 1) {
                tempNames = this.inferTemperatureColumns(headerRow, timeIdx, powerIdx !== -1 ? headerRow[powerIdx] : powerName);
                tempCompletedLocally = true;
            }
            if (tempNames.length < 1) throw new Error('模型未返回有效温度列，且本地规则未能补齐温度列');
            window.logAgent?.(
                '表格清洗与云端同步Agent',
                `LLM识别结果校验通过：模型表头行=${headerIndex + 1}｜最终表头行=${resolvedHeaderIndex + 1}${headerCorrected ? '（已用时间列规则校正）' : ''}｜时间列=${headerRow[timeIdx]}｜温度列=${tempNames.length}${tempCompletedLocally ? '（本地补齐）' : ''}｜功率列=${powerIdx !== -1 ? headerRow[powerIdx] : '无'}`,
                'success',
                'AI_HEADER_SCHEMA'
            );
            window.logAgent?.('表格清洗与云端同步Agent', `Function Calling 表头识别完成：第 ${resolvedHeaderIndex + 1} 行为表头，时间列[${headerRow[timeIdx]}]，温度列 ${tempNames.length} 个${powerIdx !== -1 ? `，功率列[${headerRow[powerIdx]}]` : ''}。`, 'success', 'AI_HEADER_SCHEMA');
            window.supervisorAgent?.updateTask(llmTaskId, { status: '完成', detail: `DeepSeek Function Calling 完成：表头第 ${resolvedHeaderIndex + 1} 行，时间列[${headerRow[timeIdx]}]，温度列 ${tempNames.length} 个` });
            return { headerIndex: resolvedHeaderIndex, headerRow, delimiter, timeIdx, tempNames, powerName: powerIdx !== -1 ? headerRow[powerIdx] : '' };
        } catch (error) {
            window.logAgent?.('表格清洗与云端同步Agent', `Function Calling 表头识别失败，回退本地规则：${error.message}`, 'normal', 'AI_HEADER_FALLBACK');
            window.supervisorAgent?.updateTask(llmTaskId, { status: '失败', error: error.message });
            return null;
        }
    },

    processCSVText: async function(text, sourceName) {
        const taskId = window.supervisorAgent?.createTask({
            title: `接入实验数据 ${sourceName || ''}`.trim(),
            agent: '数据提取与通道选择Agent',
            type: 'data_ingest',
            maxRetries: 0
        });
        window.supervisorAgent?.updateTask(taskId, { status: '运行中', attempt: 1, detail: '定位表头并解析通道矩阵' });
        if (window.monitorAgent && window.monitorAgent.timer) {
            clearInterval(window.monitorAgent.timer);
            window.monitorAgent.isRunning = false;
        }

        text = text.replace(/^\uFEFF/, '').trim();
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            window.supervisorAgent?.updateTask(taskId, { status: '失败', error: '文件行数不足' });
            return;
        }

        let headerIndex = -1;
        let headerRow = [];
        let delimiter = '\t';
        let timeIdx = -1;
        let aiSchema = null;

        window.supervisorAgent?.updateTask(taskId, { status: '运行中', attempt: 1, detail: 'Function Calling 判断表头/时间列/温度列/功率列' });
        aiSchema = await this.inferHeaderWithFunctionCalling(lines, sourceName);
        if (aiSchema) {
            headerIndex = aiSchema.headerIndex;
            headerRow = aiSchema.headerRow;
            delimiter = aiSchema.delimiter;
            timeIdx = aiSchema.timeIdx;
        }

        if (!aiSchema) {
            window.supervisorAgent?.updateTask(taskId, { status: '运行中', attempt: 1, detail: 'AI识别不可用，执行本地表头兜底规则' });
            for (let i = 0; i < Math.min(80, lines.length); i++) {
                const currentDelimiter = this.detectDelimiter(lines[i]);
                const cleanParts = this.splitLine(lines[i], currentDelimiter);
                if (this.looksLikeHeader(cleanParts)) {
                    headerIndex = i;
                    headerRow = cleanParts;
                    delimiter = currentDelimiter;
                    timeIdx = this.chooseTimeIndexBySamples(headerRow, lines.slice(i + 1, i + 12), delimiter);
                    if (timeIdx === -1) timeIdx = this.chooseTimeIndex(headerRow);
                    break;
                }
            }
        }

        if (headerIndex === -1) {
            if (!text.toLowerCase().includes('<!doctype html>')) {
                window.logAgent('数据提取Agent', '无法定位 CSV/TSV 表头：需要包含“相对时间 / 绝对时间 / Time”等时间列。', 'error');
            }
            window.supervisorAgent?.updateTask(taskId, { status: '失败', error: '无法定位CSV/TSV表头' });
            return;
        }

        const COLORS = ['#ffa657', '#58a6ff', '#3fb950', '#a371f7', '#d29922', '#1f6feb', '#238636', '#ff7b72', '#8957e5', '#e34c26'];
        window.dynamicChannels = [];
        window.hasPower = false;
        window.colIndices = {};
        window.timeAxisSource = headerRow[timeIdx] || '时间';
        let cIdx = 0;
        const aiTempSet = aiSchema ? new Set(aiSchema.tempNames.map(n => this.normalizeHeader(n))) : null;
        const aiPowerName = aiSchema ? this.normalizeHeader(aiSchema.powerName) : '';

        headerRow.forEach((h, i) => {
            h = this.normalizeHeader(h);
            if (!h || this.isExcludedColumn(h)) return;

            // “功率”单独进入下方功率图；“功率因数”已在排除列里，不会误判。
            if ((aiSchema && aiPowerName && h === aiPowerName) || (!aiSchema && h.includes('功率'))) {
                window.hasPower = true;
                window.colIndices['功率'] = i;
            } else if (!aiSchema || aiTempSet.has(h)) {
                window.dynamicChannels.push({ id: h, name: h, color: COLORS[cIdx % COLORS.length] });
                window.colIndices[h] = i;
                cIdx++;
            }
        });

        window.rawData = [];
        for (let i = headerIndex + 1; i < lines.length; i++) {
            const parts = this.splitLine(lines[i], delimiter);
            if (parts.length < Math.max(3, headerRow.length - 3)) continue;

            let rowObj = {};
            // 统一写入“绝对时间”字段，保证 monitorAgent / cleanerAgent / cloud_sheet 旧逻辑无需改动；
            // 对 Record # + Time 类型文件，这里存放的就是 Time 列原值。
            rowObj['绝对时间'] = parts[timeIdx] || '';

            window.dynamicChannels.forEach(ch => {
                const rawVal = parts[window.colIndices[ch.id]];
                const val = parseFloat(rawVal);
                rowObj[ch.id] = isNaN(val) ? null : val;
            });

            if (window.hasPower) {
                const pVal = parseFloat(parts[window.colIndices['功率']]);
                rowObj['功率'] = isNaN(pVal) ? null : pVal;
            }

            // 至少有一个有效通道数据才入库。
            const hasValidChannel = window.dynamicChannels.some(ch => rowObj[ch.id] !== null) || (window.hasPower && rowObj['功率'] !== null);
            if (hasValidChannel) window.rawData.push(rowObj);
        }

        if (window.rawData.length > 0) {
            window.currentSourceName = sourceName || 'local-file';
            window.currentIndex = 0;
            const ds = document.getElementById('dataStatus');
            if (ds) {
                ds.innerText = `已连接: ${sourceName} (${window.rawData.length} 行｜时间轴: ${window.timeAxisSource})`;
                ds.style.color = 'var(--accent-green)';
            }
            if (window.logAgent) {
                window.logAgent('数据提取与通道选择Agent', `锁定表头成功。识别时间轴[${window.timeAxisSource}]，捕获 ${window.dynamicChannels.length} 个温度通道${window.hasPower ? '，并挂载功率通道' : ''}。`, 'normal');
            }
            if (typeof window.rebuildChartsAndUI === 'function') window.rebuildChartsAndUI();
            if (window.setBtnSafe) window.setBtnSafe('btnStart', false);
            window.supervisorAgent?.updateTask(taskId, { status: '完成', detail: `识别 ${window.dynamicChannels.length} 个通道，载入 ${window.rawData.length} 行` });
            window.supervisorAgent?.checkpoint(`数据接入完成：${sourceName || 'local-file'}`);
        } else {
            if (window.logAgent) window.logAgent('数据提取Agent', '表头已识别，但未解析到有效温度数据。', 'error');
            window.supervisorAgent?.updateTask(taskId, { status: '失败', error: '表头已识别，但未解析到有效温度/功率数据' });
        }
    }
};
