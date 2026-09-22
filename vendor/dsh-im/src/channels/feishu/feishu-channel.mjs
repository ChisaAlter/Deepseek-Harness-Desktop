import { createHash } from 'node:crypto';

import { trackOutboundArtifactProviderPromise } from '../shared/semantic/artifact.mjs';
import { createDeliveryReceipt } from '../shared/semantic/delivery.mjs';
import { t } from '../shared/i18n.mjs';

const STREAM_ELEMENT_ID = 'stream_md';
const DEFAULT_INITIAL_TEXT = '已连接 DeepSeek Harness，正在思考…';
const MAX_STREAM_CHARS = 28000;
const MAX_FILE_OPERATION_TIMEOUT_MS = 120_000;

const FILE_DELIVERY_ERRORS = new Map([
  [99991672, ['artifact-permission-required', 'Feishu file delivery requires the im:resource permission.']],
  [234006, ['artifact-too-large', 'The result file exceeds Feishu\'s size limit.']],
  [234010, ['artifact-empty', 'Feishu does not accept empty files.']],
  [230017, ['artifact-provider-rejected', 'Feishu rejected the uploaded file ownership.']],
  [230020, ['artifact-rate-limited', 'Feishu temporarily rate-limited file delivery.']],
  [230049, ['artifact-delivery-uncertain', 'Feishu could not confirm the file message result.']],
  [230055, ['artifact-provider-rejected', 'Feishu rejected the file message type.']],
]);

function assertApiSuccess(operation, response) {
  if (response?.code && response.code !== 0) {
    throw new Error(`${operation} failed: ${response.msg || response.code}`);
  }
  return response;
}

function providerErrorCode(cause) {
  const pending = [cause];
  const seen = new Set();
  let fallback;
  while (pending.length > 0) {
    const value = pending.shift();
    if (!value || seen.has(value)) continue;
    if (typeof value === 'object') seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const code = Number(value?.code);
    if (Number.isFinite(code) && code !== 0) {
      if (FILE_DELIVERY_ERRORS.has(code)) return code;
      fallback ??= code;
    }
    pending.push(value?.response?.data, value?.data, value?.error, value?.cause);
  }
  return fallback;
}

function fileDeliveryError(stage, cause, providerCode, { uncertain = false } = {}) {
  const explicitCode = providerCode === undefined || providerCode === null
    ? undefined
    : Number(providerCode);
  const code = Number.isFinite(explicitCode) && explicitCode !== 0
    ? explicitCode
    : providerErrorCode(cause);
  const fallback = Number.isFinite(code)
    ? ['artifact-provider-rejected', `Feishu rejected file ${stage}.`]
    : uncertain
      ? ['artifact-delivery-uncertain', 'Feishu could not confirm the file message result.']
      : ['artifact-provider-failed', `Feishu file ${stage} failed.`];
  const [errorCode, message] = FILE_DELIVERY_ERRORS.get(code) ?? fallback;
  const error = new Error(message, { cause });
  error.code = errorCode;
  if (Number.isFinite(code)) error.providerCode = code;
  return error;
}

function boundedFileTimeout(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILE_OPERATION_TIMEOUT_MS) {
    throw new TypeError(`${name} must be an integer between 1 and ${MAX_FILE_OPERATION_TIMEOUT_MS}`);
  }
  return value;
}

function abortReason(signal) {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function operationTimeout(stage) {
  const error = new Error(`Feishu file ${stage} timed out.`);
  error.code = 'provider-timeout';
  return error;
}

function waitForFileOperation(operation, { signal, timeoutMs, stage }) {
  signal?.throwIfAborted();
  const deadline = new AbortController();
  const operationSignal = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operationSignal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(
      reject,
      signal?.aborted ? abortReason(signal) : operationTimeout(stage),
    );
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    operationSignal.addEventListener('abort', onAbort, { once: true });

    Promise.resolve().then(() => operation(operationSignal)).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (operationSignal.aborted) onAbort();
  });
}

function deliveryUuid(file, chatId, messageType) {
  const seed = `${file.deliveryKey}\u0000${chatId}`;
  const digest = createHash('sha256')
    .update(messageType === 'file' ? seed : `${seed}\u0000${messageType}`)
    .digest('hex')
    .slice(0, 40);
  return `dshim_${digest}`;
}

function summaryOf(text) {
  const summary = String(text ?? '').replace(/\s+/g, ' ').trim();
  return summary.length <= 50 ? summary : `${summary.slice(0, 49)}…`;
}

function streamingCard(initialText) {
  return {
    schema: '2.0',
    config: {
      streaming_mode: true,
      summary: { content: t('正在生成…') },
      streaming_config: {
        print_frequency_ms: { default: 70 },
        print_step: { default: 1 },
        print_strategy: 'fast',
      },
    },
    body: {
      elements: [{
        tag: 'markdown',
        element_id: STREAM_ELEMENT_ID,
        content: initialText,
      }],
    },
  };
}

export class VerifiedFeishuChannel {
  #client;
  #initialText;
  #fileUploadTimeoutMs;
  #fileMessageTimeoutMs;

  constructor({
    client,
    initialText,
    fileUploadTimeoutMs = MAX_FILE_OPERATION_TIMEOUT_MS,
    fileMessageTimeoutMs = MAX_FILE_OPERATION_TIMEOUT_MS,
  }) {
    this.#client = client;
    this.#initialText = initialText ?? t(DEFAULT_INITIAL_TEXT);
    this.#fileUploadTimeoutMs = boundedFileTimeout(fileUploadTimeoutMs, 'fileUploadTimeoutMs');
    this.#fileMessageTimeoutMs = boundedFileTimeout(fileMessageTimeoutMs, 'fileMessageTimeoutMs');
  }

  async stream(chatId, input, options = {}) {
    if (typeof input?.markdown !== 'function') {
      throw new Error('Feishu stream requires a markdown producer');
    }

    let messageId = null;
    const cardResponse = assertApiSuccess('Feishu card.create', await this.#client.cardkit.v1.card.create({
      data: {
        type: 'card_json',
        data: JSON.stringify(streamingCard(this.#initialText)),
      },
    }));
    const cardId = cardResponse?.data?.card_id;
    if (!cardId) throw new Error('Feishu card.create returned no card_id');

    try {
      messageId = await this.#sendCard(chatId, cardId, options.replyTo);
      let sequence = 0;
      let lastContent = this.#initialText;
      const controller = {
        messageId,
        setContent: async (content) => {
          const next = String(content ?? '') || '…';
          if (next === lastContent) return;
          if (next.length > MAX_STREAM_CHARS) {
            throw new Error(`Feishu stream content exceeds ${MAX_STREAM_CHARS} characters`);
          }
          const response = await this.#client.cardkit.v1.cardElement.content({
            path: { card_id: cardId, element_id: STREAM_ELEMENT_ID },
            data: {
              content: next,
              sequence: ++sequence,
              uuid: `content_${cardId}_${sequence}`,
            },
          });
          assertApiSuccess('Feishu cardElement.content', response);
          lastContent = next;
        },
      };

      await input.markdown(controller);
      const finishResponse = await this.#client.cardkit.v1.card.settings({
        path: { card_id: cardId },
        data: {
          settings: JSON.stringify({
            config: {
              streaming_mode: false,
              summary: { content: summaryOf(lastContent) || t('回答完成') },
            },
          }),
          sequence: ++sequence,
          uuid: `settings_${cardId}_${sequence}`,
        },
      });
      assertApiSuccess('Feishu card.settings', finishResponse);
      return { messageId };
    } catch (error) {
      if (messageId) await this.#recall(messageId);
      throw error;
    }
  }

  async sendFile(chatId, file, { replyTo, signal } = {}) {
    return this.#sendArtifact(chatId, file, {
      replyTo,
      signal,
      messageType: 'file',
      presentation: 'feishu-file',
    });
  }

  async sendImage(chatId, file, { replyTo, signal } = {}) {
    return this.#sendArtifact(chatId, file, {
      replyTo,
      signal,
      messageType: 'image',
      presentation: 'feishu-image',
    });
  }

  async #sendArtifact(chatId, file, {
    replyTo,
    signal,
    messageType,
    presentation,
  }) {
    signal?.throwIfAborted();
    if (typeof chatId !== 'string' || !chatId) throw new TypeError('chatId is required');
    if (!file || typeof file !== 'object'
      || typeof file.artifactId !== 'string' || !file.artifactId
      || typeof file.deliveryKey !== 'string' || !file.deliveryKey
      || typeof file.fileName !== 'string' || !file.fileName
      || !Buffer.isBuffer(file.bytes)) {
      throw new TypeError('A materialized result file is required');
    }
    let uploaded;
    try {
      uploaded = await waitForFileOperation((operationSignal) => {
        operationSignal.throwIfAborted();
        const pending = messageType === 'image'
          ? this.#client.im.v1.image.create({
              data: {
                image_type: 'message',
                image: file.bytes,
              },
            })
          : this.#client.im.v1.file.create({
              data: {
                file_type: 'stream',
                file_name: file.fileName,
                file: file.bytes,
              },
            });
        trackOutboundArtifactProviderPromise(file, pending);
        return pending;
      }, {
        signal,
        timeoutMs: this.#fileUploadTimeoutMs,
        stage: 'upload',
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw fileDeliveryError('upload', error);
    }
    signal?.throwIfAborted();
    const resourceKey = messageType === 'image'
      ? uploaded?.image_key ?? uploaded?.data?.image_key
      : uploaded?.file_key ?? uploaded?.data?.file_key;
    if (typeof resourceKey !== 'string' || !resourceKey) {
      throw fileDeliveryError('upload', undefined, uploaded?.code);
    }

    const uuid = deliveryUuid(file, chatId, messageType);
    const content = JSON.stringify(messageType === 'image'
      ? { image_key: resourceKey }
      : { file_key: resourceKey });
    const request = replyTo
      ? {
          path: { message_id: replyTo },
          data: { msg_type: messageType, content, uuid },
        }
      : {
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: messageType, content, uuid },
        };
    const send = () => {
      const pending = replyTo
        ? this.#client.im.v1.message.reply(request)
        : this.#client.im.v1.message.create(request);
      trackOutboundArtifactProviderPromise(file, pending);
      return pending;
    };

    let response;
    try {
      response = await waitForFileOperation(async (operationSignal) => {
        operationSignal.throwIfAborted();
        let result;
        try {
          result = await send();
        } catch (error) {
          if (providerErrorCode(error) !== 230049) throw error;
          result = { code: 230049 };
        }
        operationSignal.throwIfAborted();

        // Feishu documents 230049 as an uncertain asynchronous send result.
        // Reuse the same resource key and UUID once so the provider can deduplicate.
        if (Number(result?.code) === 230049) {
          result = await send();
          operationSignal.throwIfAborted();
        }
        return result;
      }, {
        signal,
        timeoutMs: this.#fileMessageTimeoutMs,
        stage: 'message send',
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw fileDeliveryError('message send', error, undefined, { uncertain: true });
    }
    if (Number.isFinite(Number(response?.code)) && Number(response.code) !== 0) {
      throw fileDeliveryError('message send', undefined, response.code, { uncertain: true });
    }
    const messageId = response?.data?.message_id;
    if (typeof messageId !== 'string' || !messageId) {
      throw fileDeliveryError('message send', undefined, undefined, { uncertain: true });
    }
    return createDeliveryReceipt({
      deliveryId: file.deliveryKey,
      presentation,
      providerMessageIds: [messageId],
      artifacts: [{
        artifactId: file.artifactId,
        outcome: 'sent',
      }],
    });
  }

  async #sendCard(chatId, cardId, replyTo) {
    const content = JSON.stringify({ type: 'card', data: { card_id: cardId } });
    const response = replyTo
      ? await this.#client.im.v1.message.reply({
        path: { message_id: replyTo },
        data: { msg_type: 'interactive', content },
      })
      : await this.#client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'interactive', content },
      });
    assertApiSuccess('Feishu message send', response);
    const messageId = response?.data?.message_id;
    if (!messageId) throw new Error('Feishu message send returned no message_id');
    return messageId;
  }

  async #recall(messageId) {
    try {
      const response = await this.#client.im.v1.message.delete({
        path: { message_id: messageId },
      });
      assertApiSuccess('Feishu message delete', response);
    } catch (error) {
      console.warn('[bridge] unable to recall a failed streaming card:', error.message);
    }
  }

  async addReaction(messageId, emojiType) {
    const response = assertApiSuccess('Feishu reaction.create', await this.#client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    }));
    const reactionId = response?.data?.reaction_id;
    if (!reactionId) throw new Error('Feishu reaction.create returned no reaction_id');
    return reactionId;
  }

  async removeReaction(messageId, reactionId) {
    assertApiSuccess('Feishu reaction.delete', await this.#client.im.v1.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    }));
  }
}
