// Типы сообщений
export interface Message {
  id: string;
  text: string;
  sender: string;
  recipient: string;
  timestamp: Date;
  isOwn: boolean;
  isSystem?: boolean;
  isEncrypted?: boolean;
}

// Тип пользователя
export interface User {
  username: string;
  isOnline: boolean;
  lastSeen?: Date;
}

// Типы WebSocket команд
export type WebSocketCommand = 
  | { type: 'REGISTER'; username: string }
  | { type: 'SEND_MESSAGE'; recipient: string; text: string }
  | { type: 'GET_USERS' }
  | { type: 'GET_HISTORY' };

// Типы WebSocket ответов
export interface UserListResponse {
  users: string[];
}

export interface HistoryResponse {
  messages: string[];
}

export interface MessageResponse {
  from: string;
  text: string;
  timestamp: number;
}