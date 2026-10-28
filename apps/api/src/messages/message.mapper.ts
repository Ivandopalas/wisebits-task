import type { MessageDto } from '@chat/shared';
import type { Message } from './message.schema.js';

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message._id.toString(),
    conversationId: message.conversationId.toString(),
    seq: message.seq,
    senderId: message.senderId.toString(),
    text: message.text,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
  };
}
