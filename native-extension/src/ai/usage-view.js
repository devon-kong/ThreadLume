import { t, format, getUILanguage } from "../i18n.js";
import { el } from "./dom.js";
import { usageTotals, USAGE_BUSY } from "./usage.js";

export function tokenText(value, source = "reported") {
  if (value === null || value === undefined) return "—";
  return (
    (source === "reported" ? "" : "≈") +
    value.toLocaleString(getUILanguage() === "zh-CN" ? "zh-CN" : "en-US")
  );
}
export const secondsText = (value) =>
  value === null || value === undefined
    ? "—"
    : format("{seconds} 秒", { seconds: (value / 1000).toFixed(1) });
export const usageStatus = (status) =>
  t(
    {
      queued: "排队中",
      running: "生成中",
      success: "成功",
      error: "失败",
      cancelled: "已停止",
      interrupted: "已中断",
    }[status] || "未知",
  );
export const usageMode = (record) =>
  record.operation === "probe"
    ? t("连接测试")
    : record.mode === "mindmap"
      ? t("脑图")
      : t("摘要");
export const usageSource = (source) =>
  t(
    {
      reported: "服务商返回",
      estimated: "本地估算",
      mixed: "部分估算",
      partial: "部分已知",
      unknown: "未知",
    }[source] || "未知",
  );

export function renderUsageDetails(document, record) {
  const totals = usageTotals(record),
    root = el(document, "div", { class: "pk-usage-details-content" }),
    list = el(document, "dl", { class: "pk-usage-facts" });
  const fact = (label, value, raw = false) =>
    list.append(
      el(document, "dt", { text: t(label) }),
      el(document, "dd", { text: value, ...(raw ? { translate: "no" } : {}) }),
    );
  fact("AI 服务", record.providerName || "—", true);
  fact("模型名称", record.model || "—", true);
  fact("配置版本", record.configVersion || "—", true);
  fact("状态", usageStatus(record.status));
  fact("总耗时", secondsText(record.elapsedMs));
  fact("排队耗时", secondsText(record.queueMs));
  fact("请求耗时合计", secondsText(totals.requestMs));
  fact(
    "输入 Token",
    tokenText(totals.inputTokens, totals.inputSource) +
      " · " +
      usageSource(totals.inputSource),
  );
  if (!USAGE_BUSY.has(record.status))
    fact(
      "输出 Token",
      tokenText(totals.outputTokens, totals.outputSource) +
        " · " +
        usageSource(totals.outputSource),
    );
  fact("请求次数", String(totals.requests));
  fact("处理方式", record.segmented ? t("分段生成") : t("单次请求"));
  fact("分段提要复用", record.reusedNotes ? t("是") : t("否"));
  fact("上下文长度（tokens）", tokenText(record.contextTokens));
  fact("流式", record.stream ? t("是") : t("否"));
  fact("输出语言", record.outputLanguage === "en" ? "English" : t("简体中文"));
  if (record.sourceId) {
    fact("内容编号", record.sourceId, true);
    fact("原文估算 Token", tokenText(record.sourceTokens, "estimated"));
  }
  root.append(list);
  if (record.requests.length) {
    const table = el(document, "table", { class: "pk-usage-table" }),
      head = el(document, "tr");
    for (const label of [
      "请求",
      "阶段",
      "输入 Token",
      "输出 Token",
      "耗时",
      "状态",
    ])
      head.append(el(document, "th", { scope: "col", text: t(label) }));
    const body = el(document, "tbody");
    for (const request of record.requests) {
      const row = el(document, "tr"),
        phase = t(
          {
            single: "生成",
            segment: "分段提要",
            integrate: "整合",
            probe: "连接测试",
          }[request.phase],
        );
      for (const value of [
        String(request.index),
        phase,
        tokenText(request.inputTokens, request.inputSource) +
          " · " +
          usageSource(request.inputSource),
        USAGE_BUSY.has(record.status)
          ? "—"
          : tokenText(request.outputTokens, request.outputSource) +
            " · " +
            usageSource(request.outputSource),
        secondsText(request.elapsedMs),
        usageStatus(request.status),
      ])
        row.append(el(document, "td", { text: value }));
      body.append(row);
      if (
        !USAGE_BUSY.has(record.status) &&
        (request.reasoningTokens !== null || request.cachedInputTokens !== null)
      )
        body.append(
          el(
            document,
            "tr",
            {},
            el(document, "td", {
              colspan: 6,
              class: "pk-ai-muted",
              text:
                t("推理 Token") +
                " " +
                tokenText(request.reasoningTokens) +
                " · " +
                t("缓存命中输入 Token") +
                " " +
                tokenText(request.cachedInputTokens) +
                " · " +
                t("已包含在服务商总量中"),
            }),
          ),
        );
    }
    table.append(el(document, "thead", {}, head), body);
    root.append(el(document, "div", { class: "pk-usage-table-scroll" }, table));
  }
  root.append(
    el(document, "p", {
      class: "pk-ai-muted",
      text: t("估算输出只覆盖收到的生成内容。服务商用量包含其返回的统计口径。"),
    }),
  );
  if (!USAGE_BUSY.has(record.status) && !totals.outputComplete)
    root.append(
      el(document, "p", {
        class: "pk-usage-warning",
        text: t("用量可能不完整"),
      }),
    );
  return root;
}

export function createUsageDisplay(document) {
  const summary = el(document, "span", { class: "pk-ai-usage-summary" }),
    details = el(document, "details", { class: "pk-ai-usage-disclosure" }),
    label = el(document, "summary", { text: t("详情") }),
    content = el(document, "div", { class: "pk-ai-usage-details" });
  details.append(label, content);
  const root = el(
    document,
    "div",
    { class: "pk-ai-usage", hidden: true },
    summary,
    details,
  );
  let lastRecord = null,
    lastLanguage = null;
  return {
    root,
    update(
      record,
      { busy = false, elapsedMs = record?.elapsedMs ?? 0, warning = false } = {},
    ) {
      const totals = usageTotals(record);
      root.hidden = false;
      const parts = [];
      if (record || busy) {
        parts.push(
          format("耗时 {seconds} 秒", {
            seconds: (elapsedMs / 1000).toFixed(1),
          }),
          t("输入") + " " + tokenText(totals.inputTokens, totals.inputSource),
        );
        if (!busy)
          parts.push(
            t("输出") + " " + tokenText(totals.outputTokens, totals.outputSource),
          );
        if (!busy && record && !totals.outputComplete)
          parts.push(t("用量可能不完整"));
      } else parts.push(t("暂无统计记录"));
      if (warning) parts.push(t("记录保存失败"));
      summary.textContent = parts.join(" · ");
      details.hidden = !record;
      label.textContent = t("详情");
      if (
        record &&
        (record !== lastRecord || getUILanguage() !== lastLanguage)
      ) {
        const top = content.scrollTop;
        content.replaceChildren(renderUsageDetails(document, record));
        content.scrollTop = top;
        lastRecord = record;
        lastLanguage = getUILanguage();
      }
    },
    hide() {
      root.hidden = true;
      details.open = false;
    },
  };
}
