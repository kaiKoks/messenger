import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Chat from './components/Chat';
import LogPanel from './components/LogPanel';
import MessageList from './components/MessageList';
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

  useEffect(() => {
    // Настройка WebSocket хендлеров
    websocketService.onMessage((text, sender) => {
      if (sender === 'system') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text,
          sender: 'System',
          recipient: '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: true
        }]);
      } else if (sender) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text,
          sender: sender,
          recipient: currentUser || '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: false
        }]);
      }
    });

    websocketService.onUserList((users) => {
      setOnlineUsers(users);
    });

    websocketService.onLog((log) => {
      setLogs(prev => [...prev, log]);
    });

    websocketService.onConnectionChange((connected) => {
      setIsConnected(connected);
      if (!connected && currentUser) {
        setError('Connection lost. Attempting to reconnect...');
      }
    });

  }, [currentUser]);

  const handleConnect = (username: string) => {
    setError(null);
    setMessages([]);
    setLogs([]);
    
    websocketService.connect(username)
      .then(() => {
        setCurrentUser(username);
        setIsConnected(true);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `Connected to server as ${username}`,
          sender: 'System',
          recipient: '',
          timestamp: new Date(),
          isOwn: false,
          isSystem: true
        }]);
      })
      .catch((err) => {
        setError(`Failed to connect: ${err.message}`);
      });
  };

  const handleSendMessage = (recipient: string, text: string) => {
    if (websocketService.sendMessage(recipient, text)) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
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