import type { Message } from '../types.ts';

type MessageHandler = (message: string) => void;
type UserListHandler = (users: string[]) => void;
type ErrorHandler = (error: string) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private userListHandlers: UserListHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private systemMessageHandlers: MessageHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  connect(username: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:8080');
      
      this.ws.onopen = () => {
        console.log('Connected to server');
        this.reconnectAttempts = 0;
        // Отправляем регистрацию после подключения
        this.send(`/reg ${username}`);
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.errorHandlers.forEach(handler => handler('Connection error'));
        reject(error);
      };
      
      this.ws.onclose = () => {
        console.log('Disconnected from server');
        this.handleReconnect();
      };
    });
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
        this.connect(''); // Нужно сохранить username
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private handleMessage(data: string) {
    // Системные сообщения
    if (data.startsWith('SERVER_SHUTDOWN')) {
      this.systemMessageHandlers.forEach(h => h('⚠️ Server is shutting down!'));
      return;
    }
    
    // Список пользователей
    if (data.includes('Online users:') || data.includes('Online users')) {
      const users = data.split('\n')
        .filter(line => line.includes('- '))
        .map(line => line.replace('- ', '').trim());
      this.userListHandlers.forEach(handler => handler(users));
      return;
    }
    
    // Сообщение от пользователя (содержит двоеточие)
    if (data.includes(':')) {
      this.messageHandlers.forEach(handler => handler(data));
      return;
    }
    
    // Всё остальное считаем системным сообщением
    this.systemMessageHandlers.forEach(h => h(data));
  }

  sendMessage(recipient: string, text: string) {
    this.send(`/msg ${recipient} ${text}`);
  }

  getUsers() {
    this.send('/users');
  }

  getHistory() {
    this.send('/history');
  }

  private send(message: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.errorHandlers.forEach(h => h('Not connected to server'));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Хендлеры событий
  onMessage(handler: MessageHandler) {
    this.messageHandlers.push(handler);
  }

  onUserList(handler: UserListHandler) {
    this.userListHandlers.push(handler);
  }

  onError(handler: ErrorHandler) {
    this.errorHandlers.push(handler);
  }

  onSystemMessage(handler: MessageHandler) {
    this.systemMessageHandlers.push(handler);
  }
}

export const websocketService = new WebSocketService();