import type { Message, LogEntry } from '../types';

type MessageHandler = (message: string, sender?: string) => void;
type UserListHandler = (users: string[]) => void;
type HistoryHandler = (history: string[]) => void;
type LogHandler = (log: LogEntry) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private username: string | null = null;
  
  private messageHandlers: MessageHandler[] = [];
  private userListHandlers: UserListHandler[] = [];
  private historyHandlers: HistoryHandler[] = [];
  private logHandlers: LogHandler[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];

  connect(username: string): Promise<void> {
    this.username = username;
    this.addLog('info', `Connecting to ws://localhost:8080...`, 'client');
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:8080');
      
      this.ws.onopen = () => {
        this.addLog('success', 'Connected to server', 'client');
        this.reconnectAttempts = 0;
        this.send(`/reg ${username}`);
        this.connectionHandlers.forEach(h => h(true));
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
      
      this.ws.onerror = (error) => {
        this.addLog('error', 'WebSocket error', 'client');
        this.connectionHandlers.forEach(h => h(false));
        reject(error);
      };
      
      this.ws.onclose = () => {
        this.addLog('warning', 'Disconnected from server', 'client');
        this.connectionHandlers.forEach(h => h(false));
        this.handleReconnect();
      };
    });
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.username) {
      this.reconnectAttempts++;
      this.addLog('info', `Reconnecting in ${this.reconnectDelay * this.reconnectAttempts}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'client');
      setTimeout(() => {
        this.connect(this.username!);
      }, this.reconnectDelay * this.reconnectAttempts);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.addLog('error', 'Max reconnection attempts reached. Please refresh the page.', 'client');
    }
  }

  private handleMessage(data: string) {
    this.addLog('info', `Received: ${data.substring(0, 100)}`, 'server');
    
    // Системное сообщение о выключении сервера
    if (data.includes('SERVER_SHUTDOWN')) {
      this.addLog('error', 'Server is shutting down!', 'server');
      this.messageHandlers.forEach(h => h('⚠️ Server is shutting down!', 'system'));
      return;
    }
    
    // Welcome сообщение
    if (data.includes('Welcome') && data.includes('!')) {
      this.messageHandlers.forEach(h => h(data, 'system'));
      return;
    }
    
    // Список пользователей
    if (data.includes('Online users:') || data.includes('📋 Online users:')) {
      const lines = data.split('\n');
      const users: string[] = [];
      for (const line of lines) {
        if (line.includes('•') || line.includes('-')) {
          let user = line.replace('•', '').replace('-', '').trim();
          if (user && !user.includes('(')) {
            users.push(user);
          }
        }
      }
      this.addLog('info', `Online users: ${users.join(', ') || 'none'}`, 'server');
      this.userListHandlers.forEach(h => h(users));
      return;
    }
    
    // История сообщений
    if (data.includes('History:') || data.includes('📜')) {
      const lines = data.split('\n').filter(l => l.includes(':') && !l.includes('History'));
      this.historyHandlers.forEach(h => h(lines));
      return;
    }
    
    // Личное сообщение (содержит эмодзи 💬 или просто имя: текст)
    if (data.includes('💬') || (data.includes(':') && !data.includes('ERROR') && !data.includes('✅'))) {
      let cleanData = data.replace('💬', '').trim();
      const colonIndex = cleanData.indexOf(':');
      if (colonIndex > 0) {
        const sender = cleanData.substring(0, colonIndex).trim();
        const text = cleanData.substring(colonIndex + 1).trim();
        this.addLog('info', `Message from ${sender}: ${text}`, 'server');
        this.messageHandlers.forEach(h => h(text, sender));
      } else {
        this.messageHandlers.forEach(h => h(cleanData, 'unknown'));
      }
      return;
    }
    
    // Ошибки
    if (data.includes('ERROR') || data.includes('❌')) {
      this.addLog('error', data, 'server');
      this.messageHandlers.forEach(h => h(`❌ ${data}`, 'system'));
      return;
    }
    
    // Успешные действия
    if (data.includes('✅') || data.includes('✓')) {
      this.addLog('success', data, 'server');
      this.messageHandlers.forEach(h => h(data, 'system'));
      return;
    }
    
    // Обычное сообщение
    this.messageHandlers.forEach(h => h(data, 'system'));
  }

  sendMessage(recipient: string, text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.addLog('error', 'Not connected to server', 'client');
      return false;
    }
    const message = `/msg ${recipient} ${text}`;
    this.ws.send(message);
    this.addLog('info', `Sent to ${recipient}: ${text}`, 'client');
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
      this.addLog('info', `Sent: ${command}`, 'client');
    } else {
      this.addLog('error', 'Not connected to server', 'client');
    }
  }

  disconnect() {
    if (this.ws) {
      this.send('/quit');
      this.ws.close();
      this.ws = null;
    }
  }

  private addLog(level: LogEntry['level'], message: string, source: LogEntry['source'] = 'client') {
    const log: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date(),
      level,
      message,
      source
    };
    this.logHandlers.forEach(h => h(log));
  }

  // Хендлеры
  onMessage(handler: MessageHandler) { this.messageHandlers.push(handler); }
  onUserList(handler: UserListHandler) { this.userListHandlers.push(handler); }
  onHistory(handler: HistoryHandler) { this.historyHandlers.push(handler); }
  onLog(handler: LogHandler) { this.logHandlers.push(handler); }
  onConnectionChange(handler: (connected: boolean) => void) { this.connectionHandlers.push(handler); }
}

export const websocketService = new WebSocketService();