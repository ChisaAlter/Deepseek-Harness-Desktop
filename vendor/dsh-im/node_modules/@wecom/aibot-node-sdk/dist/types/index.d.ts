/**
 * 类型定义统一导出
 */
export type { Logger } from './common';
export { WSAuthFailureError, WSReconnectExhaustedError } from './common';
export type { WSClientOptions } from './config';
export { MessageType, type BaseMessage, type TextMessage, type ImageMessage, type MixedMessage, type VoiceMessage, type FileMessage, type VideoMessage, type MessageFrom, type TextContent, type ImageContent, type MixedContent, type MixedMsgItem, type VoiceContent, type VideoContent, type FileContent, type QuoteContent, type ReplyOptions, type SendTextParams, type SendMarkdownParams, } from './message';
export { WsCmd, TemplateCardType } from './api';
export type { WsFrame, WsFrameHeaders, StreamReplyBody, ReplyMsgItem, ReplyFeedback, WelcomeTextReplyBody, WelcomeTemplateCardReplyBody, WelcomeReplyBody, TemplateCardMainTitle, TemplateCardButton, TemplateCardSource, TemplateCardActionMenu, TemplateCardEmphasisContent, TemplateCardQuoteArea, TemplateCardHorizontalContent, TemplateCardJumpAction, TemplateCardAction, TemplateCardVerticalContent, TemplateCardImage, TemplateCardImageTextArea, TemplateCardSubmitButton, TemplateCardSelectionItem, TemplateCardCheckbox, TemplateCard, TemplateCardReplyBody, StreamWithTemplateCardReplyBody, UpdateTemplateCardBody, SendMarkdownMsgBody, SendTemplateCardMsgBody, SendMsgBody, SendMediaMsgBody, WeComMediaType, UploadMediaOptions, UploadMediaFinishResult, UploadMediaInitBody, UploadMediaInitResult, UploadMediaChunkBody, UploadMediaFinishBody, } from './api';
export { EventType, type EventFrom, type EnterChatEvent, type TemplateCardEventData, type FeedbackEventData, type DisconnectedEventData, type EventContent, type EventMessage, type EventMessageWith, type WSClientEventMap, } from './event';
