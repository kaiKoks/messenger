import React, { useRef, useEffect } from 'react';
import type { Message } from '../types';

interface MessageListProps {
  messages: Message[];
  currentUser: string;
}

const MessageList: React.FC<MessageListProps> = ({ messages, currentUser }) => {
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
    if (msg.isSystem) return '🖥️';
    if (msg.isOwn) return '👤';
    return '👥';
  };
  
  return (
    <div className="messages-area">
      {messages.length === 0 && (
        <div className="messages-empty">
          <div className="empty-icon">💭</div>
          <p>No messages yet</p>
          <small>Send a message to start the conversation</small>
        </div>
      )}
      {messages.map((msg, idx) => (
        <div key={msg.id || idx} className={`message ${getMessageClass(msg)}`}>
          <div className="message-avatar">{getAvatar(msg)}</div>
          <div className="message-bubble">
            {!msg.isOwn && !msg.isSystem && (
              <div className="message-sender">{msg.sender}</div>
            )}
            <div className="message-text">{msg.text}</div>
            <div className="message-time">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;