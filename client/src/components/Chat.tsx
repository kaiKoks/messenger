import React, { useState, useRef, useEffect } from 'react';
import type { Message } from '../types';
import MessageList from './MessageList';

interface ChatProps {
  messages: Message[];
  selectedUser: string | null;
  currentUser: string | null;
  onSendMessage: (recipient: string, text: string) => void;
  isConnected: boolean;
}

const Chat: React.FC<ChatProps> = ({
  messages,
  selectedUser,
  currentUser,
  onSendMessage,
  isConnected
}) => {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (selectedUser && isConnected) {
      inputRef.current?.focus();
    }
  }, [selectedUser, isConnected]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUser && inputText.trim() && isConnected) {
      onSendMessage(selectedUser, inputText.trim());
      setInputText('');
    }
  };
  
  if (!selectedUser) {
    return (
      <div className="chat-placeholder">
        <div className="placeholder-icon">💬</div>
        <h3>Select a user to start chatting</h3>
        <p>Click on any user from the sidebar to begin</p>
      </div>
    );
  }
  
  if (!isConnected) {
    return (
      <div className="chat-placeholder">
        <div className="placeholder-icon">⚠️</div>
        <h3>Disconnected from server</h3>
        <p>Please refresh the page and reconnect</p>
      </div>
    );
  }
  
  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-with">
          <span className="chat-avatar">💬</span>
          <div className="chat-info">
            <div className="chat-name">{selectedUser}</div>
            <div className="chat-status">Online</div>
          </div>
        </div>
      </div>
      
      <MessageList messages={messages} currentUser={currentUser || ''} />
      
      <form onSubmit={handleSubmit} className="chat-input-area">
        <input
          ref={inputRef}
          type="text"
          placeholder={`Message to ${selectedUser}...`}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="chat-input"
        />
        <button type="submit" className="send-button" disabled={!inputText.trim()}>
          Send →
        </button>
      </form>
    </div>
  );
};

export default Chat;