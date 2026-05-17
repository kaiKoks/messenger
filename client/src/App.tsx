import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  
  const isHandlerRegistered = useRef(false);
  const autoRefreshInterval = useRef<NodeJS.Timeout | null>(null);
  
  // Хранилище сообщений по пользователям
  const [userMessages, setUserMessages] = useState<Map<string, Message[]>>(new Map());
  
  // Автоматическое обновление списка пользователей
  const startAutoRefresh = useCallback(() => {
    if (autoRefreshInterval.current) {
      clearInterval(autoRefreshInterval.current);
    }
    autoRefreshInterval.current = setInterval(() => {
      if (isConnected && currentUser) {
        websocketService.getUsers();
      }
    }, 10000);
  }, [isConnected, currentUser]);
  
  const stopAutoRefresh = useCallback(() => {
    if (autoRefreshInterval.current) {
      clearInterval(autoRefreshInterval.current);
      autoRefreshInterval.current = null;
    }
  }, []);

  // Добавление сообщения в хранилище для конкретного пользователя
  const addMessageToUser = useCallback((username: string, message: Message) => {
    setUserMessages(prev => {
      const newMap = new Map(prev);
      const userMsgList = newMap.get(username) || [];
      newMap.set(username, [...userMsgList, message]);
      return newMap;
    });
  }, []);

  // Получение сообщений для выбранного пользователя
  const getMessagesForUser = useCallback((username: string | null): Message[] => {
    if (!username) return [];
    return userMessages.get(username) || [];
  }, [userMessages]);

  // Регистрируем хендлеры только один раз
  useEffect(() => {
    if (isHandlerRegistered.current) return;
    isHandlerRegistered.current = true;

    // Хендлер входящих сообщений
    const onMessage = (text: string, sender?: string) => {
      if (sender === 'system') {
        // Системные сообщения показываем в текущем чате
        const systemMsg: Message = {
          id: Date.now().toString() + Math.random(),
          text,
          sender: 'System',
          recipient: '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: true
        };
        
        // Если есть выбранный пользователь, добавляем в его чат
        if (selectedUser) {
          addMessageToUser(selectedUser, systemMsg);
        } else {
          // Иначе добавляем в общие сообщения (показываем только если нет выбранного чата)
          setMessages(prev => [...prev, systemMsg]);
        }
      } else if (sender && sender !== currentUser) {
        // Сообщение от другого пользователя
        const newMsg: Message = {
          id: Date.now().toString() + Math.random(),
          text,
          sender: sender,
          recipient: currentUser || '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: false
        };
        
        // Сохраняем в хранилище для этого отправителя
        addMessageToUser(sender, newMsg);
        
        // Если этот отправитель выбран в данный момент, показываем сразу
        if (selectedUser === sender) {
          setMessages(prev => [...prev, newMsg]);
        }
      }
    };
    websocketService.onMessage(onMessage);

    // Хендлер списка пользователей
    const onUserList = (users: string[]) => {
      setOnlineUsers(users);
    };
    websocketService.onUserList(onUserList);

    // Хендлер истории
    const onHistory = (historyLines: string[]) => {
      const historyMessages: Message[] = historyLines.map((line, idx) => {
        const colonIndex = line.indexOf(':');
        const sender = colonIndex > 0 ? line.substring(0, colonIndex) : 'Unknown';
        const text = colonIndex > 0 ? line.substring(colonIndex + 2) : line;
        return {
          id: `history-${Date.now()}-${idx}`,
          text: text,
          sender: sender,
          recipient: currentUser || '',
          timestamp: new Date(),
          isOwn: sender === currentUser,
          isSystem: false
        };
      });
      
      // Сохраняем историю в хранилище
      historyMessages.forEach(msg => {
        const otherUser = msg.isOwn ? msg.recipient : msg.sender;
        if (otherUser && otherUser !== currentUser) {
          addMessageToUser(otherUser, msg);
        }
      });
      
      // Если есть выбранный пользователь, показываем его историю
      if (selectedUser) {
        const userHistory = historyMessages.filter(
          msg => msg.sender === selectedUser || msg.recipient === selectedUser
        );
        setMessages(userHistory);
      }
    };
    websocketService.onHistory(onHistory);

    // Хендлер логов
    const onLog = (log: LogEntry) => {
      setLogs(prev => [...prev, log]);
    };
    websocketService.onLog(onLog);

    // Хендлер соединения
    const onConnectionChange = (connected: boolean) => {
      setIsConnected(connected);
      if (connected) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    };
    websocketService.onConnectionChange(onConnectionChange);

    return () => {
      stopAutoRefresh();
    };
  }, [currentUser, selectedUser, startAutoRefresh, stopAutoRefresh, addMessageToUser]);

  // При смене выбранного пользователя загружаем его сообщения
  useEffect(() => {
    if (selectedUser) {
      const userMsgList = getMessagesForUser(selectedUser);
      setMessages(userMsgList);
    } else {
      setMessages([]);
    }
  }, [selectedUser, getMessagesForUser]);

  const handleConnect = async (username: string) => {
    setError(null);
    setMessages([]);
    setOnlineUsers([]);
    setUserMessages(new Map());
    
    try {
      await websocketService.connect(username);
      setCurrentUser(username);
      setIsConnected(true);
      startAutoRefresh();
      
      setTimeout(() => {
        websocketService.getUsers();
        websocketService.getHistory();
      }, 500);
    } catch (err) {
      setError(`Failed to connect: ${err}`);
    }
  };

  const handleSendMessage = (recipient: string, text: string) => {
    if (websocketService.sendMessage(recipient, text)) {
      const newMsg: Message = {
        id: Date.now().toString() + Math.random(),
        text,
        sender: currentUser || 'me',
        recipient,
        timestamp: new Date(),
        isOwn: true,
        isSystem: false
      };
      
      // Сохраняем в хранилище
      addMessageToUser(recipient, newMsg);
      
      // Если это текущий выбранный пользователь, показываем
      if (selectedUser === recipient) {
        setMessages(prev => [...prev, newMsg]);
      }
    }
  };

  const handleGetUsers = () => {
    websocketService.getUsers();
  };

  const handleGetHistory = () => {
    websocketService.getHistory();
  };

  const handleDisconnect = () => {
    stopAutoRefresh();
    websocketService.disconnect();
    setCurrentUser(null);
    setIsConnected(false);
    setSelectedUser(null);
    setMessages([]);
    setOnlineUsers([]);
    setUserMessages(new Map());
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  // При выборе пользователя
  const handleSelectUser = (user: string) => {
    setSelectedUser(user);
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
          onSelectUser={handleSelectUser}
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