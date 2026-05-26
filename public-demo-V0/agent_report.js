// ==========================================
// 🤖 分析与报告 Agent 核心协议库
// 职责：条件判断保存配置、渲染上下双拼图表、生成多页 PPTX
// ==========================================

window.reportAgent = {
    segments: null,
    
    // 🚀 新增：用来追踪超级个体是否真正修改了文本框内容
    isPptConfigModified: false,

    initReport: function(segments) {
        const apiKey = document.getElementById('deepseekApiKey').value.trim();
        if (!apiKey) { 
            alert("请在右上角输入 DeepSeek API Key！"); 
            document.getElementById('btnAnalyze').disabled = false;
            return; 
        }
        
        document.getElementById('btnAnalyze').disabled = true;
        document.getElementById('btnAnalyze').innerText = "⏳ 等待配置...";
        this.segments = segments;
        
        // 每次重新打开配置框，重置修改追踪标志
        this.isPptConfigModified = false;
        // 把全局挂载的修改状态也绑定过来
        window.isPptConfigModified = false; 

        const existingConfig = localStorage.getItem('cmd_PPT_txt');
        const modalDesc = document.getElementById('pptModalDesc');
        const textArea = document.getElementById('pptTemplateText');
        
        if (existingConfig) {
            logAgent('分析与报告Agent', `已读取内存中缓存的配置偏好，请求超级个体确认。`, 'normal', 'READ_FILE');
            modalDesc.innerText = "检测到历史缓存的 PPT 报告模板，您可以直接使用，或点击右侧【手动载入】读取电脑里的 txt 文件：";
            textArea.value = existingConfig;
        } else {
            logAgent('分析与报告Agent', `内存无缓存配置，请求超级个体进行偏好对齐初始化。`, 'normal', 'READ_FILE');
            modalDesc.innerText = "请指示本次诊断和PPT输出的侧重点，您可以手打，也可以点击右侧【手动载入】读取电脑里的 txt 文件：";
            textArea.value = "请重点分析膨胀阀的状态与传感器跳变的关联。用【现象】、【根因】、【建议】三个要点以列表形式输出。";
        }
        
        document.getElementById('pptConfigModal').style.display = 'flex';
    },

    readConfigFile: function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('pptTemplateText').value = e.target.result;
            // 🚀 核心判断：从本地文件读取的数据不算作“超级个体手动修改”，因此依然保持 false
            window.isPptConfigModified = false;
            
            logAgent('超级个体', `手动载入本地物理配置文件：[${file.name}]`, 'normal', 'USER_INTERACTION');
            logAgent('分析与报告Agent', `成功解析物理文件内容，已填入指令中枢。`, 'normal', 'READ_FILE');
        };
        reader.readAsText(file);
        event.target.value = '';
    },

    // 🚀 核心架构重构：把温度图和功率图画在同一张高清画布上！
    generateChartBase64: function(segment) {
        return new Promise((resolve) => {
            // 检查这组截取数据里是否包含了“功率”字段
            const includesPower = segment.length > 0 && segment[0].hasOwnProperty('功率');
            
            // 1. 创建最终要截图的幕后母板
            const masterCanvas = document.createElement('canvas');
            masterCanvas.width = 1200;
            // 如果有功率图，画布加高 200 像素
            masterCanvas.height = includesPower ? 700 : 500;
            const mCtx = masterCanvas.getContext('2d');
            mCtx.fillStyle = '#ffffff';
            mCtx.fillRect(0, 0, masterCanvas.width, masterCanvas.height);

            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '-9999px';
            document.body.appendChild(container);

            // 2. 准备渲染上半部分 (温度图)
            const tContainer = document.createElement('div');
            tContainer.style.width = '1200px';
            tContainer.style.height = '500px';
            container.appendChild(tContainer);
            const tCanvas = document.createElement('canvas');
            tContainer.appendChild(tCanvas);

            const labels = segment.map(row => row['时间']);
            const tDatasets = [];
            
            const COLORS = ['#ffa657', '#58a6ff', '#3fb950', '#a371f7', '#d29922', '#1f6feb', '#238636', '#ff7b72', '#8957e5', '#e34c26'];
            
            const tempKeys = Object.keys(segment[0]).filter(k => k !== '时间' && k !== '功率');
            tempKeys.forEach((k, idx) => {
                tDatasets.push({
                    label: k,
                    data: segment.map(row => row[k]),
                    borderColor: COLORS[idx % COLORS.length],
                    borderWidth: 2, pointRadius: 0, tension: 0.2
                });
            });

            new Chart(tCanvas, {
                type: 'line', data: { labels, datasets: tDatasets },
                options: {
                    responsive: false, animation: false, 
                    plugins: { legend: { display: true, position: 'top', labels: { color: '#333', font: { weight: 'bold', size: 14 } } } },
                    scales: {
                        x: { display: !includesPower, ticks: { color: '#666', maxTicksLimit: 12, maxRotation: 0 }, grid: { color: '#eee' } },
                        y: { ticks: { color: '#666', font: { size: 12 } }, grid: { color: '#eee' } }
                    }
                }
            });

            // 3. 准备渲染下半部分 (功率图)
            let pCanvas = null;
            if (includesPower) {
                const pContainer = document.createElement('div');
                pContainer.style.width = '1200px';
                pContainer.style.height = '200px';
                container.appendChild(pContainer);
                pCanvas = document.createElement('canvas');
                pContainer.appendChild(pCanvas);
                
                new Chart(pCanvas, {
                    type: 'line',
                    data: { labels, datasets: [{ label: '功率 (W)', data: segment.map(r => r['功率']), borderColor: '#ff4081', backgroundColor: 'rgba(255,64,129,0.1)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.2 }] },
                    options: {
                        responsive: false, animation: false,
                        plugins: { legend: { display: true, position: 'top', labels: { color: '#ff4081', font: { weight: 'bold', size: 14 } } } },
                        scales: {
                            x: { ticks: { color: '#666', maxTicksLimit: 12, maxRotation: 0 }, grid: { color: '#eee' } },
                            y: { ticks: { color: '#666', font: { size: 12 } }, grid: { color: '#eee' } }
                        }
                    }
                });
            }

            // 4. 将两个图表按顺序拼接到主画布上
            setTimeout(() => {
                mCtx.drawImage(tCanvas, 0, 0);
                if (includesPower) {
                    mCtx.drawImage(pCanvas, 0, 500); // 功率图拼接在 500 像素下方
                }
                const base64 = masterCanvas.toDataURL('image/png', 1.0);
                document.body.removeChild(container);
                resolve({ img: base64, hasPower: includesPower }); 
            }, 300);
        });
    },

    generatePPT: async function() {
        document.getElementById('pptConfigModal').style.display = 'none';
        document.getElementById('btnAnalyze').innerText = "⏳ 制作报告中...";
        
        const configText = document.getElementById('pptTemplateText').value.trim();
        localStorage.setItem('cmd_PPT_txt', configText);
        
        logAgent('分析与报告Agent', `已将当前配置同步写入系统缓存。开始调用 LLM 处理核心数据...`, 'normal', 'WRITE_FILE');
        
        // 🚀 核心逻辑修改：如果 window.isPptConfigModified 是 true（代表手动修改过），才下载 txt
        if (window.isPptConfigModified) {
            const blob = new Blob([configText], { type: 'text/plain;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'PPT_Config_Backup.txt';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            logAgent('分析与报告Agent', `检测到指令发生变更，已将最新配置文件备份至本地。`, 'normal', 'WRITE_FILE');
        }
        
        // 提取数据特征给 LLM
        let dataSummary = "框选的数据特征：\n";
        this.segments.forEach((seg, idx) => {
            const keys = Object.keys(seg[0]).filter(k => k !== '时间');
            dataSummary += `\n数据段 ${idx + 1} (共 ${seg.length} 个采样周期):\n`;
            keys.forEach(k => {
                const vals = seg.map(row => row[k]);
                const validVals = vals.filter(v => v !== null && !isNaN(v));
                if (validVals.length > 0) {
                    const max = Math.max(...validVals).toFixed(1);
                    const min = Math.min(...validVals).toFixed(1);
                    dataSummary += ` - [${k}] 最高:${max}℃, 最低:${min}℃\n`;
                }
            });
        });

        const prompt = `你是一名资深的工业异常诊断专家。以下是采样数据特征：
        ${dataSummary}
        以下是超级个体的偏好要求(cmd/PPT.txt)："${configText}"
        请严格按照要求给出精简、硬核的报告文案，不要有多余的客套话。`;

        try {
            const apiKey = document.getElementById('deepseekApiKey').value.trim();
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: "deepseek-chat", messages: [{"role": "user", "content": prompt}] })
            });
            const result = await response.json();
            window.logTokenUsage?.(
                '分析与报告Agent',
                'PPT诊断 DeepSeek 通讯完成',
                result.usage,
                'LLM_TOKEN_USAGE'
            );
            const analysisText = result.choices[0].message.content;
            
            logAgent('分析与报告Agent', `<div style="background:#161b22; padding:10px; border-left:3px solid #d29922; margin-top:8px;"><b>【深度诊断文案完毕，正在排版并渲染高分图表】</b><br>${analysisText.replace(/\n/g, '<br>')}</div>`, 'normal', 'REPORT_GEN');

            let pptx = new PptxGenJS();
            
            let slideTitle = pptx.addSlide();
            slideTitle.addText("⬡ Ice-Harness 异常诊断报告", { x: 0.5, y: 1.5, w: '90%', h: 1.5, fontSize: 36, bold: true, color: "003366", align: "center" });
            slideTitle.addText(`生成时间: ${new Date().toLocaleString()}`, { x: 0.5, y: 3.5, w: '90%', h: 0.5, fontSize: 14, color: "666666", align: "center" });
            
            // 循环每一个截取片段生成一页带图表的 PPT
            for (let i = 0; i < this.segments.length; i++) {
                let renderResult = await this.generateChartBase64(this.segments[i]);
                let slideChart = pptx.addSlide();
                slideChart.addText(`数据清洗切片 - 可视化洞察 (片段 ${i + 1})`, { x: 0.5, y: 0.3, w: '90%', h: 0.5, fontSize: 20, bold: true, color: "003366", border: [0,0,{pt:2,color:'58a6ff'},0] });
                
                // 根据是否有功率图动态调整在幻灯片中的比例
                let imgHeight = renderResult.hasPower ? 5.25 : 4.05; 
                slideChart.addImage({ data: renderResult.img, x: 0.5, y: 1.0, w: 9.0, h: imgHeight });
            }
            
            let slideContent = pptx.addSlide();
            slideContent.addText("核心诊断与分析建议", { x: 0.5, y: 0.3, w: '90%', h: 0.5, fontSize: 20, bold: true, color: "003366", border: [0,0,{pt:2,color:'58a6ff'},0] });
            slideContent.addText(analysisText, { x: 0.5, y: 1.0, w: '90%', h: 4.0, fontSize: 12, color: "333333", valign: "top" });
            
            const fileName = `Ice_Harness_Report_${new Date().getTime()}.pptx`;
            pptx.writeFile({ fileName: fileName });
            
            logAgent('分析与报告Agent', `PPT 报告已生成并输出到工作目录：<span style="color:var(--accent-green)">${fileName}</span>`, 'normal', 'FILE_OUTPUT');

        } catch (error) {
            logAgent('分析与报告Agent', `诊断或渲染失败: ${error.message}`, 'error');
        } finally {
            document.getElementById('btnAnalyze').innerText = "📊 智能诊断 (LLM)";
            document.getElementById('btnAnalyze').disabled = false;
        }
    },
    
    cancel: function() {
        document.getElementById('pptConfigModal').style.display = 'none';
        document.getElementById('btnAnalyze').disabled = false;
        document.getElementById('btnAnalyze').innerText = '📊 智能诊断 (LLM)';
        logAgent('超级个体', '已取消 PPT 生成任务。', 'normal');
    }
};
