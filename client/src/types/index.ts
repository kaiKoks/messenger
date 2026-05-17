export interface Message {
  id: string;
  text: string;
  sender: string;
  recipient: string;
  timestamp: Date;
  isOwn: boolean;
  isSystem?: boolean;
  type?: 'normal' | 'system' | 'error';
}

export interface User {
  username: string;
  isOnline: boolean;
}

export interface ChatState {
  messages: Message[];
  onlineUsers: string[];
  currentUser: string | null;
  isConnected: boolean;
  error: string | null;
  selectedUser: string | null;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'error' | 'warning' | 'success';
  message: string;
  source?: 'server' | 'client';
}