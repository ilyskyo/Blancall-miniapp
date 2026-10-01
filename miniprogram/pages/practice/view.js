"use strict";
/**
 * 练习页视图模型（把 PracticeSession 转成 WXML 可渲染结构）
 * WXML 不支持函数调用与复杂表达式，因此所有派生数据都在这里算好。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sectionOptions = exports.dictationClues = exports.buildViewModel = exports.MODE_LABEL = void 0;
exports.MODE_LABEL = {
    SENTENCE: '句子挖空',
    WORD: '字词挖空',
    REVERSE: '反向默写',
};
function blankWidth(answer) {
    const n = Math.max(2, Math.min(8, answer.length));
    return n * 38 + 24;
}
/**
 * 生成视图模型
 * @param judged 批改后的逐空判定（key = 空序号），未批改传 null
 * @param hintBlank 当前提示的空序号
 * @param hintChar 提示字
 */
function buildViewModel(session, judged, hintBlank, hintChar) {
    const parts = session.displayText.split('___');
    const segments = [];
    let answered = 0;
    for (let i = 0; i < parts.length; i++) {
        const blankRuntime = session.blanks[i];
        let blank = null;
        if (blankRuntime) {
            const value = session.answers[blankRuntime.index] || '';
            if (value.trim())
                answered += 1;
            const judge = judged ? judged[blankRuntime.index] : undefined;
            const correct = judge ? judge.result === 'CORRECT' || judge.result === 'PUNCT' : false;
            const showHint = hintBlank === blankRuntime.index && !!hintChar;
            blank = {
                index: blankRuntime.index,
                value,
                width: blankWidth(blankRuntime.answer),
                hint: showHint ? hintChar : '',
                state: judge ? (correct ? 'correct' : 'wrong') : 'none',
                answer: blankRuntime.answer,
                correct,
            };
        }
        segments.push({ text: parts[i], blank });
    }
    const total = session.blanks.length;
    return {
        segments,
        answered,
        total,
        progressPercent: total > 0 ? Math.round((answered / total) * 100) : 0,
        modeLabel: exports.MODE_LABEL[session.mode],
        showHintGhost: hintBlank !== null && !!hintChar,
    };
}
exports.buildViewModel = buildViewModel;
/** 反向默写的线索卡（打乱顺序 + 挖空分句） */
function dictationClues(session) {
    if (!session.dictation)
        return [];
    return session.dictation.shuffled.map((c) => ({ displayOrder: c.displayOrder, text: c.displayText }));
}
exports.dictationClues = dictationClues;
/** 段落范围可选项（练习设置面板用） */
function sectionOptions(session) {
    // 由调用方（页面）用 SectionSplitter 生成；此处仅保留占位，避免页面直接依赖算法
    void session;
    return [];
}
exports.sectionOptions = sectionOptions;
