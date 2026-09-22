/**
 * API 相关类型定义
 */
/** WebSocket 命令类型常量 */
export declare const WsCmd: {
    /** 认证订阅 */
    readonly SUBSCRIBE: "aibot_subscribe";
    /** 心跳 */
    readonly HEARTBEAT: "ping";
    /** 回复消息 */
    readonly RESPONSE: "aibot_respond_msg";
    /** 回复欢迎语 */
    readonly RESPONSE_WELCOME: "aibot_respond_welcome_msg";
    /** 更新模板卡片 */
    readonly RESPONSE_UPDATE: "aibot_respond_update_msg";
    /** 主动发送消息 */
    readonly SEND_MSG: "aibot_send_msg";
    /** 上传临时素材 - 初始化 */
    readonly UPLOAD_MEDIA_INIT: "aibot_upload_media_init";
    /** 上传临时素材 - 分片上传 */
    readonly UPLOAD_MEDIA_CHUNK: "aibot_upload_media_chunk";
    /** 上传临时素材 - 完成上传 */
    readonly UPLOAD_MEDIA_FINISH: "aibot_upload_media_finish";
    /** 消息推送回调 */
    readonly CALLBACK: "aibot_msg_callback";
    /** 事件推送回调 */
    readonly EVENT_CALLBACK: "aibot_event_callback";
};
/**
 * WebSocket 帧结构
 *
 * 发送和接收统一使用 { cmd, headers, body } 格式：
 * - 认证发送：{ cmd: "aibot_subscribe", headers: { req_id }, body: { secret, bot_id } }
 * - 消息推送：{ cmd: "aibot_msg_callback", headers: { req_id }, body: { msgid, msgtype, ... } }
 * - 事件推送：{ cmd: "aibot_event_callback", headers: { req_id }, body: { event_type, ... } }
 * - 回复消息：{ cmd: "aibot_respond_msg", headers: { req_id }, body: { msgtype, stream: { ... } } }
 * - 回复欢迎语：{ cmd: "aibot_respond_welcome_msg", headers: { req_id }, body: { ... } }
 * - 更新模板卡片：{ cmd: "aibot_respond_update_msg", headers: { req_id }, body: { ... } }
 * - 心跳发送：{ cmd: "ping", headers: { req_id } }
 * - 认证/心跳响应：{ headers: { req_id }, errcode: 0, errmsg: "ok" }
 */
export interface WsFrame<T = any> {
    /** 命令类型；认证/心跳响应时可能为空 */
    cmd?: string;
    /** 请求头信息 */
    headers: {
        req_id: string;
        [key: string]: any;
    };
    /** 消息体 */
    body?: T;
    /** 响应错误码，认证/心跳响应时存在 */
    errcode?: number;
    /** 响应错误信息，认证/心跳响应时存在 */
    errmsg?: string;
}
/** 仅包含 headers 的 WsFrame 子集，用于 reply / replyStream 等方法的参数类型 */
export type WsFrameHeaders = Pick<WsFrame, 'headers'>;
/** 回复消息中的图文混排子项 */
export interface ReplyMsgItem {
    /** 类型：image */
    msgtype: 'image';
    /** 图片内容 */
    image: {
        /** Base64 编码的图片数据，图片（base64编码前）最大不能超过10M，支持JPG、PNG格式 */
        base64: string;
        /** 图片内容（base64编码前）的 MD5 值 */
        md5: string;
    };
}
/** 回复消息中的反馈信息 */
export interface ReplyFeedback {
    /** 反馈 ID，有效长度为 256 字节以内，必须是 utf-8 编码 */
    id: string;
}
/** 流式回复消息体 */
export interface StreamReplyBody {
    msgtype: 'stream';
    stream: {
        /** 流式消息 ID，首次回复时设置，后续使用相同 ID 刷新内容 */
        id: string;
        /** 是否结束流式消息 */
        finish?: boolean;
        /** 回复内容（支持 Markdown），最长不超过 20480 个字节，必须是 utf8 编码 */
        content?: string;
        /** 图文混排消息列表，目前仅当 finish=true 时支持设置，最多 10 个 */
        msg_item?: ReplyMsgItem[];
        /** 反馈信息，首次回复时设置 */
        feedback?: ReplyFeedback;
    };
}
/** 欢迎语回复消息体（文本类型） */
export interface WelcomeTextReplyBody {
    msgtype: 'text';
    text: {
        /** 欢迎语文本内容 */
        content: string;
    };
}
/** 欢迎语回复消息体（模板卡片类型） */
export interface WelcomeTemplateCardReplyBody {
    msgtype: 'template_card';
    template_card: TemplateCard;
}
/** 欢迎语回复消息体联合类型 */
export type WelcomeReplyBody = WelcomeTextReplyBody | WelcomeTemplateCardReplyBody;
/** 模板卡片回复消息体 */
export interface TemplateCardReplyBody {
    /** 消息类型，固定值 template_card */
    msgtype: 'template_card';
    /** 模板卡片内容 */
    template_card: TemplateCard;
}
/** 流式消息 + 模板卡片组合回复消息体 */
export interface StreamWithTemplateCardReplyBody {
    msgtype: 'stream_with_template_card';
    stream: StreamReplyBody['stream'];
    template_card?: TemplateCard;
}
/** 更新模板卡片消息体 */
export interface UpdateTemplateCardBody {
    /** 响应类型，固定值 update_template_card */
    response_type: 'update_template_card';
    /** 要替换模版卡片消息的 userid 列表。若不填，则表示替换当前消息涉及到的所有用户 */
    userids?: string[];
    /** 要替换的模版卡片内容 */
    template_card: TemplateCard;
}
/** 卡片类型枚举 */
export declare enum TemplateCardType {
    /** 文本通知模版卡片 */
    TextNotice = "text_notice",
    /** 图文展示模版卡片 */
    NewsNotice = "news_notice",
    /** 按钮交互模版卡片 */
    ButtonInteraction = "button_interaction",
    /** 投票选择模版卡片 */
    VoteInteraction = "vote_interaction",
    /** 多项选择模版卡片 */
    MultipleInteraction = "multiple_interaction"
}
/** 卡片来源样式信息 */
export interface TemplateCardSource {
    /** 来源图片的 url */
    icon_url?: string;
    /** 来源图片的描述，建议不超过 13 个字 */
    desc?: string;
    /** 来源文字的颜色，0(默认)灰色，1 黑色，2 红色，3 绿色 */
    desc_color?: 0 | 1 | 2 | 3;
}
/** 卡片右上角更多操作按钮 */
export interface TemplateCardActionMenu {
    /** 更多操作界面的描述 */
    desc: string;
    /** 操作列表，长度取值范围为 [1, 3] */
    action_list: Array<{
        /** 操作的描述文案 */
        text: string;
        /** 操作 key 值，最长支持 1024 字节，不可重复 */
        key: string;
    }>;
}
/** 模板卡片主标题 */
export interface TemplateCardMainTitle {
    /** 一级标题，建议不超过 26 个字 */
    title?: string;
    /** 标题辅助信息，建议不超过 30 个字 */
    desc?: string;
}
/** 关键数据样式 */
export interface TemplateCardEmphasisContent {
    /** 关键数据样式的数据内容，建议不超过 10 个字 */
    title?: string;
    /** 关键数据样式的数据描述内容，建议不超过 15 个字 */
    desc?: string;
}
/** 引用文献样式 */
export interface TemplateCardQuoteArea {
    /** 引用文献样式区域点击事件，0 或不填代表没有点击事件，1 代表跳转 url，2 代表跳转小程序 */
    type?: 0 | 1 | 2;
    /** 点击跳转的 url，type 是 1 时必填 */
    url?: string;
    /** 点击跳转的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 点击跳转的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
    /** 引用文献样式的标题 */
    title?: string;
    /** 引用文献样式的引用文案 */
    quote_text?: string;
}
/** 二级标题+文本列表 */
export interface TemplateCardHorizontalContent {
    /** 链接类型，0 或不填代表普通文本，1 代表跳转 url，3 代表点击跳转成员详情 */
    type?: 0 | 1 | 3;
    /** 二级标题，建议不超过 5 个字 */
    keyname: string;
    /** 二级文本，建议不超过 26 个字 */
    value?: string;
    /** 链接跳转的 url，type 是 1 时必填 */
    url?: string;
    /** 成员详情的 userid，type 是 3 时必填 */
    userid?: string;
}
/** 跳转指引样式 */
export interface TemplateCardJumpAction {
    /** 跳转链接类型，0 或不填代表不是链接，1 代表跳转 url，2 代表跳转小程序，3 代表触发消息智能回复 */
    type?: 0 | 1 | 2 | 3;
    /** 跳转链接样式的文案内容，建议不超过 13 个字 */
    title: string;
    /** 跳转链接的 url，type 是 1 时必填 */
    url?: string;
    /** 跳转链接的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 跳转链接的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
    /** 智能问答问题，最长不超过 200 个字节，type 为 3 时必填 */
    question?: string;
}
/** 整体卡片的点击跳转事件 */
export interface TemplateCardAction {
    /** 卡片跳转类型，0 或不填代表不是链接，1 代表跳转 url，2 代表打开小程序 */
    type: 0 | 1 | 2;
    /** 跳转事件的 url，type 是 1 时必填 */
    url?: string;
    /** 跳转事件的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 跳转事件的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
}
/** 卡片二级垂直内容 */
export interface TemplateCardVerticalContent {
    /** 卡片二级标题，建议不超过 26 个字 */
    title: string;
    /** 二级普通文本，建议不超过 112 个字 */
    desc?: string;
}
/** 图片样式 */
export interface TemplateCardImage {
    /** 图片的 url */
    url: string;
    /** 图片的宽高比，宽高比要小于 2.25，大于 1.3，不填默认 1.3 */
    aspect_ratio?: number;
}
/** 左图右文样式 */
export interface TemplateCardImageTextArea {
    /** 左图右文样式区域点击事件，0 或不填代表没有点击事件，1 代表跳转 url，2 代表跳转小程序 */
    type?: 0 | 1 | 2;
    /** 点击跳转的 url，type 是 1 时必填 */
    url?: string;
    /** 点击跳转的小程序的 appid，type 是 2 时必填 */
    appid?: string;
    /** 点击跳转的小程序的 pagepath，type 是 2 时选填 */
    pagepath?: string;
    /** 左图右文样式的标题 */
    title?: string;
    /** 左图右文样式的描述 */
    desc?: string;
    /** 左图右文样式的图片 url */
    image_url: string;
}
/** 提交按钮样式 */
export interface TemplateCardSubmitButton {
    /** 按钮文案，建议不超过 10 个字 */
    text: string;
    /** 提交按钮的 key，最长支持 1024 字节 */
    key: string;
}
/** 下拉式选择器 */
export interface TemplateCardSelectionItem {
    /** 下拉式选择器题目的 key，最长支持 1024 字节，不可重复 */
    question_key: string;
    /** 选择器的标题，建议不超过 13 个字 */
    title?: string;
    /** 是否不可选，false 为可选，true 为不可选（仅更新模版卡片时有效） */
    disable?: boolean;
    /** 默认选定的 id，不填或错填默认第一个 */
    selected_id?: string;
    /** 选项列表，不超过 10 个，最少 1 个 */
    option_list: Array<{
        /** 选项 id，最长支持 128 字节，不可重复 */
        id: string;
        /** 选项文案，建议不超过 10 个字 */
        text: string;
    }>;
}
/** 模板卡片按钮 */
export interface TemplateCardButton {
    /** 按钮文案，建议不超过 10 个字 */
    text: string;
    /** 按钮样式，1~4，不填或错填默认 1 */
    style?: number;
    /** 按钮 key 值，最长支持 1024 字节，不可重复 */
    key: string;
}
/** 选择题样式（投票选择） */
export interface TemplateCardCheckbox {
    /** 选择题 key 值，最长支持 1024 字节 */
    question_key: string;
    /** 是否不可选，false 为可选，true 为不可选（仅更新模版卡片时有效） */
    disable?: boolean;
    /** 选择题模式，单选：0，多选：1，不填默认 0 */
    mode?: 0 | 1;
    /** 选项列表，不超过 20 个，最少 1 个 */
    option_list: Array<{
        /** 选项 id，最长支持 128 字节，不可重复 */
        id: string;
        /** 选项文案描述，建议不超过 11 个字 */
        text: string;
        /** 该选项是否默认选中 */
        is_checked?: boolean;
    }>;
}
/** 模板卡片结构（通用类型，包含所有可能的字段） */
export interface TemplateCard {
    /** 卡片类型 */
    card_type: string;
    /** 卡片来源样式信息 */
    source?: TemplateCardSource;
    /** 卡片右上角更多操作按钮 */
    action_menu?: TemplateCardActionMenu;
    /** 模版卡片的主要内容 */
    main_title?: TemplateCardMainTitle;
    /** 关键数据样式，建议不与引用样式共用 */
    emphasis_content?: TemplateCardEmphasisContent;
    /** 引用文献样式，建议不与关键数据共用 */
    quote_area?: TemplateCardQuoteArea;
    /** 二级普通文本，建议不超过 112 个字 */
    sub_title_text?: string;
    /** 二级标题+文本列表，列表长度不超过 6 */
    horizontal_content_list?: TemplateCardHorizontalContent[];
    /** 跳转指引样式的列表，列表长度不超过 3 */
    jump_list?: TemplateCardJumpAction[];
    /** 整体卡片的点击跳转事件 */
    card_action?: TemplateCardAction;
    /** 图片样式（news_notice 类型卡片使用） */
    card_image?: TemplateCardImage;
    /** 左图右文样式（news_notice 类型卡片使用） */
    image_text_area?: TemplateCardImageTextArea;
    /** 卡片二级垂直内容，列表长度不超过 4（news_notice 类型卡片使用） */
    vertical_content_list?: TemplateCardVerticalContent[];
    /** 下拉式的选择器（button_interaction 类型卡片使用） */
    button_selection?: TemplateCardSelectionItem;
    /** 按钮列表，列表长度不超过 6（button_interaction 类型卡片使用） */
    button_list?: TemplateCardButton[];
    /** 选择题样式（vote_interaction 类型卡片使用） */
    checkbox?: TemplateCardCheckbox;
    /** 下拉式选择器列表，最多支持 3 个（multiple_interaction 类型卡片使用） */
    select_list?: TemplateCardSelectionItem[];
    /** 提交按钮样式（vote_interaction / multiple_interaction 类型卡片使用） */
    submit_button?: TemplateCardSubmitButton;
    /** 任务 ID，同一个机器人不能重复，只能由数字、字母和"_-@"组成，最长 128 字节 */
    task_id?: string;
    /** 反馈信息 */
    feedback?: ReplyFeedback;
}
/** 模板卡片回复消息体 */
export interface TemplateCardReplyBody {
    /** 消息类型，固定值 template_card */
    msgtype: 'template_card';
    /** 模板卡片内容 */
    template_card: TemplateCard;
}
/** 主动发送 Markdown 消息体 */
export interface SendMarkdownMsgBody {
    /** 消息类型，固定值 markdown */
    msgtype: 'markdown';
    /** markdown 消息内容 */
    markdown: {
        /** markdown 文本内容 */
        content: string;
    };
}
/** 主动发送模板卡片消息体 */
export interface SendTemplateCardMsgBody {
    /** 消息类型，固定值 template_card */
    msgtype: 'template_card';
    /** 模板卡片内容 */
    template_card: TemplateCard;
}
/** 主动发送消息体联合类型 */
export type SendMsgBody = SendMarkdownMsgBody | SendTemplateCardMsgBody | SendMediaMsgBody;
/** 更新模板卡片消息体 */
export interface UpdateTemplateCardBody {
    /** 响应类型，固定值 update_template_card */
    response_type: 'update_template_card';
    /** 要替换模版卡片消息的 userid 列表。若不填，则表示替换当前消息涉及到的所有用户 */
    userids?: string[];
    /** 要替换的模版卡片内容 */
    template_card: TemplateCard;
}
/** 企业微信媒体类型 */
export type WeComMediaType = 'file' | 'image' | 'voice' | 'video';
/** 媒体消息发送体（主动发送 + 被动回复共用） */
export interface SendMediaMsgBody {
    /** 消息类型 */
    msgtype: WeComMediaType;
    /** 文件消息 */
    file?: {
        media_id: string;
    };
    /** 图片消息 */
    image?: {
        media_id: string;
    };
    /** 语音消息 */
    voice?: {
        media_id: string;
    };
    /** 视频消息 */
    video?: {
        media_id: string;
        /** 视频消息的标题，不超过128个字节，超过会自动截断 */
        title?: string;
        /** 视频消息的描述，不超过512个字节，超过会自动截断 */
        description?: string;
    };
}
/** 上传素材初始化请求 body */
export interface UploadMediaInitBody {
    /** 素材类型 */
    type: WeComMediaType;
    /** 文件名 */
    filename: string;
    /** 文件总大小（字节） */
    total_size: number;
    /** 分片总数 */
    total_chunks: number;
    /** 文件 MD5 值（可选） */
    md5?: string;
}
/** 上传素材初始化响应 body */
export interface UploadMediaInitResult {
    /** 上传会话 ID */
    upload_id: string;
}
/** 上传素材分片请求 body */
export interface UploadMediaChunkBody {
    /** 上传会话 ID */
    upload_id: string;
    /** 分片索引（从 1 开始） */
    chunk_index: number;
    /** 分片数据（Base64 编码） */
    base64_data: string;
}
/** 完成上传请求 body */
export interface UploadMediaFinishBody {
    /** 上传会话 ID */
    upload_id: string;
}
/** 完成上传响应 body */
export interface UploadMediaFinishResult {
    /** 素材类型 */
    type: WeComMediaType;
    /** 临时素材 media_id，3天内有效 */
    media_id: string;
    /** 创建时间 */
    created_at: string;
}
/** uploadMedia 方法选项 */
export interface UploadMediaOptions {
    /** 素材类型 */
    type: WeComMediaType;
    /** 文件名 */
    filename: string;
}
