/**
 * Component metadata shared between Server (prompt generation) and App (registry).
 * The App registers actual React components under the same componentId.
 */

export interface GenerativeUiComponentMeta {
  componentId: string;
  category: "chart" | "table" | "form" | "map" | "media" | "layout";
  description: string;
  propsDescription: string;
  actions?: {
    name: string;
    description: string;
  }[];
}

/**
 * MVP component manifest. Extend this array when adding new components.
 * App reads this for prompt generation; the actual React components live in App.
 */
export const GENERATIVE_UI_COMPONENTS: GenerativeUiComponentMeta[] = [
  {
    componentId: "line_chart",
    category: "chart",
    description: "Line chart for time-series or continuous data trends.",
    propsDescription:
      "title (string, optional), data (array of { [key]: value }), xAxis (string: data field for x-axis), yAxis (string: data field for y-axis), height (number: 200-600, default 300), color (string, optional)",
    actions: [
      {
        name: "point_click",
        description: "User clicked a data point on the line",
      },
    ],
  },
  {
    componentId: "bar_chart",
    category: "chart",
    description: "Bar chart for categorical comparison.",
    propsDescription:
      "title (string, optional), data (array of { [key]: value }), label (string: category field), value (string: value field), height (number: 150-500, default 280)",
    actions: [
      {
        name: "bar_click",
        description: "User clicked a bar",
      },
    ],
  },
  {
    componentId: "table",
    category: "table",
    description: "Data table for structured data display.",
    propsDescription:
      "title (string, optional), columns (array of { key (string), title (string), sortable? (boolean, default false) }), rows (array of { [key]: value }), pageSize (number: 5-50, default 10)",
    actions: [
      {
        name: "row_click",
        description: "User clicked a row",
      },
      {
        name: "sort",
        description: "User sorted a column",
      },
    ],
  },
  {
    componentId: "form",
    category: "form",
    description: "Form for collecting structured user input.",
    propsDescription:
      'title (string, optional), fields (array of { name (string), label (string), type ("text"|"number"|"select"|"textarea"|"date"), placeholder? (string), required? (boolean, default false), options? (array of { label, value }) }), submitLabel (string, default "Submit")',
    actions: [
      {
        name: "change",
        description: "User changed a field value",
      },
      {
        name: "submit",
        description: "User submitted the form",
      },
    ],
  },
];

const CATEGORY_LABELS: Record<GenerativeUiComponentMeta["category"], string> = {
  chart: "Charts",
  table: "Tables",
  form: "Forms",
  map: "Maps",
  media: "Media",
  layout: "Layout",
};

/**
 * Generate a system prompt section describing available generative UI components.
 * Injected into every agent's system prompt via daemonAppendSystemPrompt.
 */
export function generateComponentPromptSection(): string {
  const lines: string[] = [];
  lines.push("## Generative UI Components");
  lines.push("");
  lines.push(
    "You can render interactive UI components by outputting a Markdown code fence " +
      "with the language identifier `chisacode-ui`. The user will see these as " +
      "interactive cards in the chat. User interactions will be relayed back to " +
      "you as context in subsequent turns.",
  );
  lines.push("");
  lines.push("Format:");
  lines.push("");
  lines.push("```chisacode-ui component=<componentId>");
  lines.push('{"prop1": "value1", "prop2": "value2"}');
  lines.push("```");
  lines.push("");

  const grouped = new Map<string, string[]>();
  for (const c of GENERATIVE_UI_COMPONENTS) {
    const items = grouped.get(c.category) ?? [];
    let desc = `- \`${c.componentId}\`: ${c.description}`;
    desc += `\n  Props: ${c.propsDescription}`;
    if (c.actions?.length) {
      desc += `\n  Actions: ` + c.actions.map((a) => `"${a.name}" (${a.description})`).join(", ");
    }
    items.push(desc);
    grouped.set(c.category, items);
  }

  for (const [cat, items] of grouped) {
    const catKey = cat as GenerativeUiComponentMeta["category"];
    lines.push(`### ${CATEGORY_LABELS[catKey]}`);
    lines.push(...items);
    lines.push("");
  }

  return lines.join("\n");
}
