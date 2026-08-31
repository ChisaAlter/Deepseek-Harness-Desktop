window.__ModuleLoader__.load({ id: "dshbot", factory: (require) => {
  const module = { exports: {} };
  const exports = module.exports;
  const react = require("react");
  const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  const { createElement: h, useState, useEffect, useMemo, useRef } = react;
  const {
    Button, Input, Menu, Modal, Pill,
    IconPlusOutline16, IconSearchOutline16, IconEllipsisOutline16,
    IconEditOutline16, IconTrashOutline16, IconCopyOutline16,
    IconAgentPresetOutline16,
  } = primitives;

  const NS = "dshbot";
  const TAB_ID = "bots";
  const DEFAULT_BOT_NAME = "新机器人";
  const GROUP_MIN_MEMBERS = 2;
  const GROUP_MAX_MEMBERS = 6;

  const zh = {
    tab: "机器人",
    search: "搜索",
    add: "添加",
    addBot: "添加新 Bot",
    addRoom: "创建群聊",
    empty: "还没有机器人",
    emptyHint: "点右上角加号添加联系人或群聊。群聊需要 2–6 名成员。",
    edit: "编辑资料",
    duplicate: "复制",
    delete: "删除",
    cancel: "取消",
    save: "保存",
    confirmDelete: "删除这个条目？会话不会从磁盘抹掉，只是从列表里消失。",
    name: "名称",
    title: "标题",
    description: "描述 / 人设",
    personaHint: "芯片写入互不重叠的人设，仍可改。",
    personaOppose: "反对",
    personaFill: "补全",
    personaShip: "落地",
    personaSharp: "毒舌",
    model: "模型",
    workspace: "工作区",
    workspaceNone: "无目录",
    workspaceLocked: "有消息的机器人或已创建的群聊不能改工作区，请新建一个。",
    pin: "置顶",
    unpin: "取消置顶",
    hide: "隐藏",
    unhide: "取消隐藏",
    showHidden: "显示已隐藏",
    hideHidden: "收起已隐藏",
    members: "成员",
    membersHint: "选择 2–6 个已有机器人（不能选群）。",
    roomName: "群聊名称",
    defaultBotName: DEFAULT_BOT_NAME,
    defaultRoomName: "新群聊",
    provider: "供应商",
    noModel: "使用部署默认",
    error: "出错了",
    saving: "正在保存…",
    close: "关闭",
    avatar: "头像",
    avatarBlob: "机器人",
    avatarUpload: "上传",
    avatarPick: "选择图片",
    avatarCircle: "圆形",
    avatarSquare: "方形",
    avatarTooLarge: "图片太大，请换一张更小的。",
    avatarBadImage: "无法读取这张图片。",
    thinking: "思考中",
    roomBadge: "群",
  };

  const en = {
    tab: "Bots",
    search: "Search",
    add: "Add",
    addBot: "New bot",
    addRoom: "New group",
    empty: "No bots yet",
    emptyHint: "Use the plus button to add a contact or group. Groups need 2–6 members.",
    edit: "Edit profile",
    duplicate: "Duplicate",
    delete: "Delete",
    cancel: "Cancel",
    save: "Save",
    confirmDelete: "Remove this entry? The session stays on disk; it only leaves the list.",
    name: "Name",
    title: "Title",
    description: "Description / persona",
    personaHint: "Chips write non-overlapping personas you can still edit.",
    personaOppose: "Oppose",
    personaFill: "Fill",
    personaShip: "Ship",
    personaSharp: "Sharp",
    model: "Model",
    workspace: "Workspace",
    workspaceNone: "No directory",
    workspaceLocked: "A bot with messages or an established group cannot change workspace. Create a new one.",
    pin: "Pin",
    unpin: "Unpin",
    hide: "Hide",
    unhide: "Unhide",
    showHidden: "Show hidden",
    hideHidden: "Hide hidden list",
    members: "Members",
    membersHint: "Pick 2–6 existing bots (not groups).",
    roomName: "Group name",
    defaultBotName: "New bot",
    defaultRoomName: "New group",
    provider: "Provider",
    noModel: "Deployment default",
    error: "Something went wrong",
    saving: "Saving…",
    close: "Close",
    avatar: "Avatar",
    avatarBlob: "Robot",
    avatarUpload: "Upload",
    avatarPick: "Choose image",
    avatarCircle: "Circle",
    avatarSquare: "Square",
    avatarTooLarge: "That image is too large. Pick a smaller one.",
    avatarBadImage: "Could not read that image.",
    thinking: "Thinking",
    roomBadge: "Group",
  };

  const CSS = `
.dshbot-page, .dshbot-form, .dshbot-bubble, .dshbot-roster, .dshbot-avatar-slot {
  --dshbot-blob-ink: var(--dsw-alias-label-primary);
  --dshbot-blob-brown: color-mix(in srgb, var(--dsw-static-amber-600) 70%, var(--dsw-static-neutral-bluish-1000));
  --dshbot-blob-red: var(--dsw-static-red-500);
  --dshbot-blob-orange: var(--dsw-static-amber-500);
  --dshbot-blob-yellow: var(--dsw-static-amber-400);
  --dshbot-blob-green: var(--dsw-static-green-500);
  --dshbot-blob-teal: color-mix(in srgb, var(--dsw-static-green-500) 55%, var(--dsw-static-deepseek-500));
  --dshbot-blob-blue: var(--dsw-static-deepseek-500);
  --dshbot-blob-purple: color-mix(in srgb, var(--dsw-static-red-500) 40%, var(--dsw-static-deepseek-600));
  --dshbot-blob-pink: color-mix(in srgb, var(--dsw-static-red-400) 70%, var(--dsw-static-neutral-bluish-00));
  --dshbot-blob-grey: var(--dsw-alias-label-tertiary);
}
.dshbot-page { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
.dshbot-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 0 8px; }
.dshbot-toolbar .dshbot-search { flex: 1; min-width: 0; }
.dshbot-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.dshbot-row { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; color: inherit; text-align: start; padding: 8px 10px; border-radius: 10px; cursor: pointer; }
.dshbot-row:hover, .dshbot-row[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshbot-row-top { display: flex; align-items: baseline; gap: 8px; }
.dshbot-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-time { margin-left: auto; flex-shrink: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshbot-preview { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-avatar-frame { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: visible; }
.dshbot-avatar-frame[data-crop="circle"] { border-radius: 50%; overflow: hidden; }
.dshbot-avatar-frame[data-crop="square"] { border-radius: 10px; overflow: hidden; }
.dshbot-avatar-image { width: 100%; height: 100%; object-fit: cover; display: block; }
.dshbot-avatar-frame[data-thinking="true"] .dshbot-avatar-image { animation: dshbot-image-think var(--ds-transition-duration-slow) var(--ds-ease-in-out) infinite alternate; }
@keyframes dshbot-image-think { from { transform: scale(1); } to { transform: scale(1.12); } }
.dshbot-blob { width: 100%; height: 100%; display: block; overflow: visible; }
.dshbot-blob-eyes { transform: translate(var(--eye-x, 0px), var(--eye-y, 0px)); transition: transform var(--ds-transition-duration) var(--ds-ease-in-out); }
.dshbot-blob-eye-white { fill: var(--dsw-static-neutral-bluish-00); stroke: var(--dsw-static-neutral-bluish-1000); stroke-width: 1.15; }
.dshbot-avatar-frame[data-thinking="true"] .dshbot-blob-eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: dshbot-blob-blink calc(var(--ds-transition-duration-slow) * 4) var(--ds-ease-in-out) infinite;
}
@keyframes dshbot-blob-blink {
  0%, 70%, 100% { transform: scaleY(1); }
  76% { transform: scaleY(0.12); }
  82% { transform: scaleY(1); }
}
.dshbot-blob-eye-pupil { fill: var(--dsw-static-neutral-bluish-1000); }
.dshbot-picker { display: flex; flex-direction: column; gap: 12px; }
.dshbot-picker-blob { display: flex; flex-direction: column; gap: 12px; }
.dshbot-pills { display: flex; gap: 4px; flex-wrap: wrap; }
.dshbot-shape-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.dshbot-shape-cell { aspect-ratio: 1; border: 0; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); color: inherit; display: flex; align-items: center; justify-content: center; padding: 8px; cursor: pointer; }
.dshbot-shape-cell[aria-pressed="true"] { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.dshbot-swatch { width: 28px; height: 28px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; background: var(--swatch); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
.dshbot-swatch[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--dsw-alias-label-primary-foreground), 0 0 0 1px var(--dsw-alias-border-l2); }
.dshbot-upload { display: flex; flex-direction: column; gap: 12px; }
.dshbot-blob-ink { color: var(--dshbot-blob-ink); }
.dshbot-blob-brown { color: var(--dshbot-blob-brown); }
.dshbot-blob-red { color: var(--dshbot-blob-red); }
.dshbot-blob-orange { color: var(--dshbot-blob-orange); }
.dshbot-blob-yellow { color: var(--dshbot-blob-yellow); }
.dshbot-blob-green { color: var(--dshbot-blob-green); }
.dshbot-blob-teal { color: var(--dshbot-blob-teal); }
.dshbot-blob-blue { color: var(--dshbot-blob-blue); }
.dshbot-blob-purple { color: var(--dshbot-blob-purple); }
.dshbot-blob-pink { color: var(--dshbot-blob-pink); }
.dshbot-blob-grey { color: var(--dshbot-blob-grey); }
@media (prefers-reduced-motion: reduce) {
  .dshbot-blob-eyes { transition: none; }
  .dshbot-avatar-frame[data-thinking="true"] .dshbot-avatar-image,
  .dshbot-avatar-frame[data-thinking="true"] .dshbot-blob-eye { animation: none; }
}
.dshbot-empty { padding: 24px 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
.dshbot-roster { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; max-width: 480px; }
.dshbot-roster-member { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 72px; }
.dshbot-roster-name { font-size: 13px; color: var(--dsw-alias-label-primary); text-align: center; max-width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshbot-error { padding: 8px 10px; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dshbot-rail { width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-primary); display: flex; align-items: center; justify-content: center; }
.dshbot-modal { max-height: calc(100vh - 48px); }
.dshbot-form { display: flex; flex-direction: column; gap: 12px; min-width: min(420px, 100%); max-height: calc(100vh - 200px); overflow: auto; }
.dshbot-field { display: flex; flex-direction: column; gap: 6px; }
.dshbot-field label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshbot-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshbot-members { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow: auto; }
.dshbot-member { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dshbot-avatar-slot { position: relative; display: inline-flex; flex-shrink: 0; }
.dshbot-activity-dot {
  position: absolute; right: -2px; bottom: -2px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-label-primary); box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
}
.dshbot-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  font-size: 9px;
  line-height: 1;
  padding: 2px 3px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
.dshbot-bubble { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; padding: 0; background: transparent; max-width: 100%; }
.dshbot-bubble-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.dshbot-bubble-name { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dshbot-bubble-text {
  font-size: 14px;
  white-space: pre-wrap;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--dsw-alias-interactive-bg-hover);
  width: fit-content;
  max-width: 100%;
}
.dshbot-bubble-text[data-pending="true"] { color: var(--dsw-alias-label-tertiary); }
.dshbot-bubble-omit { display: none; }
.dshbot-footer { display: flex; justify-content: flex-end; gap: 8px; }
.dshbot-official-entry { position: relative; flex: none; display: flex; align-items: center; width: 100%; }
.dshbot-official-entry.dshbot-official-rail { width: 36px; }
.dshbot-official-trigger {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% + 8px); height: 34px; margin: 4px -4px; padding: 6px 2px 6px 10px;
  box-sizing: border-box; border: none; border-radius: 12px; background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 14px; line-height: 22px;
  cursor: pointer; overflow: hidden;
}
.dshbot-official-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshbot-official-trigger[aria-expanded="true"] { color: var(--dsw-alias-label-primary); }
.dshbot-official-trigger-label { overflow: hidden; white-space: nowrap; }
.dshbot-official-rail .dshbot-official-trigger {
  width: 36px; height: 36px; margin: 8px 0; justify-content: center; padding: 0; border-radius: 50%;
}
.dshbot-official-overlay { position: fixed; inset: 0; z-index: 1000; }
.dshbot-official-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); }
.dshbot-official-panel {
  position: absolute; left: 12px; bottom: 96px; z-index: 1;
  display: flex; flex-direction: column; gap: 8px;
  width: min(360px, calc(100vw - 24px)); height: min(560px, calc(100vh - 140px));
  padding: 16px; box-sizing: border-box;
  border-radius: 16px; background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-alias-shadow-m);
  color: var(--dsw-alias-label-primary);
}
.dshbot-official-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none;
}
.dshbot-official-panel-head h2 {
  margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary);
}
.dshbot-official-panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dshbot-official-panel-body .dshbot-page { height: 100%; }
`;

  function injectCss() {
    if (typeof document === "undefined") return;
    let el = document.querySelector('style[data-plugin-css="dshbot"]');
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-plugin-css", "dshbot");
      document.head.appendChild(el);
    }
    el.textContent = CSS;
  }

  const BLOB_SHAPES = ["circle", "soft", "square", "pill", "triangle", "hex", "cloud", "drop"];
  const BLOB_COLORS = ["ink", "brown", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey"];
  const BLOB_SHAPE_RADII = {
    circle: [22, 22, 22, 22, 22, 22, 22, 22],
    soft: [20, 25, 21, 24, 19, 23, 22, 26],
    square: [18, 26, 18, 26, 18, 26, 18, 26],
    pill: [14, 18, 26, 18, 14, 18, 26, 18],
    triangle: [26, 16, 12, 22, 13, 22, 12, 16],
    hex: [20, 24, 24, 20, 24, 24, 20, 24],
    cloud: [14, 26, 22, 18, 16, 18, 22, 26],
    drop: [12, 16, 20, 24, 26, 24, 20, 16],
  };
  const IMAGE_AVATAR_MAX_CHARS = 120000;
  const IMAGE_DATA_URL = /^data:image\/(jpeg|jpg|png);base64,/i;
  const HANDLE_K = (4 / 3) * Math.tan(Math.PI / 16);
  const PERSONA_TEMPLATES = [
    {
      id: "oppose",
      labelKey: "personaOppose",
      text: "专找漏洞和未说明的前提。不要重复已经有人提出的方案。如果没有新的反对点，保持沉默。",
    },
    {
      id: "fill",
      labelKey: "personaFill",
      text: "只补被漏掉的约束、边界条件和例外。不要重写别人已经说清的方案。",
    },
    {
      id: "ship",
      labelKey: "personaShip",
      text: "只谈能不能做、缺什么输入、下一步谁来做。不要空谈愿景。",
    },
    {
      id: "sharp",
      labelKey: "personaSharp",
      text: "话短、带刺、不迎合。没有新的刺就不说话。",
    },
  ];

  function avatarSeedHash(seed) {
    const text = String(seed ?? "");
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash;
  }

  function defaultBlobAvatar(seed) {
    const hash = avatarSeedHash(seed);
    return {
      kind: "blob",
      shape: BLOB_SHAPES[hash % BLOB_SHAPES.length],
      color: BLOB_COLORS[Math.floor(hash / BLOB_SHAPES.length) % BLOB_COLORS.length],
    };
  }

  function assertImageAvatar(dataUrl, crop) {
    const url = String(dataUrl ?? "");
    const nextCrop = crop === "square" ? "square" : crop === "circle" ? "circle" : "";
    if (nextCrop !== "circle" && nextCrop !== "square") {
      throw new Error("avatar crop must be circle or square");
    }
    if (!IMAGE_DATA_URL.test(url)) {
      throw new Error("avatar image must be a jpeg or png data URL");
    }
    if (url.length > IMAGE_AVATAR_MAX_CHARS) {
      throw new Error("avatar image is too large");
    }
    return { kind: "image", dataUrl: url, crop: nextCrop };
  }

  function normalizeAvatar(raw, seed) {
    if (raw && raw.kind === "image") {
      try { return assertImageAvatar(raw.dataUrl, raw.crop); } catch { return defaultBlobAvatar(seed); }
    }
    if (raw && raw.kind === "blob" && BLOB_SHAPES.includes(raw.shape) && BLOB_COLORS.includes(raw.color)) {
      return { kind: "blob", shape: raw.shape, color: raw.color };
    }
    return defaultBlobAvatar(seed);
  }

  function blobPath(shape, squash, lean) {
    const radii = BLOB_SHAPE_RADII[shape] || BLOB_SHAPE_RADII.circle;
    const amount = Number(squash) || 0;
    const shear = Number(lean) || 0;
    const squat = Math.max(0, amount);
    const stretch = Math.max(0, -amount);
    const n = 8;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const r = radii[i] * (
        1
        - squat * 0.42 * (ny * ny)
        + squat * 0.36 * (nx * nx)
        + stretch * 0.12 * (ny * ny)
        - stretch * 0.22 * (nx * nx)
      );
      pts.push({
        x: 32 + r * nx + shear * 7 * (0.35 - ny),
        y: 32 + r * ny + squat * 7 - stretch * 2,
        a,
        r,
      });
    }
    const cmds = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      const h0 = p0.r * HANDLE_K;
      const h1 = p1.r * HANDLE_K;
      const a0 = p0.a + Math.PI / 2;
      const a1 = p1.a + Math.PI / 2;
      if (i === 0) cmds.push(`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`);
      cmds.push(
        `C ${(p0.x + Math.cos(a0) * h0).toFixed(2)} ${(p0.y + Math.sin(a0) * h0).toFixed(2)} `
        + `${(p1.x - Math.cos(a1) * h1).toFixed(2)} ${(p1.y - Math.sin(a1) * h1).toFixed(2)} `
        + `${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      );
    }
    cmds.push("Z");
    return cmds.join(" ");
  }

  function prefersReducedMotion() {
    return typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function durationSlowMs() {
    if (typeof window === "undefined" || !window.getComputedStyle || !window.document) return 300;
    const raw = window.getComputedStyle(window.document.documentElement)
      .getPropertyValue("--ds-transition-duration-slow")
      .trim();
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return 300;
    return raw.endsWith("ms") ? n : n * 1000;
  }

  function bakeAvatarImage(file, size = 192) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          if (dataUrl.length > IMAGE_AVATAR_MAX_CHARS) {
            reject(new Error("avatar image is too large"));
            return;
          }
          resolve(dataUrl);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("bad image"));
      };
      img.src = url;
    });
  }

  function AvatarView(props) {
    const { thinking, size } = props;
    const live = props.live !== false;
    const seed = props.seed || props.name;
    const resolved = normalizeAvatar(props.avatar, seed);
    const pathRef = useRef(null);
    const eyesRef = useRef(null);
    const px = size || 32;

    useEffect(() => {
      if (!live) return undefined;
      if (resolved.kind !== "blob") return undefined;
      if (prefersReducedMotion()) return undefined;
      const tickEyes = () => {
        const el = eyesRef.current;
        if (!el) return;
        const range = thinking ? 7 : 2.2;
        el.style.setProperty("--eye-x", `${(Math.random() * 2 - 1) * range}px`);
        el.style.setProperty("--eye-y", `${(Math.random() * 2 - 1) * range * 0.6}px`);
      };
      tickEyes();
      const eyesId = setInterval(tickEyes, thinking ? durationSlowMs() : 1400);
      const raf = { id: 0 };
      if (thinking) {
        const origin = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
        const period = durationSlowMs() * 2;
        const step = (now) => {
          const path = pathRef.current;
          if (path) {
            const t = (now - origin) / period;
            const squash = Math.sin(t * Math.PI * 2);
            const lean = Math.sin(t * Math.PI * 2 / 1.35 + 0.8);
            path.setAttribute("d", blobPath(resolved.shape, squash, lean));
          }
          raf.id = requestAnimationFrame(step);
        };
        raf.id = requestAnimationFrame(step);
      } else if (pathRef.current) {
        pathRef.current.setAttribute("d", blobPath(resolved.shape, 0, 0));
      }
      return () => {
        clearInterval(eyesId);
        if (raf.id) cancelAnimationFrame(raf.id);
      };
    }, [resolved.kind, resolved.shape, thinking, live]);

    if (resolved.kind === "image") {
      return h("span", {
        className: "dshbot-avatar-frame",
        "data-crop": resolved.crop,
        "data-thinking": thinking && live ? "true" : undefined,
        style: { width: px, height: px },
      }, h("img", { className: "dshbot-avatar-image", src: resolved.dataUrl, alt: "" }));
    }

    return h("span", {
      className: `dshbot-avatar-frame dshbot-blob-${resolved.color}`,
      "data-thinking": thinking && live ? "true" : undefined,
      style: { width: px, height: px },
    }, h("svg", { className: "dshbot-blob", viewBox: "0 0 64 64", "aria-hidden": "true" },
      h("path", { ref: pathRef, className: "dshbot-blob-body", d: blobPath(resolved.shape, 0), fill: "currentColor" }),
      h("g", { ref: eyesRef, className: "dshbot-blob-eyes" },
        h("g", { className: "dshbot-blob-eye" },
          h("ellipse", { className: "dshbot-blob-eye-white", cx: 25, cy: 30, rx: 5.2, ry: 6.4 }),
          h("circle", { className: "dshbot-blob-eye-pupil", cx: 26.2, cy: 31, r: 2.45 }),
        ),
        h("g", { className: "dshbot-blob-eye" },
          h("ellipse", { className: "dshbot-blob-eye-white", cx: 39, cy: 30, rx: 5.2, ry: 6.4 }),
          h("circle", { className: "dshbot-blob-eye-pupil", cx: 40.2, cy: 31, r: 2.45 }),
        ),
      ),
    ));
  }

  function AvatarPicker(props) {
    const { t, onChange } = props;
    const seed = props.seed || props.name;
    const resolved = normalizeAvatar(props.avatar, seed);
    const blobColor = resolved.kind === "blob" ? resolved.color : "ink";
    const blobShape = resolved.kind === "blob" ? resolved.shape : "circle";
    const [tab, setTab] = useState(resolved.kind === "image" ? "upload" : "blob");
    const [error, setError] = useState("");
    const fileRef = useRef(null);

    useEffect(() => {
      setTab(resolved.kind === "image" ? "upload" : "blob");
    }, [resolved.kind]);

    return h("div", { className: "dshbot-picker" },
      h("div", { className: "dshbot-pills" },
        h(Pill, { active: tab === "blob", onClick: () => setTab("blob") }, t("avatarBlob")),
        h(Pill, { active: tab === "upload", onClick: () => setTab("upload") }, t("avatarUpload")),
      ),
      tab === "blob"
        ? h("div", { className: "dshbot-picker-blob" },
          h("div", { className: "dshbot-shape-grid" },
            BLOB_SHAPES.map((shape) => h("button", {
              key: shape,
              type: "button",
              className: "dshbot-shape-cell",
              "aria-pressed": resolved.kind === "blob" && resolved.shape === shape ? "true" : "false",
              onClick: () => onChange({ kind: "blob", shape, color: blobColor }),
            }, h(AvatarView, {
              avatar: { kind: "blob", shape, color: blobColor },
              seed,
              size: 36,
              live: props.live,
            }))),
          ),
          h("div", { className: "dshbot-swatches" },
            BLOB_COLORS.map((color) => h("button", {
              key: color,
              type: "button",
              className: "dshbot-swatch",
              style: { "--swatch": `var(--dshbot-blob-${color})` },
              "aria-label": color,
              "aria-pressed": resolved.kind === "blob" && resolved.color === color ? "true" : "false",
              onClick: () => onChange({ kind: "blob", shape: blobShape, color }),
            })),
          ),
        )
        : h("div", { className: "dshbot-upload" },
          h("input", {
            ref: fileRef,
            type: "file",
            accept: "image/*",
            hidden: true,
            onChange: async (event) => {
              const file = event.target.files && event.target.files[0];
              event.target.value = "";
              if (!file) return;
              try {
                const dataUrl = await bakeAvatarImage(file);
                onChange(assertImageAvatar(dataUrl, resolved.kind === "image" ? resolved.crop : "circle"));
                setError("");
              } catch (err) {
                setError(err && /too large/.test(String(err.message)) ? t("avatarTooLarge") : t("avatarBadImage"));
              }
            },
          }),
          h(Button, {
            variant: "outline",
            onClick: () => { if (fileRef.current) fileRef.current.click(); },
          }, t("avatarPick")),
          h("div", { className: "dshbot-pills" },
            h(Pill, {
              active: (resolved.kind === "image" ? resolved.crop : "circle") === "circle",
              onClick: () => {
                if (resolved.kind === "image") onChange({ ...resolved, crop: "circle" });
              },
            }, t("avatarCircle")),
            h(Pill, {
              active: (resolved.kind === "image" ? resolved.crop : "circle") === "square",
              onClick: () => {
                if (resolved.kind === "image") onChange({ ...resolved, crop: "square" });
              },
            }, t("avatarSquare")),
          ),
          error ? h("div", { className: "dshbot-error", role: "alert" }, error) : null,
        ),
    );
  }

  function filterItems(items, query) {
    const needle = String(query ?? "").trim().toLowerCase();
    if (!needle) return [...items];
    return items.filter((item) => [item.name, item.title, item.description].filter(Boolean).join("\n").toLowerCase().includes(needle));
  }

  function emptyRoster(items, sessionId) {
    if (!sessionId) return null;
    const item = items.find((entry) => entry.sessionId === sessionId);
    if (!item) return null;
    if (item.kind === "room") {
      const members = [];
      for (const botId of item.memberBotIds ?? []) {
        const member = items.find((entry) => entry.id === botId);
        if (member) members.push(member);
      }
      return members;
    }
    return [item];
  }

  function upsertItem(items, item) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index < 0) return [...items, item];
    const next = [...items];
    next[index] = item;
    return next;
  }

  function newId() {
    return globalThis.crypto?.randomUUID?.() ?? `dshbot-${Date.now().toString(36)}`;
  }

  function formatTime(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function rpcValue(response) {
    const result = response?.result ?? response;
    if (result && result.ok === false) {
      const error = new Error(result.error?.message || "rpc failed");
      error.rpcError = result.error;
      throw error;
    }
    return result?.value ?? result;
  }

  function catalogItems(snap) {
    if (Array.isArray(snap?.value?.items)) return snap.value.items;
    if (Array.isArray(snap?.items)) return snap.items;
    return [];
  }

  function contactCreateOpts({ workspaceId, agentPreset, scratchCwd }) {
    return {
      origin: "dshbot",
      ...(agentPreset ? { agentPreset } : {}),
      ...(workspaceId ? { workspaceId } : (scratchCwd ? { cwd: scratchCwd } : {})),
    };
  }

  async function createContactSession(ctx, { workspaceId, agentPreset }) {
    let scratchCwd;
    if (!workspaceId) {
      try {
        const connection = ctx.connection ?? ctx.get("connection");
        const described = rpcValue(await connection.api.host.describe({}));
        if (typeof described?.scratchCwd === "string") scratchCwd = described.scratchCwd;
      } catch {
        scratchCwd = undefined;
      }
    }
    return ctx.sessions.create(contactCreateOpts({ workspaceId, agentPreset, scratchCwd }));
  }

  function DummyTab() {
    return null;
  }

  /** Keep lockstep with `lib/sidebar-host.js` hostDeclaresRegionTabs. */
  function hostDeclaresRegionTabs(slots) {
    if (!slots || typeof slots.spec !== "function") return false;
    try {
      return Boolean(slots.spec("sidebar.nav.tab") && slots.spec("sidebar.page"));
    } catch {
      return false;
    }
  }

  /** Keep lockstep with `lib/sidebar-host.js` hostDeclaresFooterAction. */
  function hostDeclaresFooterAction(slots) {
    if (!slots || typeof slots.spec !== "function") return false;
    try {
      return Boolean(slots.spec("sidebar.footer.action"));
    } catch {
      return false;
    }
  }

  function OfficialBotsEntry(props) {
    const {
      wide, t, useSessions, useCatalog, useEditor,
      addBot, createRoom, openItem, openEditor, duplicateItem, requestDelete,
      togglePin, toggleHide, stampRoomPresets,
    } = props;
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (!open) return undefined;
      const onKey = (event) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [open]);
    return h("div", {
      className: wide ? "dshbot-official-entry" : "dshbot-official-entry dshbot-official-rail",
    },
      h("button", {
        type: "button",
        className: "dshbot-official-trigger",
        "data-dshbot-official-trigger": "",
        "aria-haspopup": "dialog",
        "aria-expanded": open ? "true" : "false",
        "aria-label": t("tab"),
        onClick: () => setOpen((value) => !value),
      },
        h(IconAgentPresetOutline16, { size: wide ? 16 : 18 }),
        wide ? h("span", { className: "dshbot-official-trigger-label" }, t("tab")) : null,
      ),
      open ? h("div", { className: "dshbot-official-overlay", role: "presentation" },
        h("div", {
          className: "dshbot-official-mask",
          "aria-hidden": "true",
          onClick: () => setOpen(false),
        }),
        h("div", {
          className: "dshbot-official-panel",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("tab"),
          "data-dshbot-official-panel": "",
        },
          h("div", { className: "dshbot-official-panel-head" },
            h("h2", null, t("tab")),
            h(Button, {
              variant: "ghost",
              size: "sm",
              "aria-label": t("cancel"),
              onClick: () => setOpen(false),
            }, t("cancel")),
          ),
          h("div", { className: "dshbot-official-panel-body" },
            h(BotPage, {
              wide: true,
              expandSidebar: () => {},
              t,
              useSessions,
              useCatalog,
              useEditor,
              addBot,
              createRoom,
              openItem,
              openEditor,
              duplicateItem,
              requestDelete,
              togglePin,
              toggleHide,
              stampRoomPresets,
            }),
          ),
        ),
      ) : null,
    );
  }

  function EmptyRoster(props) {
    const { sessionId, useCatalog } = props;
    const catalogSnap = useCatalog((s) => s);
    const roster = emptyRoster(catalogItems(catalogSnap), sessionId);
    if (!roster || roster.length === 0) return null;
    return h("div", { className: "dshbot-roster" },
      roster.map((item) => h("div", { key: item.id, className: "dshbot-roster-member" },
        h(AvatarView, { avatar: item.avatar, name: item.name, seed: item.id || item.name, size: 48, live: false }),
        h("span", { className: "dshbot-roster-name" }, item.name || item.title || item.id),
      )),
    );
  }

  function BotPage(props) {
    const {
      wide, expandSidebar, t, useSessions, useCatalog, useEditor,
      addBot, createRoom, openItem, openEditor, duplicateItem, requestDelete,
      togglePin, toggleHide, stampRoomPresets,
    } = props;
    const sessions = useSessions((s) => s);
    const catalogSnap = useCatalog((s) => s);
    const editor = useEditor((s) => s);
    const [query, setQuery] = useState("");
    const [plusOpen, setPlusOpen] = useState(false);
    const [menu, setMenu] = useState(null);
    const [showHidden, setShowHidden] = useState(false);
    const items = catalogItems(catalogSnap);
    const visible = useMemo(() => {
      const filtered = filterItems(items, query).filter((item) => showHidden || item.hidden !== true);
      const pinned = filtered
        .filter((item) => item.pinned === true)
        .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
      const rest = filtered
        .filter((item) => item.pinned !== true)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return [...pinned, ...rest];
    }, [items, query, showHidden]);
    const currentId = sessions?.current;
    useEffect(() => {
      stampRoomPresets?.(sessions?.byId);
    }, [stampRoomPresets, sessions, items]);

    if (!wide) {
      return h("button", {
        type: "button",
        className: "dshbot-rail",
        "aria-label": t("tab"),
        onClick: expandSidebar,
      }, h(IconAgentPresetOutline16, { size: 18 }));
    }

    return h("div", { className: "dshbot-page" },
      h("div", { className: "dshbot-toolbar" },
        h(Input, {
          className: "dshbot-search",
          value: query,
          placeholder: t("search"),
          "aria-label": t("search"),
          icon: h(IconSearchOutline16, { size: 16 }),
          onChange: (event) => setQuery(event.target.value),
        }),
        h(Button, {
          variant: "ghost",
          size: "sm",
          "aria-label": showHidden ? t("hideHidden") : t("showHidden"),
          onClick: () => setShowHidden((value) => !value),
        }, showHidden ? t("hideHidden") : t("showHidden")),
        h(Menu, {
          open: plusOpen,
          portal: true,
          align: "end",
          onClose: () => setPlusOpen(false),
          onSelect: (id) => {
            setPlusOpen(false);
            if (id === "bot") addBot();
            if (id === "room") createRoom();
          },
          items: [
            { id: "bot", label: t("addBot") },
            {
              id: "room",
              label: t("addRoom"),
              disabled: items.filter((item) => item.kind !== "room").length < GROUP_MIN_MEMBERS,
            },
          ],
          anchor: h(Button, {
            variant: "ghost",
            size: "sm",
            "aria-label": t("add"),
            icon: h(IconPlusOutline16, { size: 16 }),
            onClick: () => setPlusOpen(true),
          }),
        }),
      ),
      editor?.error ? h("div", { className: "dshbot-error", role: "alert" }, editor.error) : null,
      visible.length === 0
        ? h("div", { className: "dshbot-empty" }, t("empty"), h("div", { className: "dshbot-hint" }, t("emptyHint")))
        : h("div", { className: "dshbot-list", role: "list" },
          visible.map((item) => {
            const session = sessions?.byId?.[item.sessionId];
            const isRoom = item.kind === "room";
            const preview = isRoom ? "" : (item.model?.model || t("noModel"));
            const active = currentId === item.sessionId;
            return h("button", {
              key: item.id,
              type: "button",
              className: "dshbot-row",
              role: "listitem",
              "data-active": active ? "true" : undefined,
              onClick: () => openItem(item),
              onContextMenu: (event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, itemId: item.id });
              },
            },
              h("span", {
                className: "dshbot-avatar-slot",
                "data-kind": isRoom ? "room" : undefined,
              },
                h(AvatarView, {
                  avatar: item.avatar,
                  seed: item.id || item.name,
                  thinking: false,
                  size: 32,
                }),
                isRoom ? h("span", { className: "dshbot-badge" }, t("roomBadge")) : null,
                session?.running ? h("span", {
                  className: "dshbot-activity-dot",
                  title: "running",
                  "aria-label": "running",
                }) : null,
              ),
              h("span", { className: "dshbot-row-body" },
                h("span", { className: "dshbot-row-top" },
                  h("span", { className: "dshbot-name" }, item.name),
                  h("span", { className: "dshbot-time" }, formatTime(session?.updatedAt || item.updatedAt)),
                ),
                preview ? h("span", { className: "dshbot-preview" }, preview) : null,
              ),
            );
          }),
        ),
      h(Menu, {
        open: menu !== null,
        portal: true,
        getAnchorRect: () => (menu ? new DOMRect(menu.x, menu.y, 0, 0) : null),
        onClose: () => setMenu(null),
        onSelect: (id) => {
          const item = items.find((entry) => entry.id === menu?.itemId);
          setMenu(null);
          if (!item) return;
          if (id === "edit") openEditor(item.id);
          if (id === "duplicate") duplicateItem(item.id);
          if (id === "pin") togglePin?.(item.id);
          if (id === "hide") toggleHide?.(item.id);
          if (id === "delete") requestDelete(item.id);
        },
        items: [
          { id: "edit", label: t("edit"), icon: h(IconEditOutline16, { size: 16 }) },
          { id: "duplicate", label: t("duplicate"), icon: h(IconCopyOutline16, { size: 16 }) },
          {
            id: "pin",
            label: itemPinnedLabel(items, menu?.itemId, t),
          },
          {
            id: "hide",
            label: itemHiddenLabel(items, menu?.itemId, t),
          },
          { type: "separator", id: "sep" },
          { id: "delete", label: t("delete"), danger: true, icon: h(IconTrashOutline16, { size: 16 }) },
        ],
        anchor: h("span"),
      }),
    );
  }

  function itemPinnedLabel(items, itemId, t) {
    const item = items.find((entry) => entry.id === itemId);
    return item?.pinned === true ? t("unpin") : t("pin");
  }

  function itemHiddenLabel(items, itemId, t) {
    const item = items.find((entry) => entry.id === itemId);
    return item?.hidden === true ? t("unhide") : t("hide");
  }

  function EditorOverlay(props) {
    const {
      t, useCatalog, useEditor, useSessions, useWorkspaces, closeEditor, saveItem, confirmDelete, createRoomSubmit, connection,
    } = props;
    const catalogSnap = useCatalog((s) => s);
    const editor = useEditor((s) => s);
    const sessions = useSessions((s) => s);
    const workspaces = useWorkspaces((s) => s);
    const items = catalogItems(catalogSnap);
    const item = items.find((entry) => entry.id === editor.itemId);
    const open = Boolean(editor.open);
    const isRoomCreate = editor.mode === "create-room";
    const isDelete = editor.mode === "delete";
    const isRoom = isRoomCreate || item?.kind === "room";
    const session = item ? sessions?.byId?.[item.sessionId] : undefined;
    const workspaceLocked = Boolean(item && (item.kind === "room" || session?.blank === false));

    const [name, setName] = useState("");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [workspaceId, setWorkspaceId] = useState("");
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState("");
    const [memberIds, setMemberIds] = useState([]);
    const [catalog, setCatalog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [avatar, setAvatar] = useState(null);

    useEffect(() => {
      if (!open) return;
      if (isRoomCreate) {
        setName(t("defaultRoomName"));
        setTitle("");
        setDescription("");
        setWorkspaceId("");
        setMemberIds([]);
        setAvatar(null);
        return;
      }
      if (!item) return;
      setName(item.name || "");
      setTitle(item.title || "");
      setDescription(item.description || "");
      setWorkspaceId(item.workspaceId || "");
      setProvider(item.model?.provider || "");
      setModel(item.model?.model || "");
      setMemberIds(Array.isArray(item.memberBotIds) ? item.memberBotIds : []);
      setAvatar(normalizeAvatar(item.avatar, item.id || item.name));
    }, [open, editor.itemId, editor.mode]);

    useEffect(() => {
      if (!open || isRoom || !item?.sessionId || !connection?.api?.sessions?.models) return;
      let cancelled = false;
      connection.api.sessions.models({ sessionId: item.sessionId }).then((response) => {
        if (cancelled) return;
        try {
          setCatalog(rpcValue(response));
        } catch {
          setCatalog(null);
        }
      }, () => {
        if (!cancelled) setCatalog(null);
      });
      return () => { cancelled = true; };
    }, [open, isRoom, item?.sessionId]);

    const workspaceItems = [
      { id: "", label: t("workspaceNone") },
      ...(workspaces?.items ?? []).map((workspace) => ({
        id: workspace.workspaceId,
        label: workspace.title || workspace.path,
      })),
    ];
    const groups = catalog?.groups ?? [];
    const botChoices = items.filter((entry) => entry.kind !== "room");

    const footer = isDelete
      ? h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", onClick: closeEditor }, t("cancel")),
        h(Button, { variant: "primary", onClick: () => confirmDelete(editor.itemId) }, t("delete")),
      )
      : h("div", { className: "dshbot-footer" },
        h(Button, { variant: "outline", onClick: closeEditor, disabled: busy }, t("cancel")),
        h(Button, {
          variant: "primary",
          disabled: busy || (isRoom && (
            memberIds.length < GROUP_MIN_MEMBERS || memberIds.length > GROUP_MAX_MEMBERS
          )),
          onClick: async () => {
            setBusy(true);
            try {
              if (isRoomCreate) {
                await createRoomSubmit({
                  name,
                  description,
                  workspaceId: workspaceId || undefined,
                  memberBotIds: memberIds,
                });
              } else if (item) {
                if (isRoom && (
                  memberIds.length < GROUP_MIN_MEMBERS || memberIds.length > GROUP_MAX_MEMBERS
                )) {
                  throw new Error(t("membersHint"));
                }
                await saveItem({
                  ...item,
                  name: name.trim() || t("defaultBotName"),
                  title: isRoom ? "" : title,
                  description,
                  avatar: isRoom
                    ? (item.avatar || defaultBlobAvatar(item.id || name))
                    : normalizeAvatar(avatar, item.id || name),
                  workspaceId: workspaceId || undefined,
                  memberBotIds: isRoom ? memberIds : item.memberBotIds,
                  model: (!isRoom && provider && model) ? { provider, model } : undefined,
                  updatedAt: Date.now(),
                }, { workspaceLocked });
              }
            } finally {
              setBusy(false);
            }
          },
        }, busy ? t("saving") : t("save")),
      );

    return h(Modal, {
      open,
      onClose: closeEditor,
      title: isDelete ? t("delete") : isRoom ? t("addRoom") : t("edit"),
      closeLabel: t("close"),
      className: "dshbot-modal",
      footer,
    },
      isDelete
        ? h("p", null, t("confirmDelete"))
        : h("div", { className: "dshbot-form" },
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("avatar")),
            h(AvatarView, {
              avatar,
              seed: item?.id || name,
              thinking: false,
              size: 72,
              live: open,
            }),
            h(AvatarPicker, {
              t,
              avatar,
              seed: item?.id || name,
              onChange: setAvatar,
              live: open,
            }),
          ) : null,
          h("div", { className: "dshbot-field" },
            h("label", null, isRoom ? t("roomName") : t("name")),
            h(Input, { value: name, onChange: (event) => setName(event.target.value) }),
          ),
          !isRoomCreate && !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("title")),
            h(Input, { value: title, onChange: (event) => setTitle(event.target.value) }),
          ) : null,
          h("div", { className: "dshbot-field" },
            h("label", null, t("description")),
            !isRoom ? h("div", { className: "dshbot-pills" },
              PERSONA_TEMPLATES.map((chip) => h(Pill, {
                key: chip.id,
                active: description === chip.text,
                onClick: () => setDescription(chip.text),
              }, t(chip.labelKey))),
            ) : null,
            !isRoom ? h("div", { className: "dshbot-hint" }, t("personaHint")) : null,
            h("textarea", {
              value: description,
              rows: isRoom ? 2 : 3,
              onChange: (event) => setDescription(event.target.value),
              style: {
                resize: "vertical",
                minHeight: isRoom ? "64px" : "96px",
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid var(--dsw-alias-border-l2)",
                background: "var(--dsw-alias-bg-layer-1)",
                color: "var(--dsw-alias-label-primary)",
                font: "inherit",
              },
            }),
          ),
          isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("members")),
            h("div", { className: "dshbot-hint" }, t("membersHint")),
            h("div", { className: "dshbot-members" },
              botChoices.map((bot) => h("label", { key: bot.id, className: "dshbot-member" },
                h("input", {
                  type: "checkbox",
                  checked: memberIds.includes(bot.id),
                  onChange: (event) => {
                    if (!event.target.checked && memberIds.length <= GROUP_MIN_MEMBERS) return;
                    setMemberIds(event.target.checked
                      ? (memberIds.length >= GROUP_MAX_MEMBERS
                        ? memberIds
                        : [...memberIds, bot.id])
                      : memberIds.filter((id) => id !== bot.id));
                  },
                  disabled: (!memberIds.includes(bot.id) && memberIds.length >= GROUP_MAX_MEMBERS)
                    || (memberIds.includes(bot.id) && memberIds.length <= GROUP_MIN_MEMBERS),
                }),
                h(AvatarView, { avatar: bot.avatar, seed: bot.id || bot.name, size: 24 }),
                bot.name,
              )),
            ),
          ) : null,
          !isRoom ? h("div", { className: "dshbot-field" },
            h("label", null, t("model")),
            h("select", {
              value: provider && model ? `${provider}::${model}` : "",
              onChange: (event) => {
                const value = event.target.value;
                if (!value) {
                  setProvider("");
                  setModel("");
                  return;
                }
                const split = value.indexOf("::");
                setProvider(value.slice(0, split));
                setModel(value.slice(split + 2));
              },
              style: {
                height: "36px",
                borderRadius: "10px",
                border: "1px solid var(--dsw-alias-border-l2)",
                background: "var(--dsw-alias-bg-layer-1)",
                color: "var(--dsw-alias-label-primary)",
              },
            },
              h("option", { value: "" }, t("noModel")),
              groups.flatMap((group) => (group.models ?? []).map((entry) => h("option", {
                key: `${group.id}::${entry.id}`,
                value: `${group.id}::${entry.id}`,
              }, `${group.name || group.id} / ${entry.name || entry.id}`))),
            ),
          ) : null,
          h("div", { className: "dshbot-field" },
            h("label", null, t("workspace")),
            h("select", {
              value: workspaceId,
              disabled: workspaceLocked,
              onChange: (event) => setWorkspaceId(event.target.value),
              style: {
                height: "36px",
                borderRadius: "10px",
                border: "1px solid var(--dsw-alias-border-l2)",
                background: "var(--dsw-alias-bg-layer-1)",
                color: "var(--dsw-alias-label-primary)",
              },
            },
              workspaceItems.map((entry) => h("option", { key: entry.id || "none", value: entry.id }, entry.label)),
            ),
            workspaceLocked ? h("div", { className: "dshbot-hint" }, t("workspaceLocked")) : null,
          ),
        ),
    );
  }

  function textsFromContent(content) {
    if (!Array.isArray(content)) return [];
    const parts = [];
    for (const part of content) {
      if (part?.type === "text" && typeof part.text === "string") {
        parts.push(part.text);
        continue;
      }
      if (part?.type === "tool-result" && Array.isArray(part.content)) {
        parts.push(...textsFromContent(part.content));
      }
    }
    return parts;
  }

  function isPassContent(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return true;
    return /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
  }

  function memberVisibleText(text) {
    const raw = String(text ?? "").replace(/[ \t]+$/gm, "").replace(/\s+$/u, "");
    const lines = raw.split("\n");
    const last = lines[lines.length - 1] ?? "";
    const visible = /^NEXT:\s*/i.test(last)
      ? lines.slice(0, -1).join("\n").replace(/\s+$/u, "")
      : raw;
    if (isPassContent(visible)) return "";
    return visible.trim();
  }

  function ParticipantBubble(props) {
    const { block } = props;
    const settled = block?.kind === "tool-result";
    const argsRaw = (settled ? block.call?.argsRaw : block?.argsRaw) ?? "";
    let botId = "";
    try {
      botId = JSON.parse(argsRaw)?.botId ?? "";
    } catch {
      botId = "";
    }
    // Each rendered text block is one send_room_message delivery (Grok
    // parity): a two-message member turn stays two visible room messages.
    const ownTexts = settled ? textsFromContent(block.content) : [];
    const resultTexts = ownTexts.length > 0
      ? ownTexts
      : (settled ? textsFromContent(block.resultView?.content) : []);
    const visibleTexts = resultTexts.map(memberVisibleText).filter(Boolean);
    const visible = visibleTexts.length > 0;
    const resultName = (typeof block?.resultView?.title === "string" && block.resultView.title)
      || (typeof block?.callView?.title === "string" && block.callView.title)
      || "";
    const catalogName = typeof props.memberName === "function" ? props.memberName(botId) : "";
    const catalogAvatar = typeof props.memberAvatar === "function" ? props.memberAvatar(botId) : undefined;
    const thinkingLabel = typeof props.thinking === "function" ? props.thinking() : "";
    const title = catalogName || resultName || (typeof block?.title === "string" && block.title) || botId || "Bot";
    const thinking = !settled;
    if (settled && !visible) {
      return h("span", { className: "dshbot-bubble-omit", "aria-hidden": "true" });
    }
    return h("div", { className: "dshbot-bubble" },
      h(AvatarView, { avatar: catalogAvatar, seed: botId, thinking, size: 32 }),
      h("div", { className: "dshbot-bubble-body" },
        h("div", { className: "dshbot-bubble-name" }, title),
        settled
          ? visibleTexts.map((text, index) => h("div", {
            key: index,
            className: "dshbot-bubble-text",
          }, text))
          : h("div", {
            className: "dshbot-bubble-text",
            "data-pending": "true",
          }, thinkingLabel),
      ),
    );
  }

  function hideRoomPresetList(api) {
    const agentPresets = api?.agentPresets;
    const list = agentPresets?.list;
    if (typeof list !== "function" || list.__dshbotHidden) return;
    const wrapped = async function hiddenRoomPresetList(...args) {
      const response = await list.apply(agentPresets, args);
      const presets = response?.result?.value?.presets;
      if (!response?.result?.ok || !Array.isArray(presets)) return response;
      return {
        ...response,
        result: {
          ...response.result,
          value: {
            ...response.result.value,
            presets: presets.filter((row) => row.id !== "dshbot-room"),
          },
        },
      };
    };
    wrapped.__dshbotHidden = true;
    agentPresets.list = wrapped;
  }

  function apply(ctx) {
    injectCss();
    hideRoomPresetList((ctx.connection ?? ctx.get("connection"))?.api);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dshbot: dictionaries");
    const t = ctx.locale.bind(NS);
    const catalog = ctx.settingsScope.bind({ namespace: "dshbot" });
    let editor = { open: false, mode: "edit", itemId: null, error: "" };
    const editorListeners = new Set();
    const editorSource = {
      getSnapshot: () => editor,
      subscribe: (listener) => {
        editorListeners.add(listener);
        return () => editorListeners.delete(listener);
      },
    };
    const setEditor = (next) => {
      editor = next;
      for (const listener of [...editorListeners]) listener();
    };
    const catalogSource = {
      getSnapshot: () => catalog.getSnapshot(),
      subscribe: (listener) => catalog.subscribe(listener),
    };

    const readItems = () => catalogItems(catalog.getSnapshot());

    const stampRoomPresets = (byId) => {
      const sessionsSvc = ctx.sessions ?? ctx.get("sessions");
      const note = sessionsSvc?.noteAgentPreset;
      const rows = byId ?? sessionsSvc?.list?.getSnapshot?.()?.byId;
      if (typeof note !== "function" || !rows) return;
      for (const item of readItems()) {
        if (item.kind !== "room" || !item.sessionId) continue;
        const row = rows[item.sessionId];
        if (!row || row.agentPreset === "dshbot-room") continue;
        note.call(sessionsSvc, item.sessionId, "dshbot-room");
      }
    };
    ctx.effect(() => catalog.subscribe(() => stampRoomPresets()), "dshbot: stamp room agentPreset");
    ctx.effect(() => {
      const list = (ctx.sessions ?? ctx.get("sessions"))?.list;
      if (!list?.subscribe) return undefined;
      return list.subscribe(() => stampRoomPresets());
    }, "dshbot: stamp room agentPreset on list");
    stampRoomPresets();

    const persistItems = async (items) => {
      await catalog.set("items", items);
    };

    const applyCatalogModel = async (sessionId, item) => {
      if (item?.kind === "room" || !item?.model?.provider || !item?.model?.model) return;
      const api = (ctx.connection ?? ctx.get("connection"))?.api?.sessions;
      if (!api?.selectModel) return;
      await api.selectModel({
        sessionId,
        provider: item.model.provider,
        model: item.model.model,
        persistDefault: false,
      });
    };

    const fail = (error) => {
      setEditor({ ...editor, error: error instanceof Error ? error.message : String(error) });
    };

    const injectFace = () => ({
      stampRoomPresets,
      connection: ctx.connection ?? ctx.get("connection"),
      memberName: (botId) => readItems().find((item) => item.id === botId || item.name === botId)?.name || "",
      memberAvatar: (botId) => {
        const item = readItems().find((entry) => entry.id === botId || entry.name === botId);
        return normalizeAvatar(item?.avatar, item?.id || botId);
      },
      thinking: () => t("thinking"),
      addBot: async () => {
        try {
          const sessionId = await createContactSession(ctx, {});
          const now = Date.now();
          const id = newId();
          const item = {
            id,
            kind: "bot",
            sessionId,
            name: t("defaultBotName"),
            title: "",
            description: "",
            avatar: defaultBlobAvatar(id),
            pinned: false,
            hidden: false,
            pinOrder: 0,
            inbox: [],
            createdAt: now,
            updatedAt: now,
          };
          await persistItems(upsertItem(readItems(), item));
          setEditor({ open: true, mode: "edit", itemId: item.id, error: "" });
          ctx.sessions.open(sessionId);
        } catch (error) {
          fail(error);
        }
      },
      createRoom: () => {
        setEditor({ open: true, mode: "create-room", itemId: null, error: "" });
      },
      createRoomSubmit: async ({ name, description, workspaceId, memberBotIds }) => {
        try {
          if (!Array.isArray(memberBotIds)
            || memberBotIds.length < GROUP_MIN_MEMBERS
            || memberBotIds.length > GROUP_MAX_MEMBERS) {
            fail(new Error(t("membersHint")));
            return;
          }
          const existing = readItems().find((entry) => {
            if (entry.kind !== "room") return false;
            const a = [...(entry.memberBotIds ?? [])].sort();
            const b = [...memberBotIds].sort();
            return a.length === b.length && a.every((id, index) => id === b[index]);
          });
          if (existing?.sessionId) {
            setEditor({ open: false, mode: "edit", itemId: null, error: "" });
            ctx.sessions.open(existing.sessionId);
            return;
          }
          const sessionId = await createContactSession(ctx, {
            workspaceId,
            agentPreset: "dshbot-room",
          });
          const now = Date.now();
          const id = newId();
          const item = {
            id,
            kind: "room",
            sessionId,
            name: name || t("defaultRoomName"),
            title: "",
            description: description || "",
            avatar: defaultBlobAvatar(id),
            workspaceId,
            memberBotIds,
            pinned: false,
            hidden: false,
            pinOrder: 0,
            inbox: [],
            createdAt: now,
            updatedAt: now,
          };
          await persistItems(upsertItem(readItems(), item));
          setEditor({ open: false, mode: "edit", itemId: null, error: "" });
          ctx.sessions.open(sessionId);
        } catch (error) {
          fail(error);
        }
      },
      openItem: (item) => {
        if (!item?.sessionId) return;
        if (item.kind === "room") stampRoomPresets();
        void applyCatalogModel(item.sessionId, item);
        ctx.sessions.open(item.sessionId);
      },
      openEditor: (itemId) => {
        setEditor({ open: true, mode: "edit", itemId, error: "" });
      },
      closeEditor: () => setEditor({ open: false, mode: "edit", itemId: null, error: editor.error }),
      requestDelete: (itemId) => setEditor({ open: true, mode: "delete", itemId, error: "" }),
      confirmDelete: async (itemId) => {
        await persistItems(readItems().filter((item) => item.id !== itemId));
        setEditor({ open: false, mode: "edit", itemId: null, error: "" });
      },
      duplicateItem: async (itemId) => {
        const source = readItems().find((item) => item.id === itemId);
        if (!source) return;
        try {
          const sessionId = await createContactSession(ctx, {
            workspaceId: source.workspaceId,
            agentPreset: source.kind === "room" ? "dshbot-room" : undefined,
          });
          const now = Date.now();
          const copy = {
            ...source,
            id: newId(),
            sessionId,
            name: `${source.name} 副本`,
            inbox: [],
            createdAt: now,
            updatedAt: now,
          };
          delete copy.memberChildren;
          await persistItems(upsertItem(readItems(), copy));
          ctx.sessions.open(sessionId);
        } catch (error) {
          fail(error);
        }
      },
      togglePin: async (itemId) => {
        const items = readItems();
        const source = items.find((item) => item.id === itemId);
        if (!source) return;
        const pinned = source.pinned !== true;
        const maxOrder = items
          .filter((item) => item.pinned)
          .reduce((max, item) => Math.max(max, Number(item.pinOrder) || 0), 0);
        await persistItems(upsertItem(items, {
          ...source,
          pinned,
          pinOrder: pinned ? maxOrder + 1 : 0,
          updatedAt: Date.now(),
        }));
      },
      toggleHide: async (itemId) => {
        const items = readItems();
        const source = items.find((item) => item.id === itemId);
        if (!source) return;
        await persistItems(upsertItem(items, {
          ...source,
          hidden: source.hidden !== true,
          updatedAt: Date.now(),
        }));
      },
      saveItem: async (next, { workspaceLocked } = {}) => {
        try {
          const current = readItems().find((item) => item.id === next.id);
          if (!current) return;
          const session = ctx.sessions.list.getSnapshot().byId[current.sessionId];
          let sessionId = current.sessionId;
          const workspaceChanged = (current.workspaceId || "") !== (next.workspaceId || "");
          if (workspaceChanged) {
            if (workspaceLocked || session?.blank === false) {
              next = { ...next, workspaceId: current.workspaceId };
            } else {
              sessionId = await createContactSession(ctx, {
                workspaceId: next.workspaceId,
                agentPreset: current.kind === "room" ? "dshbot-room" : undefined,
              });
              next = { ...next, sessionId };
            }
          }
          await persistItems(upsertItem(readItems(), next));
          const api = (ctx.connection ?? ctx.get("connection"))?.api?.sessions;
          if (api?.rename && next.name) {
            try { await api.rename({ sessionId, title: next.name }); } catch { /* title projection is best-effort */ }
          }
          await applyCatalogModel(sessionId, next);
          setEditor({ open: false, mode: "edit", itemId: null, error: "" });
          ctx.sessions.open(sessionId);
        } catch (error) {
          fail(error);
        }
      },
      hooks: { catalog: catalogSource, editor: editorSource },
    });

    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: "dshbot-editor",
      locale: NS,
      inject: injectFace,
    }, EditorOverlay));

    // Region tabs are a desktop-fork seat. Official npm sidebar has
    // footer.action only — inject into undeclared names waits forever (silent).
    if (hostDeclaresRegionTabs(ctx.slots)) {
      ctx.slots.inject("sidebar.nav.tab", () => ctx.slots.register({
        name: "sidebar.nav.tab",
        id: TAB_ID,
        order: 10,
        label: () => t("tab"),
        locale: NS,
      }, DummyTab));

      ctx.slots.inject("sidebar.page", () => ctx.slots.register({
        name: "sidebar.page",
        key: TAB_ID,
        locale: NS,
        inject: injectFace,
      }, BotPage));
    } else if (hostDeclaresFooterAction(ctx.slots)) {
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "dshbot-bots",
        order: 10,
        locale: NS,
        inject: injectFace,
      }, OfficialBotsEntry));
    }

    ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
      name: "tool.call.toolview",
      key: "ask_participant",
      locale: NS,
      inject: injectFace,
    }, ParticipantBubble));

    ctx.slots.inject("conversation.chat.empty", () => ctx.slots.register({
      name: "conversation.chat.empty",
      id: "dshbot-roster",
      locale: NS,
      inject: injectFace,
    }, EmptyRoster));

    const inputTriggers = ctx.inputTriggers ?? ctx.get("inputTriggers");
    if (inputTriggers?.registerSource) {
      ctx.effect(() => inputTriggers.registerSource({
        trigger: "@",
        name: "dshbot",
        order: 0,
        candidates(session, req) {
          const items = readItems();
          const room = items.find((item) => item.sessionId === session.sessionId && item.kind === "room");
          if (!room) return Promise.resolve([]);
          const needle = String(req.query ?? "").trim().toLowerCase();
          const rows = [];
          if (!needle || "everyone".includes(needle) || "all".includes(needle)) {
            rows.push({ name: "everyone" });
          }
          for (const id of room.memberBotIds ?? []) {
            const bot = items.find((item) => item.id === id && item.kind !== "room");
            if (!bot) continue;
            const name = String(bot.name ?? "").trim();
            if (!name) continue;
            if (needle && !name.toLowerCase().includes(needle) && !String(id).toLowerCase().includes(needle)) continue;
            rows.push({ name });
          }
          return Promise.resolve(rows);
        },
        lexicon(session) {
          const items = readItems();
          const room = items.find((item) => item.sessionId === session.sessionId && item.kind === "room");
          if (!room) return [];
          const names = (room.memberBotIds ?? []).map((id) => {
            const bot = items.find((item) => item.id === id && item.kind !== "room");
            return String(bot?.name ?? "").trim();
          }).filter(Boolean);
          return ["everyone", ...names];
        },
        subscribeLexicon(_session, listener) {
          return catalog.subscribe(listener);
        },
        onPick({ candidate }) {
          return { text: `@${candidate.name} ` };
        },
      }), "dshbot: @ members");
    }
  }

  exports.name = "dsh-bot";
  exports.inject = ["slots", "locale", "sessions", "workspaces", "settingsScope", "connection", "remote", "inputTriggers"];
  exports.apply = apply;
  return module.exports;
}});
