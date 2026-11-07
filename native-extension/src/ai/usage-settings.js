import { t, format, getUILanguage } from "../i18n.js";
import { el, button } from "./dom.js";
import { cleanUsageRecord, usageTotals, USAGE_BUSY } from "./usage.js";
import {
  filterUsageRecords,
  compareUsageModels,
  summarizeUsage,
  usageModelKey,
} from "./usage-analysis.js";
import {
  renderUsageDetails,
  tokenText,
  secondsText,
  usageStatus,
  usageMode,
  usageSource,
} from "./usage-view.js";

export function createUsageSettings({
  document,
  preferences,
  onSave,
  onChange,
  send,
}) {
  const win = document.defaultView;
  let records = [],
    persistence = "ready",
    loaded = false,
    loading = false,
    clearing = false,
    error = "",
    revision = 0,
    view = "history",
    page = 1;
  const filters = {
    range: "30",
    provider: "",
    mode: "generate",
    status: "",
    kind: "",
    language: "",
    processing: "",
    reuse: "default",
    source: "",
    min: "",
    max: "",
    sort: "time",
    direction: "desc",
    from: "",
    to: "",
  };
  const identified = (node, id) => {
    node.id = id;
    return node;
  };
  const accept = (value) => {
    records = Array.isArray(value?.records)
      ? value.records.slice(0, 500).map(cleanUsageRecord).filter(Boolean)
      : [];
    persistence = value?.persistence || "ready";
    loaded = true;
  };
  async function load() {
    if (clearing) return;
    const at = ++revision;
    loading = true;
    error = "";
    onChange();
    try {
      const value = await send("getUsageHistory");
      if (at === revision) accept(value);
    } catch {
      if (at === revision) error = t("无法读取调用记录，请重试。");
    } finally {
      if (at === revision) {
        loading = false;
        onChange();
      }
    }
  }
  async function clear() {
    if (
      clearing ||
      !win.confirm(
        t("确定清空全部调用记录？此操作会清除当前任务的后续历史写入。"),
      )
    )
      return;
    ++revision;
    clearing = true;
    loading = false;
    error = "";
    onChange();
    try {
      accept(await send("clearUsageHistory"));
      page = 1;
    } catch {
      error = t("记录保存失败");
    } finally {
      clearing = false;
      onChange();
    }
  }
  function select(name, label, options) {
    const input = el(document, "select", {
      id: "pk-usage-" + name,
      "aria-label": t(label),
    });
    for (const [value, title] of options)
      input.append(
        el(document, "option", {
          value,
          text: t(title),
          selected: filters[name] === value,
        }),
      );
    input.addEventListener("change", () => {
      filters[name] = input.value;
      page = 1;
      onChange();
    });
    return el(
      document,
      "label",
      { class: "pk-usage-filter" },
      el(document, "span", { text: t(label) }),
      input,
    );
  }
  function field(name, label, type = "text") {
    const input = el(document, "input", {
      id: "pk-usage-" + name,
      type,
      "aria-label": t(label),
      ...(type === "number" ? { min: 0, step: 1 } : {}),
    });
    input.value = filters[name];
    input.addEventListener("change", () => {
      filters[name] = input.value;
      page = 1;
      onChange();
    });
    return el(
      document,
      "label",
      { class: "pk-usage-filter" },
      el(document, "span", { text: t(label) }),
      input,
    );
  }
  function filterPanel() {
    const models = new Map();
    for (const row of records)
      models.set(usageModelKey(row), row.providerName + " / " + row.model);
    const root = el(
      document,
      "div",
      { class: "pk-usage-filters" },
      select("range", "日期范围", [
        ["today", "今天"],
        ["7", "最近 7 天"],
        ["30", "最近 30 天"],
        ["all", "全部保留记录"],
        ["custom", "自定义日期"],
      ]),
      select("provider", "服务／模型", [["", "全部服务／模型"], ...models]),
      select("mode", "任务类别", [
        ["generate", "生成任务"],
        ["summary", "摘要"],
        ["mindmap", "脑图"],
        ["probe", "连接测试"],
        ["all", "全部任务"],
      ]),
      select("status", "状态", [
        ["", "全部状态"],
        ...[
          "queued",
          "running",
          "success",
          "error",
          "cancelled",
          "interrupted",
        ].map((status) => [status, usageStatus(status)]),
      ]),
    );
    if (filters.range === "custom")
      root.append(
        field("from", "开始日期", "date"),
        field("to", "结束日期", "date"),
      );
    const extra = el(
      document,
      "details",
      { id: "pk-usage-more-filters" },
      el(document, "summary", { text: t("更多筛选") }),
      el(
        document,
        "div",
        { class: "pk-usage-filters" },
        select("kind", "来源类型", [
          ["", "全部来源"],
          ["article", "长文"],
          ["video", "视频"],
        ]),
        select("language", "输出语言", [
          ["", "全部语言"],
          ["en", "English"],
          ["zh-CN", "简体中文"],
        ]),
        select("processing", "处理方式", [
          ["", "全部处理方式"],
          ["single", "单次请求"],
          ["segmented", "分段生成"],
        ]),
        select("reuse", "复用情况", [
          ["default", view === "comparison" ? "完整新生成" : "全部复用情况"],
          ["all", "全部复用情况"],
          ["fresh", "完整新生成"],
          ["reused", "复用分段提要"],
        ]),
        field("min", "最小输入量", "number"),
        field("max", "最大输入量", "number"),
        field("source", "内容编号"),
        select("sort", "排序", [
          ["time", "按时间排序"],
          ["elapsed", "按耗时排序"],
          ["input", "按输入排序"],
          ["output", "按输出排序"],
        ]),
        select("direction", "排序方向", [
          ["desc", "降序"],
          ["asc", "升序"],
        ]),
      ),
    );
    return el(document, "div", {}, root, extra);
  }
  function summaryCards(rows) {
    const totals = summarizeUsage(rows),
      root = el(document, "div", { class: "pk-usage-overview" });
    for (const [label, value, coverage] of [
      ["生成次数", String(totals.generations)],
      ["实际请求次数", String(totals.requests)],
      [
        "输入总量",
        tokenText(totals.inputTokens, totals.inputSource),
        format("有效样本 {known}/{total}", {
          known: totals.inputKnown,
          total: rows.length,
        }) +
          " · " +
          usageSource(totals.inputSource),
      ],
      [
        "输出总量",
        tokenText(totals.outputTokens, totals.outputSource),
        format("有效样本 {known}/{total}", {
          known: totals.outputKnown,
          total: rows.length,
        }) +
          " · " +
          usageSource(totals.outputSource),
      ],
    ])
      root.append(
        el(
          document,
          "div",
          { class: "pk-usage-stat" },
          el(document, "span", { text: t(label) }),
          el(document, "strong", { text: value }),
          ...(coverage ? [el(document, "small", { text: coverage })] : []),
        ),
      );
    return root;
  }
  function historyTable(rows) {
    const table = el(document, "table", { class: "pk-usage-table" }),
      head = el(document, "tr");
    for (const label of [
      "时间",
      "服务／模型",
      "任务",
      "输入 Token",
      "输出 Token",
      "耗时",
      "状态",
    ])
      head.append(el(document, "th", { scope: "col", text: t(label) }));
    const body = el(document, "tbody"),
      pages = Math.max(1, Math.ceil(rows.length / 50));
    page = Math.min(page, pages);
    for (const row of rows.slice((page - 1) * 50, page * 50)) {
      const totals = usageTotals(row),
        details = el(
          document,
          "details",
          { id: "pk-usage-record-" + row.id },
          el(
            document,
            "summary",
            {},
            el(document, "span", { text: row.providerName, translate: "no" }),
            el(document, "small", { text: row.model, translate: "no" }),
          ),
          renderUsageDetails(document, row),
        );
      const tr = el(document, "tr", {
        "data-usage-row": row.id,
        id: "pk-usage-row-" + row.id,
      });
      const values = [
        new Date(row.startedAt).toLocaleString(
          getUILanguage() === "zh-CN" ? "zh-CN" : "en-US",
        ),
        details,
        usageMode(row) +
          (row.kind === "video"
            ? " · " + t("视频")
            : row.kind === "article"
              ? " · " + t("长文")
              : ""),
        tokenText(totals.inputTokens, totals.inputSource),
        USAGE_BUSY.has(row.status)
          ? "—"
          : tokenText(totals.outputTokens, totals.outputSource),
        secondsText(row.elapsedMs),
        usageStatus(row.status),
      ];
      for (const value of values) tr.append(el(document, "td", {}, value));
      body.append(tr);
    }
    table.append(el(document, "thead", {}, head), body);
    const previous = identified(
        button(document, t("上一页"), () => {
          page--;
          onChange();
        }),
        "pk-usage-prev",
      ),
      next = identified(
        button(document, t("下一页"), () => {
          page++;
          onChange();
        }),
        "pk-usage-next",
      );
    previous.disabled = page === 1;
    next.disabled = page === pages;
    return el(
      document,
      "div",
      {},
      el(document, "div", { class: "pk-usage-table-scroll" }, table),
      ...(!rows.length
        ? [
            el(document, "p", {
              class: "pk-ai-muted",
              text: t("没有符合筛选条件的记录"),
            }),
          ]
        : []),
      el(
        document,
        "div",
        { class: "pk-usage-pagination" },
        previous,
        el(document, "span", {
          text: format("第 {page}/{pages} 页 · {count} 条记录", {
            page,
            pages,
            count: rows.length,
          }),
        }),
        next,
      ),
    );
  }
  function comparisonTable(rows) {
    const models = compareUsageModels(rows, {
        includeReused: filters.reuse === "all" || filters.reuse === "reused",
      }),
      table = el(document, "table", { class: "pk-usage-table" }),
      head = el(document, "tr");
    for (const label of [
      "服务／模型",
      "生成次数",
      "成功率",
      "耗时中位数",
      "平均输入 Token",
      "平均输出 Token",
    ])
      head.append(el(document, "th", { scope: "col", text: t(label) }));
    const body = el(document, "tbody");
    for (const model of models) {
      const row = el(document, "tr"),
        provider = el(
          document,
          "td",
          {},
          el(document, "strong", { text: model.providerName, translate: "no" }),
          el(document, "small", { text: model.model, translate: "no" }),
        );
      row.append(provider);
      row.append(
        el(
          document,
          "td",
          {},
          String(model.generations),
          el(document, "small", {
            text:
              t("主动停止") +
              " " +
              model.stopped +
              " · " +
              t("中断") +
              " " +
              model.interrupted,
          }),
        ),
      );
      row.append(
        el(
          document,
          "td",
          {},
          model.successRate === null
            ? "—"
            : (model.successRate * 100).toFixed(1) + "%",
          el(document, "small", {
            text: format("有效样本 {known}/{total}", {
              known: model.success + model.failed,
              total: model.generations,
            }),
          }),
        ),
      );
      for (const [name, value] of [
        ["elapsedMs", secondsText(model.elapsedMs.value)],
        [
          "inputTokens",
          tokenText(model.inputTokens.value, model.inputTokens.source),
        ],
        [
          "outputTokens",
          tokenText(model.outputTokens.value, model.outputTokens.source),
        ],
      ]) {
        const metric = model[name];
        row.append(
          el(
            document,
            "td",
            {},
            value,
            el(document, "small", {
              text: format("有效样本 {known}/{total}", {
                known: metric.known,
                total: model.generations,
              }),
            }),
          ),
        );
      }
      body.append(row);
    }
    table.append(el(document, "thead", {}, head), body);
    return el(
      document,
      "div",
      {},
      el(document, "p", {
        class: "pk-ai-muted",
        text: t("比较默认采用成功且完整新生成的任务。"),
      }),
      el(document, "p", {
        class: "pk-ai-muted",
        text: t("成功率按成功与失败任务计算，主动停止和中断单列。"),
      }),
      el(document, "div", { class: "pk-usage-table-scroll" }, table),
      ...(!models.length
        ? [
            el(document, "p", {
              class: "pk-ai-muted",
              text: t("没有符合筛选条件的记录"),
            }),
          ]
        : []),
    );
  }
  function render() {
    const prefs = preferences(),
      root = el(document, "section", { id: "pk-data-page" }),
      toggle = el(document, "input", {
        type: "checkbox",
        id: "pk-pref-saveUsageHistory",
        "aria-label": t("保存调用记录"),
      });
    toggle.checked = prefs.saveUsageHistory;
    toggle.addEventListener("change", () =>
      onSave({ ...preferences(), saveUsageHistory: toggle.checked }),
    );
    const refresh = identified(
        button(document, t("刷新"), load),
        "pk-usage-refresh",
      ),
      clearButton = identified(
        button(document, t("清空记录"), clear),
        "pk-usage-clear",
      );
    refresh.disabled = loading || clearing;
    clearButton.disabled = clearing;
    root.append(
      el(
        document,
        "section",
        { class: "pk-settings-card" },
        el(
          document,
          "label",
          { class: "pk-settings-row", for: toggle.id },
          el(
            document,
            "span",
            {},
            el(document, "strong", { text: t("保存调用记录") }),
            el(document, "small", {
              text: t(
                "用于比较模型的用量与耗时。最多保留 30 天、500 条任务记录。",
              ),
            }),
          ),
          toggle,
        ),
        el(document, "p", {
          class: "pk-ai-muted",
          text: t(
            "关闭后，新任务仅在内存中显示统计。正在记录的任务会完成当前记录。",
          ),
        }),
        el(
          document,
          "div",
          { class: "pk-usage-controls" },
          el(document, "span", {
            text: format("已保存 {count} 条记录", { count: records.length }),
          }),
          refresh,
          clearButton,
        ),
      ),
    );
    if (error || persistence === "unavailable")
      root.append(
        el(document, "p", { role: "alert", text: error || t("记录保存失败") }),
      );
    const tabs = el(document, "div", {
      class: "pk-usage-tabs",
      role: "tablist",
      "aria-label": t("数据"),
    });
    for (const [name, label] of [
      ["history", "调用记录"],
      ["comparison", "模型对比"],
    ]) {
      const tab = identified(
        button(document, t(label), () => {
          view = name;
          page = 1;
          onChange();
        }),
        "pk-usage-" + name,
      );
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(view === name));
      tabs.append(tab);
    }
    const dateInvalid =
      filters.range === "custom" &&
      filters.from &&
      filters.to &&
      filters.from > filters.to;
    const numberInvalid =
      ["min", "max"].some(
        (key) =>
          filters[key] !== "" &&
          (!Number.isSafeInteger(Number(filters[key])) ||
            Number(filters[key]) < 0),
      ) ||
      (filters.min !== "" &&
        filters.max !== "" &&
        Number(filters.min) > Number(filters.max));
    const rows =
      dateInvalid || numberInvalid ? [] : filterUsageRecords(records, filters);
    root.append(filterPanel());
    if (dateInvalid || numberInvalid)
      root.append(
        el(document, "p", {
          role: "alert",
          text: t(
            dateInvalid
              ? "开始日期应早于或等于结束日期。"
              : "输入范围应为非负整数，最小值应小于或等于最大值。",
          ),
        }),
      );
    root.append(
      summaryCards(rows),
      tabs,
      el(
        document,
        "section",
        { id: "pk-usage-results", class: "pk-settings-card" },
        view === "history" ? historyTable(rows) : comparisonTable(rows),
      ),
    );
    if (!loaded && loading)
      root.append(
        el(document, "p", { role: "status", text: t("正在读取记录…") }),
      );
    else if (!records.length)
      root.append(
        el(document, "p", {
          class: "pk-ai-muted",
          text: t("开启保存后，新任务会出现在这里。"),
        }),
      );
    root.append(
      el(document, "p", {
        class: "pk-ai-muted",
        text:
          t("记录保存在此浏览器本地。") +
          " " +
          t("估算值带 ≈，缺失数据按有效样本覆盖率显示。"),
      }),
    );
    return root;
  }
  return { render, load, clear };
}
