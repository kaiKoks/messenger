import React, { useState } from 'react';
import { useChat } from './hooks/useChat';
import './App.css';

const App: React.FC = () => {
  const [username, setUsername] = useState('');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  
  const {
    messages,
    onlineUsers,
    isConnected,
    error,
    currentUser,
    connect,
    sendMessage,
    getUsers,
    getHistory,
    messagesEndRef
  } = useChat();

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      connect(username.trim());
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUser && inputMessage.trim()) {
      sendMessage(selectedUser, inputMessage);
      setInputMessage('');
    }
  };

  const handleLogout = () => {
    window.location.reload();
  };

  if (!isConnected) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>📱 Messenger</h1>
          <form onSubmit={handleConnect}>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={!username.trim()}>
              Connect
            </button>
          </form>
          {error && <div className="error-message">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="user-info">
          <h3>👤 {currentUser}</h3>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
        
        <div className="actions">
          <button onClick={getUsers} className="action-btn">
            📋 Refresh Users
          </button>
          <button onClick={getHistory} className="action-btn">
            📜 Get History
          </button>
        </div>
        
        <div className="users-list">
          <h4>Online Users ({onlineUsers.length})</h4>
          <ul>
            {onlineUsers.filter(u => u !== currentUser).map(user => (
              <li
                key={user}
                className={`user-item ${selectedUser === user ? 'selected' : ''}`}
                onClick={() => setSelectedUser(user)}
              >
                <span className="user-status online"></span>
                {user}
              </li>
            ))}
            {onlineUsers.filter(u => u === currentUser).map(user => (
              <li key={user} className="user-item current">
                <span className="user-status online"></span>
                {user} (you)
              </li>
            ))}
          </ul>
        </div>
      </div>
      
      {/* Chat Area */}
      <div className="chat-area">
        <div className="chat-header">
          {selectedUser ? (
            <>💬 Chat with <strong>{selectedUser}</strong></>
          ) : (
            <>Select a user to start chatting</>
          )}
        </div>
        
        <div className="messages-container">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`message ${msg.isOwn ? 'own' : ''} ${msg.isSystem ? 'system' : ''}`}
            >
              {!msg.isOwn && !msg.isSystem && msg.sender !== 'system' && (
                <div className="message-sender">{msg.sender}</div>
              )}
              <div className="message-text">{msg.text}</div>
              <div className="message-time">
                {msg.timestamp.toLocaleTimeString()}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        
        {selectedUser && (
          <form onSubmit={handleSendMessage} className="input-area">
            <input
              type="text"
              placeholder={`Message to ${selectedUser}...`}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              autoFocus
            />
            <button type="submit">Send</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default App;