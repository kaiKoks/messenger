import type { LogEntry } from '../types';

type MessageHandler = (text: string, sender?: string) => void;
type UserListHandler = (users: string[]) => void;
type HistoryHandler = (history: string[]) => void;
type LogHandler = (log: LogEntry) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private username: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  
  private messageHandlers: MessageHandler[] = [];
  private userListHandlers: UserListHandler[] = [];
  private historyHandlers: HistoryHandler[] = [];
  private logHandlers: LogHandler[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];

  connect(username: string): Promise<void> {
    this.username = username;
    this.addLog('info', `Connecting to ws://localhost:8080...`);
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:8080');
      
      this.ws.onopen = () => {
        this.addLog('success', 'Connected to server');
        this.reconnectAttempts = 0;
        this.send(`/reg ${username}`);
        this.connectionHandlers.forEach(h => h(true));
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
      
      this.ws.onerror = () => {
        this.addLog('error', 'WebSocket error');
        this.connectionHandlers.forEach(h => h(false));
        reject(new Error('Connection failed'));
      };
      
      this.ws.onclose = () => {
        this.addLog('warning', 'Disconnected from server');
        this.connectionHandlers.forEach(h => h(false));
        this.handleReconnect();
      };
    });
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.username) {
      this.reconnectAttempts++;
      this.addLog('info', `Reconnecting in 2s... (attempt ${this.reconnectAttempts})`);
      setTimeout(() => {
        this.connect(this.username!);
      }, 2000);
    }
  }

  private handleMessage(data: string) {
    this.addLog('debug', `Received: ${data.substring(0, 100)}`);
    
    // Сообщение от пользователя (формат MSG:sender:text)
    if (data.startsWith('MSG:')) {
      const parts = data.substring(4).split(':');
      const sender = parts[0];
      const text = parts.slice(1).join(':');
      this.addLog('info', `Message from ${sender}: ${text}`);
      this.messageHandlers.forEach(h => h(text, sender));
      return;
    }
    
    // Список пользователей (формат USERS:user1,user2,user3)
    if (data.startsWith('USERS:')) {
      const usersStr = data.substring(6).trim();
      const users = usersStr ? usersStr.split(',') : [];
      this.addLog('info', `Users online: ${users.join(', ') || 'none'}`);
      this.userListHandlers.forEach(h => h(users));
      return;
    }
    
    // История сообщений
    if (data.startsWith('HISTORY:')) {
      const history = data.substring(8).split('\n').filter(l => l.trim());
      this.addLog('info', `History received: ${history.length} messages`);
      this.historyHandlers.forEach(h => h(history));
      return;
    }
    
    if (data.startsWith('HISTORY_START')) {
      // Игнорируем, история будет в следующем сообщении
      return;
    }
    
    if (data === 'HISTORY_END') {
      return;
    }
    
    // Простое текстовое сообщение (уведомления)
    if (data.startsWith('Welcome') || 
        data.startsWith('Sent to') ||
        data.startsWith('ERROR:') ||
        data.startsWith('Unknown command')) {
      this.messageHandlers.forEach(h => h(data, 'system'));
      return;
    }
    
    // Игнорируем пустые сообщения
    if (data.trim()) {
      this.messageHandlers.forEach(h => h(data, 'system'));
    }
  }

  sendMessage(recipient: string, text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.addLog('error', 'Not connected to server');
      return false;
    }
    this.send(`/msg ${recipient} ${text}`);
    this.addLog('info', `Sent to ${recipient}: ${text}`);
    return true;
  }

  getUsers() {
    this.send('/users');
  }

  getHistory() {
    this.send('/history');
  }

  private send(command: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(command);
      this.addLog('debug', `Sent: ${command}`);
    }
  }

  disconnect() {
    if (this.ws) {
      this.send('/quit');
      this.ws.close();
      this.ws = null;
    }
  }

  private addLog(level: LogEntry['level'], message: string) {
    const log: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date(),
      level,
      message,
      source: 'client'
    };
    this.logHandlers.forEach(h => h(log));
  }

  onMessage(handler: MessageHandler) { this.messageHandlers.push(handler); }
  onUserList(handler: UserListHandler) { this.userListHandlers.push(handler); }
  onHistory(handler: HistoryHandler) { this.historyHandlers.push(handler); }
  onLog(handler: LogHandler) { this.logHandlers.push(handler); }
  onConnectionChange(handler: (connected: boolean) => void) { this.connectionHandlers.push(handler); }
}

export const websocketService = new WebSocketService();