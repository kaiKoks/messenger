import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message } from '../types.ts';
import { websocketService } from '../services/WebSocketService';

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const addMessage = useCallback((text: string, isOwn: boolean, sender?: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      text: text,
      sender: sender || (isOwn ? currentUser || 'me' : 'system'),
      recipient: currentUser || '',
      timestamp: new Date(),
      isOwn: isOwn,
      isSystem: sender === 'system'
    };
    setMessages(prev => [...prev, newMessage]);
  }, [currentUser]);

  const connect = useCallback(async (username: string) => {
    try {
      setError(null);
      await websocketService.connect(username);
      setCurrentUser(username);
      setIsConnected(true);
      
      // Добавляем системное сообщение
      addMessage(`Connected as ${username}`, false, 'system');
    } catch (err) {
      setError('Failed to connect to server');
      console.error(err);
    }
  }, [addMessage]);

  const sendMessage = useCallback((recipient: string, text: string) => {
    if (!text.trim() || !recipient) return;
    
    websocketService.sendMessage(recipient, text);
    addMessage(`To ${recipient}: ${text}`, true, currentUser || undefined);
  }, [addMessage, currentUser]);

  const getUsers = useCallback(() => {
    websocketService.getUsers();
  }, []);

  const getHistory = useCallback(() => {
    websocketService.getHistory();
  }, []);

  const disconnect = useCallback(() => {
    websocketService.disconnect();
    setIsConnected(false);
  }, []);

  // Настройка обработчиков WebSocket
  useEffect(() => {
    websocketService.onMessage((text) => {
      // Парсим сообщение "username: text"
      const colonIndex = text.indexOf(':');
      if (colonIndex > 0) {
        const sender = text.substring(0, colonIndex);
        const messageText = text.substring(colonIndex + 1);
        addMessage(messageText, false, sender);
      } else {
        addMessage(text, false, 'system');
      }
    });

    websocketService.onUserList((users) => {
      setOnlineUsers(users);
    });

    websocketService.onSystemMessage((msg) => {
      addMessage(msg, false, 'system');
    });

    websocketService.onError((err) => {
      setError(err);
      addMessage(`Error: ${err}`, false, 'system');
    });

    return () => {
      disconnect();
    };
  }, [addMessage, disconnect]);

  // Автоматический скролл вниз при новых сообщениях
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return {
    messages,
    onlineUsers,
    isConnected,
    error,
    currentUser,
    connect,
    sendMessage,
    getUsers,
    getHistory,
    disconnect,
    messagesEndRef
  };
};