import React from "react";
import { z } from "zod/v3";
import { genUiRegistry } from "./registry";
import type { GenerativeUiComponentEntry } from "./types";

/** 懒加载 MVP 组件 */
const LazyLineChart = React.lazy(() => import("@/generative-ui/components/line-chart"));
const LazyBarChart = React.lazy(() => import("@/generative-ui/components/bar-chart"));
const LazyFormCard = React.lazy(() => import("@/generative-ui/components/generative-form-card"));
const LazyDataTable = React.lazy(() => import("@/generative-ui/components/data-table"));

genUiRegistry.registerAll({
  line_chart: {
    component: LazyLineChart as unknown as GenerativeUiComponentEntry["component"],
    category: "chart",
    icon: "chart-line",
    propsSchema: z.object({
      title: z.string().optional(),
      xAxis: z.string(),
      yAxis: z.string(),
      data: z.array(z.record(z.unknown())),
      height: z.number().int().min(200).max(600).default(300),
      color: z.string().optional(),
    }),
    defaultProps: { height: 300 },
    description: "折线图，用于时间序列或连续数据趋势展示",
    actions: [
      {
        name: "point_click",
        payloadSchema: z.object({
          index: z.number(),
          point: z.record(z.unknown()),
        }),
        description: "用户点击了折线上的数据点",
      },
    ],
  },

  bar_chart: {
    component: LazyBarChart as unknown as GenerativeUiComponentEntry["component"],
    category: "chart",
    icon: "chart-bar",
    propsSchema: z.object({
      title: z.string().optional(),
      label: z.string(),
      value: z.string(),
      data: z.array(z.record(z.unknown())),
      height: z.number().int().min(150).max(500).default(280),
    }),
    defaultProps: { height: 280 },
    description: "柱状图，用于分类数据对比",
    actions: [
      {
        name: "bar_click",
        payloadSchema: z.object({
          index: z.number(),
          category: z.record(z.unknown()),
        }),
        description: "用户点击了柱状图中的柱子",
      },
    ],
  },

  form: {
    component: LazyFormCard as unknown as GenerativeUiComponentEntry["component"],
    category: "form",
    icon: "form",
    propsSchema: z.object({
      title: z.string().optional(),
      fields: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          type: z.enum(["text", "number", "select", "textarea", "date"]),
          placeholder: z.string().optional(),
          required: z.boolean().default(false),
          options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        }),
      ),
      submitLabel: z.string().default("提交"),
    }),
    defaultProps: { submitLabel: "提交" },
    description: "表单，用于收集用户结构化输入",
    actions: [
      {
        name: "change",
        payloadSchema: z.object({ field: z.string(), value: z.unknown() }),
        description: "用户修改了表单字段值",
      },
      {
        name: "submit",
        payloadSchema: z.object({ values: z.record(z.unknown()) }),
        description: "用户提交了表单",
      },
    ],
  },

  table: {
    component: LazyDataTable as unknown as GenerativeUiComponentEntry["component"],
    category: "table",
    icon: "table",
    propsSchema: z.object({
      title: z.string().optional(),
      columns: z.array(
        z.object({
          key: z.string(),
          title: z.string(),
          sortable: z.boolean().default(false),
        }),
      ),
      rows: z.array(z.record(z.unknown())),
      pageSize: z.number().int().min(5).max(50).default(10),
    }),
    defaultProps: { pageSize: 10 },
    description: "数据表格，用于结构化数据展示",
    actions: [
      {
        name: "row_click",
        payloadSchema: z.object({
          index: z.number(),
          row: z.record(z.unknown()),
        }),
        description: "用户点击了表格行",
      },
      {
        name: "sort",
        payloadSchema: z.object({
          column: z.string(),
          direction: z.enum(["asc", "desc"]),
        }),
        description: "用户对列进行了排序",
      },
    ],
  },
});
