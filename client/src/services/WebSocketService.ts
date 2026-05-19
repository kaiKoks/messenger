// src/services/WebSocketService.ts

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'error' | 'warning' | 'success' | 'debug';
  message: string;
  source?: 'server' | 'client';
}

export interface DialogInfo {
  username: string;
  lastMessage: string;
}

export interface ServerMessage {
  id: string;
  sender: string;
  recipient: string;
  text: string;
  timestamp: number;
}

type MessageHandler = (messageObj: ServerMessage) => void;
type UsersHandler = (users: string[]) => void;
type OnlineUsersHandler = (users: string[]) => void;
type DialogsHandler = (dialogs: DialogInfo[]) => void;
type DialogHistoryHandler = (username: string, messages: ServerMessage[]) => void;
type LogHandler = (log: LogEntry) => void;
type ConnectionHandler = (connected: boolean) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isConnecting = false;
  
  private pendingLoginResolver: ((value: string) => void) | null = null;
  private pendingLoginRejecter: ((reason: Error) => void) | null = null;
  private pendingRegisterResolver: ((value: string) => void) | null = null;
  private pendingRegisterRejecter: ((reason: Error) => void) | null = null;
  
  private messageHandlers: MessageHandler[] = [];
  private allUsersHandlers: UsersHandler[] = [];
  private onlineUsersHandlers: OnlineUsersHandler[] = [];
  private dialogsHandlers: DialogsHandler[] = [];
  private dialogHistoryHandlers: DialogHistoryHandler[] = [];
  private logHandlers: LogHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];

  connect(url: string = 'ws://localhost:8080'): Promise<void> {
    if (this.ws || this.isConnecting) return Promise.resolve();

    this.isConnecting = true;
    this.addLog('info', `Connecting to ${url}...`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.isConnecting = false;
          this.addLog('success', 'Connected to server');
          this.connectionHandlers.forEach(h => h(true));
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };

        this.ws.onclose = () => {
          const wasConnected = this.isConnected;
          this.isConnected = false;
          this.isConnecting = false;
          this.ws = null;
          this.addLog('warning', 'Disconnected from server');
          this.connectionHandlers.forEach(h => h(false));
          
          if (this.pendingLoginRejecter) this.pendingLoginRejecter(new Error('Connection closed'));
          if (this.pendingRegisterRejecter) this.pendingRegisterRejecter(new Error('Connection closed'));
          
          if (!wasConnected) reject(new Error('Failed to connect'));
        };

        this.ws.onerror = (error) => {
          this.addLog('error', 'WebSocket error occurred');
          if (this.ws) this.ws.close();
        };

      } catch (e) {
        this.isConnecting = false;
        reject(e);
      }
    });
  }

  private handleIncomingMessage(rawData: string) {
    let cleanData = rawData.trim();
    if (!cleanData) return;

    this.addLog('debug', `Received raw data: ${cleanData.substring(0, 100)}`);

    try {
      const json = JSON.parse(cleanData);
      
      // Логируем в консоль приложения красивое серверное событие
      if (json.type) {
        this.addLog('info', `[Server UI] Action: ${json.type} | Status: ${json.status || 'broadcast'}`);
      }

      switch (json.type) {
        case 'login':
          if (json.status === 'success') {
            if (this.pendingLoginResolver) {
              this.pendingLoginResolver(json.payload);
              this.pendingLoginResolver = null;
              this.pendingLoginRejecter = null;
            }
          } else {
            if (this.pendingLoginRejecter) {
              this.pendingLoginRejecter(new Error(json.payload || 'Invalid credentials'));
              this.pendingLoginResolver = null;
              this.pendingLoginRejecter = null;
            }
          }
          break;

        case 'register':
          if (json.status === 'success') {
            if (this.pendingRegisterResolver) {
              this.pendingRegisterResolver(json.payload);
              this.pendingRegisterResolver = null;
              this.pendingRegisterRejecter = null;
            }
          } else {
            if (this.pendingRegisterRejecter) {
              this.pendingRegisterRejecter(new Error(json.payload || 'Registration failed'));
              this.pendingRegisterResolver = null;
              this.pendingRegisterRejecter = null;
            }
          }
          break;

        case 'message':
          // Получено обычное сообщение от кого-то в реальном времени
          this.messageHandlers.forEach(h => h(json));
          break;

        case 'all_users':
          if (json.status === 'success' && Array.isArray(json.payload)) {
            this.allUsersHandlers.forEach(h => h(json.payload));
          }
          break;

        case 'online_users':
          if (json.status === 'success' && Array.isArray(json.payload)) {
            this.onlineUsersHandlers.forEach(h => h(json.payload));
          }
          break;

        case 'dialog_history':
          if (json.recipient && Array.isArray(json.messages)) {
            this.dialogHistoryHandlers.forEach(h => h(json.recipient, json.messages));
          }
          break;

        case 'dialogs_list':
          if (json.status === 'success' && Array.isArray(json.payload)) {
            this.dialogsHandlers.forEach(h => h(json.payload));
          }
          break;
          
        case 'msg_status':
          // Системный статус доставки, можно вывести в логи клиента
          this.addLog('info', `Message status to ${json.payload}: ${json.status}`);
          break;

        default:
          break;
      }

    } catch (err) {
      this.addLog('error', `Failed to parse JSON message: ${cleanData}`);
    }
  }

  login(username: string, password: string): Promise<string> {
    if (!this.isConnected) return Promise.reject(new Error('Not connected to server'));
    
    return new Promise((resolve, reject) => {
      this.pendingLoginResolver = resolve;
      this.pendingLoginRejecter = reject;
      this.send(`/login ${username} ${password}`);
    });
  }

  register(username: string, password: string): Promise<string> {
    if (!this.isConnected) return Promise.reject(new Error('Not connected to server'));

    return new Promise((resolve, reject) => {
      this.pendingRegisterResolver = resolve;
      this.pendingRegisterRejecter = reject;
      this.send(`/register ${username} ${password}`);
    });
  }

  sendMessage(recipient: string, text: string) {
    if (this.isConnected) this.send(`/msg ${recipient} ${text}`);
  }

  getAllUsers() {
    if (this.isConnected) this.send('/users');
  }

  getOnlineUsers() {
    if (this.isConnected) this.send('/online');
  }

  getRecentDialogs() {
    if (this.isConnected) this.send('/dialogs');
  }

  getDialog(username: string) {
    if (this.isConnected) this.send(`/dialog ${username}`);
  }

  disconnect() {
    if (this.ws && this.isConnected) {
      this.send('/quit');
      this.ws.close();
    }
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
  }

  private send(command: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(command);
      this.addLog('debug', `Sent: ${command}`);
    } else {
      this.addLog('error', 'Cannot send: WebSocket not open');
    }
  }

  private addLog(level: LogEntry['level'], message: string) {
    const log: LogEntry = {
      id: Date.now().toString() + Math.random(),
      timestamp: new Date(),
      level,
      message,
      source: 'client'
    };
    this.logHandlers.forEach(h => h(log));
  }

  onMessage(handler: MessageHandler) { this.messageHandlers.push(handler); }
  onAllUsers(handler: UsersHandler) { this.allUsersHandlers.push(handler); }
  onOnlineUsers(handler: OnlineUsersHandler) { this.onlineUsersHandlers.push(handler); }
  onDialogs(handler: DialogsHandler) { this.dialogsHandlers.push(handler); }
  onDialogHistory(handler: DialogHistoryHandler) { this.dialogHistoryHandlers.push(handler); }
  onLog(handler: LogHandler) { this.logHandlers.push(handler); }
  onConnectionChange(handler: ConnectionHandler) { this.connectionHandlers.push(handler); }
}

export const websocketService = new WebSocketService();