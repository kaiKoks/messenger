import React, { useState, useEffect, useRef } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Chat from './components/Chat';
import LogPanel from './components/LogPanel';
import type { Message, LogEntry } from './types';
import { websocketService } from './services/WebSocketService';
import './App.css';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Флаги для предотвращения дублирования
  const isHandlerRegistered = useRef(false);
  const messageHandlerRef = useRef<((text: string, sender?: string) => void) | null>(null);
  const userListHandlerRef = useRef<((users: string[]) => void) | null>(null);
  const logHandlerRef = useRef<((log: LogEntry) => void) | null>(null);
  const connectionHandlerRef = useRef<((connected: boolean) => void) | null>(null);

  // Регистрируем хендлеры только один раз
  useEffect(() => {
    if (isHandlerRegistered.current) return;
    isHandlerRegistered.current = true;

    // Хендлер сообщений
    const onMessage = (text: string, sender?: string) => {
      console.log('onMessage called:', { text, sender });
      
      if (sender === 'system') {
        setMessages(prev => [...prev, {
          id: Date.now().toString() + Math.random(),
          text,
          sender: 'System',
          recipient: '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: true
        }]);
      } else if (sender) {
        setMessages(prev => [...prev, {
          id: Date.now().toString() + Math.random(),
          text,
          sender: sender,
          recipient: currentUser || '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: false
        }]);
      }
    };
    messageHandlerRef.current = onMessage;
    websocketService.onMessage(onMessage);

    // Хендлер списка пользователей
    const onUserList = (users: string[]) => {
      console.log('onUserList called:', users);
      setOnlineUsers(users);
    };
    userListHandlerRef.current = onUserList;
    websocketService.onUserList(onUserList);

    // Хендлер логов
    const onLog = (log: LogEntry) => {
      setLogs(prev => [...prev, log]);
    };
    logHandlerRef.current = onLog;
    websocketService.onLog(onLog);

    // Хендлер соединения
    const onConnectionChange = (connected: boolean) => {
      setIsConnected(connected);
      if (!connected && currentUser) {
        setError('Connection lost. Attempting to reconnect...');
      }
    };
    connectionHandlerRef.current = onConnectionChange;
    websocketService.onConnectionChange(onConnectionChange);

    // Cleanup при размонтировании
    return () => {
      // Не отписываемся, чтобы сохранить хендлеры
    };
  }, []); // Пустой массив зависимостей - регистрируем один раз

  const handleConnect = (username: string) => {
    setError(null);
    setMessages([]);
    
    websocketService.connect(username)
      .then(() => {
        setCurrentUser(username);
        setIsConnected(true);
      })
      .catch((err) => {
        setError(`Failed to connect: ${err.message}`);
      });
  };

  const handleSendMessage = (recipient: string, text: string) => {
    if (websocketService.sendMessage(recipient, text)) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + Math.random(),
        text,
        sender: currentUser || 'me',
        recipient,
        timestamp: new Date(),
        isOwn: true,
        isSystem: false
      }]);
    }
  };

  const handleGetUsers = () => {
    websocketService.getUsers();
  };

  const handleGetHistory = () => {
    websocketService.getHistory();
  };

  const handleDisconnect = () => {
    websocketService.disconnect();
    setCurrentUser(null);
    setIsConnected(false);
    setSelectedUser(null);
    setMessages([]);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  if (!currentUser) {
    return <Login onConnect={handleConnect} error={error} />;
  }

  return (
    <div className="app">
      <div className="app-main">
        <Sidebar
          currentUser={currentUser}
          onlineUsers={onlineUsers}
          selectedUser={selectedUser}
          onSelectUser={setSelectedUser}
          onGetUsers={handleGetUsers}
          onGetHistory={handleGetHistory}
          onDisconnect={handleDisconnect}
          isConnected={isConnected}
        />
        
        <Chat
          messages={messages}
          selectedUser={selectedUser}
          currentUser={currentUser}
          onSendMessage={handleSendMessage}
          isConnected={isConnected}
        />
      </div>
      
      <LogPanel logs={logs} onClear={handleClearLogs} />
    </div>
  );
};

export default App;