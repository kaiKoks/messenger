export interface Message {
  id: string;
  text: string;
  sender: string;
  recipient: string;
  timestamp: Date;
  isOwn: boolean;
  isSystem?: boolean;
}

export interface Dialog {
  username: string;
  lastMessage: string;
  timestamp: Date;
  messages: Message[];
  unread: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'error' | 'warning' | 'success' | 'debug';
  message: string;
  source?: 'server' | 'client';
}