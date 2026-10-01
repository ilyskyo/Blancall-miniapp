"use strict";
/**
 * 单篇统计辅助逻辑（趋势 / 模式对比 / 薄弱环节 / 热力图 / 练习历史）
 * 口径：全部基于该篇的本地练习记录。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.heatLegend = exports.buildHistory = exports.buildHeat = exports.buildWeakness = exports.buildModes = exports.buildTrend = exports.MODE_LABEL = void 0;
const memoryHeatmap_1 = require("../../../../core/algorithms/memoryHeatmap");
const date_1 = require("../../../../core/utils/date");
exports.MODE_LABEL = {
    SENTENCE: '句子挖空',
    WORD: '字词挖空',
    REVERSE: '反向默写',
};
const ERROR_LABEL = {
    TYPO: '错别字',
    MISSING: '漏字',
    EXTRA: '多填',
    WRONG_ORDER: '顺序错',
};
/** 近 N 天训练趋势（按该篇记录） */
function buildTrend(records, days = 14) {
    const keys = (0, date_1.lastNDays)(days);
    const counts = keys.map((date) => records.filter((r) => (0, date_1.dateKey)(r.timestamp) === date).length);
    const max = counts.reduce((m, c) => Math.max(m, c), 0);
    return keys.map((date, i) => {
        const count = counts[i];
        const heightPercent = max > 0 ? Math.max(count > 0 ? 8 : 0, Math.round((count / max) * 100)) : 0;
        return {
            date,
            label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
            count,
            heightPercent,
            valueText: count > 0 ? `${count}` : '',
        };
    });
}
exports.buildTrend = buildTrend;
/** 模式对比（该篇） */
function buildModes(records) {
    const modes = ['SENTENCE', 'WORD', 'REVERSE'];
    return modes.map((mode) => {
        const list = records.filter((r) => r.mode === mode);
        const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
        const correct = list.reduce((s, r) => s + r.correctCount, 0);
        const acc = blanks > 0 ? correct / blanks : 0;
        return {
            mode,
            label: exports.MODE_LABEL[mode],
            count: list.length,
            accuracyPercent: Math.round(acc * 100),
            accuracyText: list.length > 0 ? `${Math.round(acc * 100)}%` : '—',
        };
    });
}
exports.buildModes = buildModes;
/** 薄弱环节（该篇错误类型分布） */
function buildWeakness(records) {
    const counter = { TYPO: 0, MISSING: 0, EXTRA: 0, WRONG_ORDER: 0 };
    for (const r of records)
        for (const m of r.mistakes)
            counter[m.errorType] = (counter[m.errorType] || 0) + 1;
    const total = Object.values(counter).reduce((s, v) => s + v, 0);
    const order = ['TYPO', 'MISSING', 'EXTRA', 'WRONG_ORDER'];
    if (total === 0)
        return [];
    return order
        .filter((t) => counter[t] > 0)
        .map((t) => ({
        label: ERROR_LABEL[t],
        count: counter[t],
        ratioText: `${Math.round((counter[t] / total) * 100)}%`,
    }))
        .sort((a, b) => b.count - a.count);
}
exports.buildWeakness = buildWeakness;
/** 记忆热力图（按句），未练习句无色 */
function buildHeat(content, records) {
    if (!content)
        return { cells: [], overallErrorText: '—', hasHistory: false };
    const data = memoryHeatmap_1.MemoryHeatmap.generate(content, records);
    const cells = data.sentences.map((s) => ({
        key: `s${s.sentenceIndex}`,
        text: s.text,
        color: s.heatColor,
        bgStyle: s.heatColor ? `background:${s.heatColor}` : '',
        errorText: s.heatColor ? `${Math.round(s.errorRate * 100)}%` : '未练',
    }));
    return {
        cells,
        overallErrorText: `${Math.round(data.overallErrorRate * 100)}%`,
        hasHistory: data.totalPractices > 0,
    };
}
exports.buildHeat = buildHeat;
/** 练习历史（该篇，按时间倒序；filter 为 ALL 或某个模式） */
function buildHistory(records, filter, expanded) {
    return records
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .filter((r) => filter === 'ALL' || r.mode === filter)
        .map((r) => {
        const acc = r.totalBlanks > 0 ? r.correctCount / r.totalBlanks : 0;
        return {
            uuid: r.uuid,
            timeText: formatMillisDate(r.timestamp),
            modeLabel: exports.MODE_LABEL[r.mode],
            accuracyText: `${Math.round(acc * 100)}%`,
            correctText: `${r.correctCount}/${r.totalBlanks}`,
            durationText: r.duration > 0 ? (0, date_1.formatMillis)(r.duration) : '—',
            mistakeCount: r.mistakes.length,
            mistakes: r.mistakes.map((m) => ({
                index: m.blankIndex + 1,
                correct: m.correctAnswer,
                user: m.userAnswer || '（空）',
                label: ERROR_LABEL[m.errorType],
            })),
            expanded: !!expanded[r.uuid],
        };
    });
}
exports.buildHistory = buildHistory;
function formatMillisDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** 热力图图例 */
function heatLegend() {
    return memoryHeatmap_1.MemoryHeatmap.getLegendColors().map(([label, color]) => ({ label, color }));
}
exports.heatLegend = heatLegend;
