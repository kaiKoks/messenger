import React, { useRef, useEffect } from 'react';

import type { Message } from '../types/index';

interface MessageListProps {
  messages: Message[];
}

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const getMessageClass = (msg: Message) => {
    if (msg.isSystem) return 'message-system';
    if (msg.isOwn) return 'message-own';
    return 'message-other';
  };
  
  const getAvatar = (msg: Message) => {
    if (msg.isSystem) return '⚙️';
    if (msg.isOwn) return '👤';
    return '💬';
  };
  
  return (
    <div className="messages-area">
      {messages.length === 0 && (
        <div className="welcome-placeholder" style={{ padding: 0 }}>
          <div className="placeholder-brand" style={{ fontSize: '40px' }}>✉️</div>
          <h2>Сообщений нет</h2>
          <p>Отправьте первое сообщение, чтобы начать диалог.</p>
        </div>
      )}
      
      {messages.map((msg, idx) => (
        <div key={msg.id || idx} className={`message ${getMessageClass(msg)}`}>
          {!msg.isSystem && <div className="message-avatar">{getAvatar(msg)}</div>}
          <div className="message-bubble">
            {!msg.isOwn && !msg.isSystem && (
              <div className="message-sender">{msg.sender}</div>
            )}
            <div className="message-text">{msg.text}</div>
            {!msg.isSystem && (
              <span className="message-time">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;