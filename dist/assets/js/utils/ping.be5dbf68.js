/**
 * @module utils/ping
 * @description 延迟/Ping 相关辅助函数
 * @dependencies core/state.js
 * @exports getLatestPing, getPingTasks, getTaskLatestPing, getPingLevel, getRealtimePing, summarizePing, getPingTaskList
 */

import { state } from '../core/state.05f8be33.js';

/**
 * 取每个任务的最新延迟后再求平均
 * records 由 loadPingHistory 按时间升序排列，因此必须从尾部倒序取首个命中值，
 * 否则拿到的是该任务最早的一条记录。
 * @param {string} uuid - 节点 UUID
 * @returns {number|null} 平均延迟值
 */
export function getLatestPing(uuid) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo || !pingInfo.records || pingInfo.records.length === 0) {
        return null;
    }
    const taskValues = {};
    for (let i = pingInfo.records.length - 1; i >= 0; i--) {
        const r = pingInfo.records[i];
        const key = String(r.task_id);
        if (!Object.prototype.hasOwnProperty.call(taskValues, key) &&
            r.value !== null && r.value !== undefined && r.value >= 0) {
            taskValues[key] = r.value;
        }
    }
    const values = Object.values(taskValues);
    if (values.length === 0) return null;
    const sum = values.reduce(function (a, b) { return a + b; }, 0);
    return sum / values.length;
}

/**
 * 获取实时轮询中的延迟数据
 * @param {string} uuid - 节点 UUID
 * @returns {Object|null} taskId → { name, latest, avg, loss, min, max }
 */
export function getRealtimePing(uuid) {
    const rt = state.realtimeData[uuid];
    return rt && rt.ping ? rt.ping : null;
}

/**
 * 汇总延迟监测任务，得到卡片展示用的聚合值
 * komari 用 latest = -1 表示本轮探测失败，这类任务只计入丢包、不计入延迟均值。
 * @param {Object|null} pingMap - 实时轮询的 ping 映射
 * @returns {Object|null} { avgMs, worstMs, lossPct, taskCount, validCount }
 */
export function summarizePing(pingMap) {
    if (!pingMap) return null;

    const latencies = [];
    let lossSum = 0;
    let lossCount = 0;
    let taskCount = 0;

    Object.keys(pingMap).forEach(function (taskId) {
        const task = pingMap[taskId];
        if (!task) return;
        taskCount++;

        const latest = typeof task.latest === 'number' ? task.latest : null;
        if (latest !== null && latest >= 0) {
            latencies.push(latest);
        }
        if (typeof task.loss === 'number' && !isNaN(task.loss)) {
            lossSum += task.loss;
            lossCount++;
        }
    });

    if (taskCount === 0) return null;

    const avgMs = latencies.length > 0
        ? latencies.reduce(function (a, b) { return a + b; }, 0) / latencies.length
        : null;

    return {
        avgMs: avgMs,
        latestMs: latencies.length > 0 ? Math.max.apply(null, latencies) : null,
        worstMs: latencies.length > 0 ? Math.max.apply(null, latencies) : null,
        lossPct: lossCount > 0 ? lossSum / lossCount : null,
        taskCount: taskCount,
        validCount: latencies.length
    };
}

/**
 * 提取每个监测任务的明细（三网：电信/移动/联通等）
 * 保持 komari 返回的任务顺序，便于卡片稳定展示。
 * komari 用 latest = -1 表示本轮探测失败，此时保留该任务并标记 failed。
 * @param {Object|null} pingMap - 实时轮询的 ping 映射
 * @returns {Array} [{ id, name, ms, lossPct, level, failed }]
 */
export function getPingTaskList(pingMap) {
    if (!pingMap) return [];

    const list = [];
    Object.keys(pingMap).forEach(function (taskId) {
        const task = pingMap[taskId];
        if (!task) return;

        const latest = typeof task.latest === 'number' ? task.latest : null;
        const failed = latest === null || latest < 0;
        const ms = failed ? null : latest;
        const lossPct = typeof task.loss === 'number' && !isNaN(task.loss) ? task.loss : null;

        list.push({
            id: taskId,
            name: task.name || ('任务 ' + taskId),
            ms: ms,
            lossPct: lossPct,
            level: getPingLevel(ms),
            failed: failed
        });
    });

    return list;
}

/**
 * 获取 Ping 任务列表
 * @param {string} uuid - 节点 UUID
 * @returns {Array} 任务数组
 */
export function getPingTasks(uuid) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo || !pingInfo.tasks) return [];
    return pingInfo.tasks;
}

/**
 * 获取任务最新延迟
 * @param {string} uuid - 节点 UUID
 * @param {string} taskId - 任务 ID
 * @returns {number|null} 延迟值
 */
export function getTaskLatestPing(uuid, taskId) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo || !pingInfo.records) return null;
    const targetTaskId = String(taskId);
    for (let i = pingInfo.records.length - 1; i >= 0; i--) {
        if (String(pingInfo.records[i].task_id) === targetTaskId) {
            return pingInfo.records[i].value;
        }
    }
    return null;
}

/**
 * 获取延迟级别
 * @param {number} pingMs - 延迟值（毫秒）
 * @returns {string} 级别
 */
export function getPingLevel(pingMs) {
    if (pingMs === null || pingMs === undefined) return 'normal';
    if (pingMs < 50) return 'excellent';
    if (pingMs < 100) return 'normal';
    if (pingMs < 300) return 'warning';
    return 'danger';
}
